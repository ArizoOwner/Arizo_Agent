// Spotify account connection: OAuth 2.0 Authorization Code with PKCE, so no
// client secret exists anywhere. The user registers their own free Spotify
// developer app once, pastes its public Client ID, and approves access in the
// browser. The refresh token lives in the Windows Credential Manager; the
// access token only in memory. Playback state and commands then go through the
// Spotify Web API (reading works for any account, controls need Premium).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::{Method, Url};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Registered by the user in their Spotify developer app.
pub const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const LISTEN_ADDR: &str = "127.0.0.1:43821";
// user-read-private is what makes /me report the plan ("product"); without it the
// field is missing and a Premium account would look free.
const SCOPES: &str =
    "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-private";
const KEY_SERVICE: &str = "com.arizo.translate";
const KEY_NAME: &str = "spotify-refresh-token";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(180);
const IMAGE_LIMIT: usize = 3 * 1024 * 1024;

static CANCEL: AtomicBool = AtomicBool::new(false);
/// Until when Spotify asked us to stay away (429 Retry-After). Web API calls honour
/// it; the code exchange of a connect does not, so connecting is never blocked.
static RATE_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

/// What the page may know about the account: never a token.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    /// A Client ID has been entered.
    pub configured: bool,
    pub connected: bool,
    pub name: String,
    pub premium: bool,
    /// The last problem, as a short code the page translates (empty = fine).
    pub error: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ApiError {
    NotConnected,
    Auth,
    Premium,
    Forbidden,
    NotRegistered,
    NoDevice,
    Rate(u64),
    Http(u16),
    Net(String),
    PortBusy,
    Timeout,
    Denied,
    Cancelled,
    Busy,
    BadId,
    BadAction,
}

impl ApiError {
    /// The code the page maps to a sentence.
    pub fn code(&self) -> String {
        match self {
            ApiError::NotConnected => "not_connected".into(),
            ApiError::Auth => "auth".into(),
            ApiError::Premium => "premium_required".into(),
            ApiError::Forbidden => "forbidden".into(),
            ApiError::NotRegistered => "not_registered".into(),
            ApiError::NoDevice => "no_device".into(),
            ApiError::Rate(_) => "rate_limited".into(),
            ApiError::Http(s) => format!("http_{s}"),
            ApiError::Net(_) => "network".into(),
            ApiError::PortBusy => "port_busy".into(),
            ApiError::Timeout => "timeout".into(),
            ApiError::Denied => "denied".into(),
            ApiError::Cancelled => "cancelled".into(),
            ApiError::Busy => "busy".into(),
            ApiError::BadId => "bad_client_id".into(),
            ApiError::BadAction => "bad_action".into(),
        }
    }
}

#[derive(Default)]
struct Session {
    client_id: String,
    refresh: Option<String>,
    access: Option<(String, Instant)>,
    name: String,
    premium: bool,
    profile_loaded: bool,
    connecting: bool,
    last_error: String,
}

static SESSION: LazyLock<Mutex<Session>> = LazyLock::new(|| Mutex::new(Session::default()));

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder().timeout(Duration::from_secs(10)).build().expect("http client")
    })
}

fn net(e: reqwest::Error) -> ApiError {
    ApiError::Net(e.without_url().to_string())
}

// ── Credential Manager ────────────────────────────────────────────────────────

fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEY_SERVICE, KEY_NAME).ok()
}

/// "<client id>:<refresh token>": a token never outlives the app it belongs to.
fn load_refresh(client_id: &str) -> Option<String> {
    if client_id.is_empty() {
        return None;
    }
    let raw = entry()?.get_password().ok()?;
    let (id, token) = raw.split_once(':')?;
    (id == client_id && !token.is_empty()).then(|| token.to_string())
}

fn save_refresh(client_id: &str, token: &str) {
    if let Some(e) = entry() {
        let _ = e.set_password(&format!("{client_id}:{token}"));
    }
}

fn delete_refresh() {
    if let Some(e) = entry() {
        let _ = e.delete_credential();
    }
}

/// Makes the session belong to `client_id`: a different one starts clean.
fn adopt(client_id: &str) {
    let mut s = SESSION.lock().unwrap();
    if s.client_id != client_id {
        *s = Session { client_id: client_id.to_string(), refresh: load_refresh(client_id), ..Session::default() };
    }
}

fn forget(client_id: &str) {
    delete_refresh();
    let mut s = SESSION.lock().unwrap();
    *s = Session { client_id: client_id.to_string(), ..Session::default() };
}

pub fn account_state(client_id: &str) -> AccountState {
    adopt(client_id);
    let s = SESSION.lock().unwrap();
    AccountState {
        configured: !client_id.is_empty(),
        connected: s.refresh.is_some(),
        name: s.name.clone(),
        premium: s.premium,
        error: s.last_error.clone(),
    }
}

// ── PKCE ──────────────────────────────────────────────────────────────────────

fn random_token(bytes: usize) -> Result<String, ApiError> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| ApiError::Net(e.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// RFC 7636 S256.
pub fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn valid_client_id(id: &str) -> bool {
    (20..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn authorize_url(client_id: &str, challenge: &str, state: &str) -> String {
    Url::parse_with_params(
        "https://accounts.spotify.com/authorize",
        &[
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT_URI),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge),
            ("state", state),
            ("scope", SCOPES),
        ],
    )
    .map(|u| u.to_string())
    .unwrap_or_default()
}

// ── The browser's way back ────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
pub enum Callback {
    Code { code: String, state: String },
    Denied { state: Option<String> },
    Other,
}

pub fn parse_callback(request: &str) -> Callback {
    let line = request.lines().next().unwrap_or("");
    let mut parts = line.split_whitespace();
    if parts.next() != Some("GET") {
        return Callback::Other;
    }
    let target = parts.next().unwrap_or("");
    if target != "/callback" && !target.starts_with("/callback?") {
        return Callback::Other;
    }
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else { return Callback::Other };
    let (mut code, mut state, mut error) = (None, None, false);
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "error" => error = true,
            _ => {}
        }
    }
    if error {
        return Callback::Denied { state };
    }
    match (code, state) {
        (Some(code), Some(state)) if !code.is_empty() => Callback::Code { code, state },
        _ => Callback::Other,
    }
}

fn respond(stream: &mut TcpStream, status: &str, ok: bool) {
    let (title, text) = if ok {
        ("Arizo-Agent", "Spotify is connected. You can close this tab and return to the island.<br><span dir=\"rtl\">اسپاتیفای وصل شد. این زبانه را ببندید و به جزیره برگردید.</span>")
    } else {
        ("Arizo-Agent", "Spotify was not connected. Return to the island and try again.<br><span dir=\"rtl\">اتصال انجام نشد. به جزیره برگردید و دوباره امتحان کنید.</span>")
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title><body style=\"font:16px system-ui;background:#0b0b10;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center;line-height:2\"><div>{text}</div>"
    );
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

fn wait_for_code(listener: TcpListener, expected_state: &str, deadline: Instant) -> Result<String, ApiError> {
    loop {
        if CANCEL.load(Ordering::Relaxed) {
            return Err(ApiError::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(ApiError::Timeout);
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(ApiError::Net(e.to_string())),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        match parse_callback(&String::from_utf8_lossy(&buf[..n])) {
            Callback::Code { code, state } if state == expected_state => {
                respond(&mut stream, "200 OK", true);
                return Ok(code);
            }
            // Only Spotify's own redirect carries the state: a web page cannot abort the flow.
            Callback::Denied { state } if state.as_deref() == Some(expected_state) => {
                respond(&mut stream, "200 OK", false);
                return Err(ApiError::Denied);
            }
            // A stray request (favicon, a stale tab, a wrong state): keep waiting.
            _ => respond(&mut stream, "404 Not Found", false),
        }
    }
}

// ── Tokens ────────────────────────────────────────────────────────────────────

async fn token_request(form: &[(&str, &str)]) -> Result<Value, ApiError> {
    let res = http().post("https://accounts.spotify.com/api/token").form(form).send().await.map_err(net)?;
    let status = res.status().as_u16();
    let retry = retry_after(&res);
    let body: Value = res.json().await.unwrap_or(Value::Null);
    match status {
        200 => Ok(body),
        400 | 401 => Err(ApiError::Auth),
        429 => Err(note_rate(retry)),
        s => Err(ApiError::Http(s)),
    }
}

/// Records a 429 so no call goes out before Retry-After has passed.
fn note_rate(secs: u64) -> ApiError {
    *RATE_UNTIL.lock().unwrap() = Some(Instant::now() + Duration::from_secs(secs.min(3600)));
    ApiError::Rate(secs)
}

/// The seconds still to wait, if a 429 is in force.
fn rate_wait() -> Option<u64> {
    let mut until = RATE_UNTIL.lock().unwrap();
    let left = until.and_then(|t| t.checked_duration_since(Instant::now()));
    if left.is_none() {
        *until = None;
    }
    left.map(|d| d.as_secs_f64().ceil() as u64)
}

fn retry_after(res: &reqwest::Response) -> u64 {
    res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse().ok()).unwrap_or(5)
}

fn store_tokens(client_id: &str, v: &Value, old_refresh: Option<&str>) -> Result<String, ApiError> {
    let access = v["access_token"].as_str().filter(|t| !t.is_empty()).ok_or(ApiError::Http(0))?.to_string();
    let secs = v["expires_in"].as_u64().unwrap_or(3600).clamp(60, 86_400);
    let refresh = v["refresh_token"].as_str().map(str::to_string).or_else(|| old_refresh.map(str::to_string));
    {
        let mut s = SESSION.lock().unwrap();
        s.access = Some((access.clone(), Instant::now() + Duration::from_secs(secs)));
        if let Some(r) = &refresh {
            s.refresh = Some(r.clone());
        }
    }
    if let Some(r) = refresh {
        save_refresh(client_id, &r);
    }
    Ok(access)
}

async fn access_token(client_id: &str) -> Result<String, ApiError> {
    adopt(client_id);
    let refresh = {
        let s = SESSION.lock().unwrap();
        if let Some((token, expires)) = &s.access {
            if *expires > Instant::now() + Duration::from_secs(30) {
                return Ok(token.clone());
            }
        }
        s.refresh.clone()
    }
    .ok_or(ApiError::NotConnected)?;
    match token_request(&[("grant_type", "refresh_token"), ("refresh_token", &refresh), ("client_id", client_id)]).await {
        Ok(v) => store_tokens(client_id, &v, Some(&refresh)),
        Err(ApiError::Auth) => {
            // Revoked on spotify.com, or the app was deleted: connect again.
            forget(client_id);
            Err(ApiError::Auth)
        }
        Err(e) => Err(e),
    }
}

// ── The Web API ───────────────────────────────────────────────────────────────

async fn api(client_id: &str, method: Method, path: &str, query: &[(&str, String)]) -> Result<Value, ApiError> {
    if let Some(left) = rate_wait() {
        return Err(ApiError::Rate(left.max(1)));
    }
    for attempt in 0..2 {
        let token = access_token(client_id).await?;
        let url = Url::parse_with_params(&format!("https://api.spotify.com/v1{path}"), query)
            .map_err(|e| ApiError::Net(e.to_string()))?;
        let mut request = http().request(method.clone(), url).bearer_auth(&token);
        // A POST or PUT with no body must still say so: Spotify answers 411 otherwise.
        if method != Method::GET {
            request = request.header(reqwest::header::CONTENT_LENGTH, 0);
        }
        let res = request.send().await.map_err(net)?;
        let status = res.status().as_u16();
        match status {
            200 => return Ok(res.json().await.unwrap_or(Value::Null)),
            201 | 202 | 204 => return Ok(Value::Null),
            401 if attempt == 0 => {
                SESSION.lock().unwrap().access = None;
                continue;
            }
            401 => return Err(ApiError::Auth),
            403 => {
                let body: Value = res.json().await.unwrap_or(Value::Null);
                return Err(classify_forbidden(body["error"]["message"].as_str().unwrap_or("")));
            }
            404 => return Err(ApiError::NoDevice),
            429 => return Err(note_rate(retry_after(&res))),
            s => return Err(ApiError::Http(s)),
        }
    }
    Err(ApiError::Auth)
}

pub fn classify_forbidden(message: &str) -> ApiError {
    let m = message.to_ascii_lowercase();
    if m.contains("premium") {
        ApiError::Premium
    } else if m.contains("registered") || m.contains("allowlist") || m.contains("allow list") {
        ApiError::NotRegistered
    } else {
        ApiError::Forbidden
    }
}

/// "premium" is Premium; "free" and "open" are not. A missing plan (a token made
/// before the scope was asked for) is unknown, not free: controls are tried and
/// Spotify itself says no if the account really can't.
pub fn is_premium(product: Option<&str>) -> bool {
    product.is_none_or(|p| p == "premium")
}

async fn load_profile(client_id: &str) -> Result<(), ApiError> {
    let me = api(client_id, Method::GET, "/me", &[]).await?;
    let mut s = SESSION.lock().unwrap();
    s.name = me["display_name"].as_str().or_else(|| me["id"].as_str()).unwrap_or("").chars().take(80).collect();
    s.premium = is_premium(me["product"].as_str());
    s.profile_loaded = true;
    Ok(())
}

/// What is playing now: `None` when no device is active (HTTP 204).
pub async fn player(client_id: &str) -> Result<Option<Value>, ApiError> {
    let loaded = SESSION.lock().unwrap().profile_loaded;
    if !loaded {
        match load_profile(client_id).await {
            Err(ApiError::Auth) | Err(ApiError::NotConnected) => return Err(ApiError::Auth),
            _ => {}
        }
    }
    let v = api(client_id, Method::GET, "/me/player", &[("additional_types", "episode".to_string())]).await?;
    Ok(if v.is_object() { Some(v) } else { None })
}

/// The Web API request a control becomes. Pure, so it can be tested.
pub fn command_request(
    action: &str,
    value: Option<f64>,
    playing: bool,
) -> Result<(Method, &'static str, Vec<(&'static str, String)>), ApiError> {
    let flag = |v: Option<f64>| v.map(|n| n != 0.0);
    Ok(match action {
        "playPause" => (Method::PUT, if playing { "/me/player/pause" } else { "/me/player/play" }, vec![]),
        "next" => (Method::POST, "/me/player/next", vec![]),
        "previous" => (Method::POST, "/me/player/previous", vec![]),
        "seek" => {
            let secs = value.filter(|v| v.is_finite()).ok_or(ApiError::BadAction)?.max(0.0);
            (Method::PUT, "/me/player/seek", vec![("position_ms", ((secs * 1000.0).round() as u64).to_string())])
        }
        "shuffle" => {
            let on = flag(value).ok_or(ApiError::BadAction)?;
            (Method::PUT, "/me/player/shuffle", vec![("state", on.to_string())])
        }
        "repeat" => {
            let on = flag(value).ok_or(ApiError::BadAction)?;
            (Method::PUT, "/me/player/repeat", vec![("state", if on { "context" } else { "off" }.to_string())])
        }
        "volume" => {
            let v = value.filter(|v| v.is_finite()).ok_or(ApiError::BadAction)?.clamp(0.0, 100.0);
            (Method::PUT, "/me/player/volume", vec![("volume_percent", (v.round() as u32).to_string())])
        }
        _ => return Err(ApiError::BadAction),
    })
}

pub async fn command(client_id: &str, action: &str, value: Option<f64>, playing: bool) -> Result<(), ApiError> {
    let (method, path, query) = command_request(action, value, playing)?;
    api(client_id, method, path, &query).await.map(|_| ())
}

/// Spotify covers only, from its own CDN, bounded: the page may not load
/// anything remote, so the backend hands it a data URL.
pub fn is_cover_host(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https" && u.host_str().is_some_and(|h| h == "scdn.co" || h.ends_with(".scdn.co"))
    })
}

pub async fn fetch_image(url: &str) -> Option<Vec<u8>> {
    if !is_cover_host(url) {
        return None;
    }
    let res = http().get(url).send().await.ok()?;
    if !res.status().is_success() || res.content_length().is_some_and(|n| n as usize > IMAGE_LIMIT) {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    (bytes.len() <= IMAGE_LIMIT).then(|| bytes.to_vec())
}

// ── Connecting ────────────────────────────────────────────────────────────────

pub fn cancel_connect() {
    CANCEL.store(true, Ordering::Relaxed);
}

pub async fn connect(client_id: &str) -> Result<AccountState, ApiError> {
    if !valid_client_id(client_id) {
        return Err(ApiError::BadId);
    }
    adopt(client_id);
    {
        let mut s = SESSION.lock().unwrap();
        if s.connecting {
            return Err(ApiError::Busy);
        }
        s.connecting = true;
    }
    CANCEL.store(false, Ordering::Relaxed);
    let result = connect_inner(client_id).await;
    let mut s = SESSION.lock().unwrap();
    s.connecting = false;
    s.last_error = result.as_ref().err().map(ApiError::code).unwrap_or_default();
    drop(s);
    result.map(|_| account_state(client_id))
}

async fn connect_inner(client_id: &str) -> Result<(), ApiError> {
    // Bound before the browser opens, so the redirect can never find nobody home.
    let listener = TcpListener::bind(LISTEN_ADDR).map_err(|_| ApiError::PortBusy)?;
    listener.set_nonblocking(true).map_err(|e| ApiError::Net(e.to_string()))?;
    let verifier = random_token(64)?;
    let state = random_token(24)?;
    let url = authorize_url(client_id, &code_challenge(&verifier), &state);
    crate::platform::open_url(&url);
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state, deadline))
        .await
        .map_err(|e| ApiError::Net(e.to_string()))??;
    let tokens = token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id),
        ("code_verifier", &verifier),
    ])
    .await?;
    store_tokens(client_id, &tokens, None)?;
    // A fresh approval: its first profile read must not be refused by an old 429.
    *RATE_UNTIL.lock().unwrap() = None;
    if let Err(e) = load_profile(client_id).await {
        forget(client_id);
        return Err(e);
    }
    Ok(())
}

pub fn disconnect(client_id: &str) {
    forget(client_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc_7636() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let v = random_token(64).unwrap();
        assert!((43..=128).contains(&v.len()) && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(v, random_token(64).unwrap());
    }

    #[test]
    fn authorize_url_carries_pkce_and_the_registered_redirect() {
        let u = Url::parse(&authorize_url("abc123abc123abc123abc123", "CHALLENGE", "STATE")).unwrap();
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(u.host_str(), Some("accounts.spotify.com"));
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["redirect_uri"], REDIRECT_URI);
        assert_eq!(q["state"], "STATE");
        assert!(!q.contains_key("client_secret"));
        assert!(q["scope"].contains("user-modify-playback-state"));
    }

    #[test]
    fn the_plan_is_read_with_the_right_scope_and_never_guessed_as_free() {
        assert!(SCOPES.split(' ').any(|s| s == "user-read-private"));
        assert!(is_premium(Some("premium")));
        assert!(!is_premium(Some("free")));
        assert!(!is_premium(Some("open")));
        assert!(is_premium(None), "an unknown plan is tried, not refused");
        let u = Url::parse(&authorize_url("abc123abc123abc123abc123", "C", "S")).unwrap();
        assert!(u.query_pairs().any(|(k, v)| k == "scope" && v.contains("user-read-private")));
    }

    #[test]
    fn client_ids_are_plain_and_bounded() {
        assert!(valid_client_id("0123456789abcdef0123456789abcdef"));
        for bad in ["", "short", "has space 0123456789abcdef0123", "0123456789abcdef0123456789abcdef/../x", &"a".repeat(65)] {
            assert!(!valid_client_id(bad), "{bad}");
        }
    }

    #[test]
    fn the_callback_is_parsed_strictly() {
        assert_eq!(
            parse_callback("GET /callback?code=AQB%2Fx&state=S1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
            Callback::Code { code: "AQB/x".into(), state: "S1".into() }
        );
        assert_eq!(
            parse_callback("GET /callback?error=access_denied&state=S1 HTTP/1.1"),
            Callback::Denied { state: Some("S1".into()) }
        );
        assert_eq!(parse_callback("GET /callback?error=x HTTP/1.1"), Callback::Denied { state: None });
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1"), Callback::Other);
        assert_eq!(parse_callback("GET /callback HTTP/1.1"), Callback::Other);
        assert_eq!(parse_callback("GET /callbackx?code=1&state=2 HTTP/1.1"), Callback::Other);
        assert_eq!(parse_callback("POST /callback?code=1&state=2 HTTP/1.1"), Callback::Other);
        assert_eq!(parse_callback("GET /callback?code=&state=2 HTTP/1.1"), Callback::Other);
        assert_eq!(parse_callback(""), Callback::Other);
    }

    #[test]
    fn controls_become_the_right_web_api_requests() {
        let (m, p, q) = command_request("playPause", None, true).unwrap();
        assert_eq!((m, p, q.len()), (Method::PUT, "/me/player/pause", 0));
        assert_eq!(command_request("playPause", None, false).unwrap().1, "/me/player/play");
        assert_eq!(command_request("next", None, true).unwrap().0, Method::POST);
        let (_, p, q) = command_request("seek", Some(75.4), true).unwrap();
        assert_eq!((p, q[0].1.as_str()), ("/me/player/seek", "75400"));
        assert_eq!(command_request("seek", Some(-5.0), true).unwrap().2[0].1, "0");
        assert_eq!(command_request("volume", Some(250.0), true).unwrap().2[0].1, "100");
        assert_eq!(command_request("shuffle", Some(1.0), true).unwrap().2[0].1, "true");
        assert_eq!(command_request("repeat", Some(1.0), true).unwrap().2[0].1, "context");
        assert_eq!(command_request("repeat", Some(0.0), true).unwrap().2[0].1, "off");
        for bad in [("seek", None), ("seek", Some(f64::NAN)), ("volume", None), ("shuffle", None), ("explode", Some(1.0))] {
            assert_eq!(command_request(bad.0, bad.1, true).unwrap_err(), ApiError::BadAction);
        }
    }

    #[test]
    fn only_spotify_covers_are_fetched() {
        assert!(is_cover_host("https://i.scdn.co/image/ab67616d0000b273"));
        for bad in ["http://i.scdn.co/x", "https://evil.example/i.scdn.co", "https://scdn.co.evil.example/x", "https://127.0.0.1/x", "file:///c:/x", "i.scdn.co"] {
            assert!(!is_cover_host(bad), "{bad}");
        }
    }

    #[test]
    fn a_429_blocks_later_calls_until_retry_after_has_passed() {
        assert_eq!(rate_wait(), None);
        assert_eq!(note_rate(30), ApiError::Rate(30));
        let left = rate_wait().expect("blocked");
        assert!((1..=30).contains(&left));
        *RATE_UNTIL.lock().unwrap() = None;
        assert_eq!(rate_wait(), None);
    }

    #[test]
    fn forbidden_answers_are_told_apart() {
        assert_eq!(classify_forbidden("Player command failed: Premium required"), ApiError::Premium);
        assert_eq!(classify_forbidden("User not registered in the Developer Dashboard"), ApiError::NotRegistered);
        assert_eq!(classify_forbidden(""), ApiError::Forbidden);
        assert_eq!(ApiError::Http(500).code(), "http_500");
    }

    #[test]
    fn tokens_belong_to_one_client_and_never_reach_the_page() {
        let s = serde_json::to_value(AccountState { configured: true, connected: true, name: "A".into(), premium: true, error: String::new() }).unwrap();
        let text = s.to_string();
        assert!(!text.contains("token") && !text.contains("secret"));
        assert_eq!(s["premium"], true);
    }
}
