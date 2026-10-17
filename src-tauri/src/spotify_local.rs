// Spotify on this PC, with no account: Windows publishes what the desktop app
// plays to the system media controls (the overlay the media keys show), and
// takes play/pause, skip, seek, shuffle and repeat as requests. The volume is
// Spotify's own slider in the Windows mixer (Core Audio), not the master volume.
//
// All WinRT / Core Audio work lives on one thread that owns its COM apartment.
// The poller in spotify.rs talks to it over a channel and is woken (Notify) by
// the session's own change events.

use std::collections::VecDeque;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{oneshot, Notify};
use windows::core::{Interface, PWSTR};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::DataReader;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

use crate::spotify::{data_url, Capabilities, PlayerState, Track};

const ARTWORK_LIMIT: usize = 3 * 1024 * 1024;
const ASYNC_WAIT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);

pub enum Req {
    Read(oneshot::Sender<Option<PlayerState>>),
    Control(String, Option<f64>, Instant, oneshot::Sender<Result<bool, String>>),
}

/// Starts the thread. It ends when the last sender is dropped.
pub fn start(wake: Arc<Notify>) -> Option<Sender<Req>> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("arizo-spotify-local".into())
        .spawn(move || run(rx, wake))
        .map_err(|e| crate::log(&format!("spotify local thread: {e}")))
        .ok()?;
    Some(tx)
}

/// What Spotify on this PC is playing, `None` if there is nothing to show.
pub async fn read(tx: &Sender<Req>) -> Option<PlayerState> {
    let (reply, rx) = oneshot::channel();
    tx.send(Req::Read(reply)).ok()?;
    tokio::time::timeout(REQUEST_TIMEOUT, rx).await.ok()?.ok()?
}

pub async fn control(tx: &Sender<Req>, action: &str, value: Option<f64>) -> Result<bool, String> {
    let (reply, rx) = oneshot::channel();
    tx.send(Req::Control(action.to_string(), value, Instant::now() + REQUEST_TIMEOUT, reply))
        .map_err(|_| "no_device".to_string())?;
    tokio::time::timeout(REQUEST_TIMEOUT, rx)
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|_| "no_device".to_string())?
}

// ── The thread ────────────────────────────────────────────────────────────────

struct Apartment;
impl Apartment {
    fn new() -> Option<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.ok().map(|_| Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

/// A handler that only wakes the poller; it never reads anything itself.
fn wake_on<A: windows::core::RuntimeType + 'static>(wake: &Arc<Notify>) -> TypedEventHandler<Session, A> {
    let wake = wake.clone();
    TypedEventHandler::new(move |_, _| {
        wake.notify_one();
        Ok(())
    })
}

struct Bound {
    session: Session,
    tokens: [Option<i64>; 3],
}
impl Bound {
    fn new(session: Session, wake: &Arc<Notify>) -> Self {
        Self {
            tokens: [
                session.MediaPropertiesChanged(&wake_on(wake)).ok(),
                session.PlaybackInfoChanged(&wake_on(wake)).ok(),
                session.TimelinePropertiesChanged(&wake_on(wake)).ok(),
            ],
            session,
        }
    }
}
impl Drop for Bound {
    fn drop(&mut self) {
        if let Some(t) = self.tokens[0] {
            let _ = self.session.RemoveMediaPropertiesChanged(t);
        }
        if let Some(t) = self.tokens[1] {
            let _ = self.session.RemovePlaybackInfoChanged(t);
        }
        if let Some(t) = self.tokens[2] {
            let _ = self.session.RemoveTimelinePropertiesChanged(t);
        }
    }
}

/// Waits for a WinRT operation, but never longer than a couple of seconds.
fn wait<T: windows::core::RuntimeType>(op: windows_future::IAsyncOperation<T>) -> windows::core::Result<T> {
    if op.Status()? == windows_future::AsyncStatus::Started {
        let (tx, rx) = mpsc::sync_channel(1);
        op.SetCompleted(&windows_future::AsyncOperationCompletedHandler::new(move |_, _| {
            let _ = tx.try_send(());
            Ok(())
        }))?;
        if rx.recv_timeout(ASYNC_WAIT).is_err() {
            let _ = op.Cancel();
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x800705b4u32 as i32)));
        }
    }
    op.GetResults()
}

fn find_session(manager: &Manager) -> Option<Session> {
    let sessions = manager.GetSessions().ok()?;
    let mut fallback = None;
    for i in 0..sessions.Size().ok()? {
        let Ok(s) = sessions.GetAt(i) else { continue };
        if !s.SourceAppUserModelId().is_ok_and(|id| is_spotify_app(&id.to_string_lossy())) {
            continue;
        }
        if s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).is_ok_and(|p| p == Status::Playing) {
            return Some(s);
        }
        fallback.get_or_insert(s);
    }
    fallback
}

fn run(rx: Receiver<Req>, wake: Arc<Notify>) {
    let Some(_apartment) = Apartment::new() else { return };
    let mut manager: Option<Manager> = None;
    let mut sessions_token = None;
    let mut bound: Option<Bound> = None;
    let mut art: VecDeque<(String, String)> = VecDeque::new();
    while let Ok(req) = rx.recv() {
        if manager.is_none() {
            if let Ok(m) = Manager::RequestAsync().and_then(wait) {
                let w = wake.clone();
                sessions_token = m
                    .SessionsChanged(&TypedEventHandler::new(move |_, _| {
                        w.notify_one();
                        Ok(())
                    }))
                    .ok();
                manager = Some(m);
            }
        }
        let session = manager.as_ref().and_then(find_session);
        if bound.as_ref().map(|b| &b.session) != session.as_ref() {
            bound = session.map(|s| Bound::new(s, &wake));
        }
        match req {
            Req::Read(reply) => {
                let state = bound.as_ref().and_then(|b| read_state(&b.session, &mut art));
                let _ = reply.send(state);
            }
            Req::Control(action, value, deadline, reply) => {
                // A command that already timed out must not run later.
                let done = if Instant::now() >= deadline {
                    Err("timeout".to_string())
                } else {
                    bound.as_ref().map(|b| do_control(&b.session, &action, value)).unwrap_or(Ok(false))
                };
                let _ = reply.send(done);
            }
        }
    }
    drop(bound);
    if let (Some(m), Some(t)) = (manager, sessions_token) {
        let _ = m.RemoveSessionsChanged(t);
    }
}

// ── Reading ───────────────────────────────────────────────────────────────────

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0
}

fn read_state(session: &Session, art: &mut VecDeque<(String, String)>) -> Option<PlayerState> {
    let props = session.TryGetMediaPropertiesAsync().and_then(wait).ok()?;
    let info = session.GetPlaybackInfo().ok()?;
    let timeline = session.GetTimelineProperties().ok();
    let start = timeline.as_ref().and_then(|t| t.StartTime().ok()).map(|t| t.Duration).unwrap_or(0);
    let duration = timeline
        .as_ref()
        .and_then(|t| t.EndTime().ok())
        .map(|t| ticks_to_secs(t.Duration.saturating_sub(start)))
        .unwrap_or(0.0);
    let track: Track = windows_track(
        &props.Title().map(|s| s.to_string_lossy()).unwrap_or_default(),
        &props.Artist().map(|s| s.to_string_lossy()).unwrap_or_default(),
        &props.AlbumTitle().map(|s| s.to_string_lossy()).unwrap_or_default(),
        duration,
    )?;
    let position = timeline
        .as_ref()
        .and_then(|t| t.Position().ok())
        .map(|t| ticks_to_secs(t.Duration.saturating_sub(start)))
        .unwrap_or(0.0);
    let now = now_ms();
    let updated = timeline
        .as_ref()
        .and_then(|t| t.LastUpdatedTime().ok())
        .and_then(|t| windows_time_to_unix_ms(t.UniversalTime));
    let audio = spotify_audio();
    let volume = audio
        .iter()
        .find_map(|v| unsafe { v.GetMasterVolume().ok() })
        .map(|v| (v * 100.0).round().clamp(0.0, 100.0) as i32)
        .unwrap_or(50);
    let capabilities = info
        .Controls()
        .ok()
        .map(|c| Capabilities {
            play_pause: c.IsPlayPauseToggleEnabled().unwrap_or(false),
            next: c.IsNextEnabled().unwrap_or(false),
            previous: c.IsPreviousEnabled().unwrap_or(false),
            seek: duration > 0.0 && c.IsPlaybackPositionEnabled().unwrap_or(false),
            shuffle: c.IsShuffleEnabled().unwrap_or(false),
            repeat: c.IsRepeatEnabled().unwrap_or(false),
            volume: !audio.is_empty(),
        })
        .unwrap_or_default();
    let key = track.art_url.clone();
    let artwork_data_url = key.and_then(|key| {
        if let Some((_, data)) = art.iter().find(|(k, _)| *k == key) {
            return Some(data.clone());
        }
        let data = thumbnail(&props).as_deref().and_then(data_url)?;
        art.push_back((key, data.clone()));
        while art.len() > 4 {
            art.pop_front();
        }
        Some(data)
    });
    Some(PlayerState {
        enabled: true,
        running: true,
        installed: true,
        source: "local".into(),
        playing: info.PlaybackStatus().is_ok_and(|p| p == Status::Playing),
        position,
        position_at: updated.filter(|&t| t <= now).unwrap_or(now),
        shuffle: info.IsShuffleActive().and_then(|r| r.Value()).unwrap_or(false),
        repeat: info
            .AutoRepeatMode()
            .and_then(|r| r.Value())
            .is_ok_and(|m| m != MediaPlaybackAutoRepeatMode::None),
        volume,
        track: Some(track),
        artwork_data_url,
        capabilities,
        ..PlayerState::default()
    })
}

fn thumbnail(props: &MediaProperties) -> Option<Vec<u8>> {
    let stream = wait(props.Thumbnail().ok()?.OpenReadAsync().ok()?).ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > ARTWORK_LIMIT as u64 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let loaded = wait(reader.LoadAsync(size as u32).ok()?).ok()?;
    if loaded as u64 != size {
        return None;
    }
    let mut bytes = vec![0; loaded as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}

// ── Volume: Spotify's slider in the Windows mixer ─────────────────────────────

fn spotify_audio() -> Vec<ISimpleAudioVolume> {
    let mut out = Vec::new();
    unsafe {
        let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else {
            return out;
        };
        let Ok(endpoints) = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return out };
        for i in 0..endpoints.GetCount().unwrap_or(0) {
            let Ok(device) = endpoints.Item(i) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
            for j in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(control) = sessions.GetSession(j).and_then(|c| c.cast::<IAudioSessionControl2>()) else {
                    continue;
                };
                if !control.GetProcessId().is_ok_and(is_spotify_process) {
                    continue;
                }
                if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                    out.push(volume);
                }
            }
        }
    }
    out
}

fn is_spotify_process(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut buf = [0u16; 2048];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        result.is_ok()
            && String::from_utf16_lossy(&buf[..len as usize])
                .rsplit(['\\', '/'])
                .next()
                .is_some_and(|name| name.eq_ignore_ascii_case("spotify.exe"))
    }
}

// ── Controls ──────────────────────────────────────────────────────────────────

fn do_control(session: &Session, action: &str, value: Option<f64>) -> Result<bool, String> {
    if value.is_some_and(|v| !v.is_finite()) {
        return Err("bad_action".into());
    }
    let info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
    let controls = info.Controls().map_err(|e| e.to_string())?;
    macro_rules! asked {
        ($op:expr) => {
            $op.and_then(wait).map_err(|e| e.to_string())
        };
    }
    match action {
        "playPause" if controls.IsPlayPauseToggleEnabled().unwrap_or(false) => asked!(session.TryTogglePlayPauseAsync()),
        "next" if controls.IsNextEnabled().unwrap_or(false) => asked!(session.TrySkipNextAsync()),
        "previous" if controls.IsPreviousEnabled().unwrap_or(false) => asked!(session.TrySkipPreviousAsync()),
        "seek" if controls.IsPlaybackPositionEnabled().unwrap_or(false) => {
            let Some(value) = value else { return Err("bad_action".into()) };
            let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
            let start = timeline.StartTime().map_err(|e| e.to_string())?.Duration;
            let end = timeline.EndTime().map_err(|e| e.to_string())?.Duration;
            let seconds = value.clamp(0.0, ticks_to_secs(end.saturating_sub(start)));
            asked!(session.TryChangePlaybackPositionAsync(start.saturating_add((seconds * 10_000_000.0) as i64)))
        }
        "shuffle" if controls.IsShuffleEnabled().unwrap_or(false) => {
            let on = value.map(|v| v != 0.0).unwrap_or_else(|| {
                !info.IsShuffleActive().and_then(|r| r.Value()).unwrap_or(false)
            });
            asked!(session.TryChangeShuffleActiveAsync(on))
        }
        "repeat" if controls.IsRepeatEnabled().unwrap_or(false) => {
            let on = value.map(|v| v != 0.0).unwrap_or_else(|| {
                info.AutoRepeatMode().and_then(|r| r.Value()).is_ok_and(|m| m == MediaPlaybackAutoRepeatMode::None)
            });
            asked!(session.TryChangeAutoRepeatModeAsync(if on {
                MediaPlaybackAutoRepeatMode::List
            } else {
                MediaPlaybackAutoRepeatMode::None
            }))
        }
        "volume" => {
            let Some(value) = value else { return Err("bad_action".into()) };
            let audio = spotify_audio();
            if audio.is_empty() {
                return Ok(false);
            }
            let level = (value.clamp(0.0, 100.0) / 100.0) as f32;
            let mut done = true;
            for volume in audio {
                done &= unsafe { volume.SetMasterVolume(level, std::ptr::null()).is_ok() };
            }
            Ok(done)
        }
        "playPause" | "next" | "previous" | "seek" | "shuffle" | "repeat" => Ok(false),
        _ => Err("bad_action".into()),
    }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/// The media session ids Spotify registers: "Spotify.exe" (the installer from
/// spotify.com) or "SpotifyAB.SpotifyMusic_…!Spotify" (the Microsoft Store).
fn is_spotify_app(app_id: &str) -> bool {
    let id = app_id.to_ascii_lowercase();
    id == "spotify"
        || id == "spotify.exe"
        || id.starts_with("spotifyab.spotifymusic_")
        || id.rsplit(['\\', '/']).next() == Some("spotify.exe")
}

/// Windows durations and positions are 100 ns ticks.
fn ticks_to_secs(ticks: i64) -> f64 {
    ticks.max(0) as f64 / 10_000_000.0
}

/// A Windows DateTime (100 ns since 1601) as Unix milliseconds; zero is "never".
fn windows_time_to_unix_ms(ticks: i64) -> Option<f64> {
    const EPOCH: i64 = 116_444_736_000_000_000;
    (ticks >= EPOCH).then(|| (ticks - EPOCH) as f64 / 10_000.0)
}

/// Windows gives no Spotify URI, so the id is made from the tags.
fn windows_track(title: &str, artist: &str, album: &str, duration: f64) -> Option<Track> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let (artist, album) = (artist.trim(), album.trim());
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in [artist, album, title].join("\u{1f}").bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    // Only an explicit advert label is an ad: an instrumental or a podcast may
    // legitimately have no artist.
    let is_ad = artist.is_empty()
        && album.is_empty()
        && matches!(title.to_ascii_lowercase().as_str(), "advertisement" | "spotify ad" | "advert");
    Some(Track {
        id: format!("spotify:{}:{hash:016x}", if is_ad { "ad" } else { "track" }),
        title: title.chars().take(500).collect(),
        artist: artist.chars().take(500).collect(),
        album: album.chars().take(500).collect(),
        duration: if duration.is_finite() { duration.max(0.0) } else { 0.0 },
        art_url: Some(format!("smtc:{hash:016x}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_spotify_sessions_match() {
        for id in ["Spotify.exe", "spotify", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", r"C:\Apps\Spotify.exe"] {
            assert!(is_spotify_app(id), "{id}");
        }
        for id in ["chrome.exe", "NotSpotify.exe", "spotify-fake", "Spotify.exe.other"] {
            assert!(!is_spotify_app(id), "{id}");
        }
    }

    #[test]
    fn windows_clock_units() {
        assert_eq!(ticks_to_secs(25_000_000), 2.5);
        assert_eq!(ticks_to_secs(-1), 0.0);
        assert_eq!(windows_time_to_unix_ms(0), None);
        assert_eq!(windows_time_to_unix_ms(116_444_736_010_000_000), Some(1000.0));
    }

    #[test]
    fn tracks_are_stable_and_missing_tags_are_not_ads() {
        assert_eq!(windows_track(" ", "", "", 0.0), None);
        let a = windows_track(" Song ", " Artist ", " Album ", 10.0).unwrap();
        let b = windows_track("Song", "Artist", "Album", 20.0).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.title, "Song");
        assert!(!windows_track("Instrumental", "", "", -5.0).unwrap().id.contains(":ad:"));
        assert!(windows_track("Advertisement", "", "", 30.0).unwrap().id.contains(":ad:"));
        assert_eq!(windows_track("Song", "", "", f64::NAN).unwrap().duration, 0.0);
    }

    #[test]
    #[ignore = "reads the current Windows media session; run explicitly on Windows"]
    fn windows_media_session_smoke_readonly() {
        let _apartment = Apartment::new().expect("initialize Windows media APIs");
        let manager = wait(Manager::RequestAsync().expect("request media manager")).expect("media manager ready");
        let session = find_session(&manager);
        let state = session.as_ref().and_then(|s| read_state(s, &mut VecDeque::new()));
        if let Some(s) = &state {
            assert!(s.position.is_finite() && (0..=100).contains(&s.volume));
        }
        println!(
            "Windows media smoke: spotifySession={}, trackPresent={}, artworkPresent={}, capabilities={:?}",
            session.is_some(),
            state.as_ref().is_some_and(|s| s.track.is_some()),
            state.as_ref().is_some_and(|s| s.artwork_data_url.is_some()),
            state.as_ref().map(|s| s.capabilities.clone()),
        );
    }
}
