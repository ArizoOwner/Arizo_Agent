// Live prices read through the user's own exchange account.
//
// The page never touches the network and never holds a token: it calls the
// commands below and listens to the `crypto` event, which carries only prices.
// Nothing is shown until the exchange has accepted the user's credentials, and
// there is no demo data and no fallback to invented prices: when a read fails the
// page is told so, and keeps what it last had, marked as stale.
//
//   Nobitex  key +   an API key from the panel (Account → API services): its public
//            secret  key and its private key. Every request carries the public key
//                    and an Ed25519 signature; checked with GET /users/profile, then
//                    market stats and GET /market/udf/history (1-minute candles)
//   Binance  key +   checked with a signed, read-only GET /api/v3/account, then
//            secret  ticker/24hr and klines
//
// The credentials live in the Windows Credential Manager (store.rs), one entry
// per exchange. Errors are reported as short stable codes, never as the
// exchange's own text, a URL or a header.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use hmac::{Hmac, Mac};
use ring::signature::Ed25519KeyPair;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::Sha256;
use tauri::{AppHandle, Emitter, WebviewWindow};
use tokio::sync::Notify;

use crate::store::{self, Settings};

const NOBITEX: &str = "https://apiv2.nobitex.ir";
const BINANCE: &str = "https://api.binance.com";
const TOOBIT: &str = "https://api.toobit.com";
const MAX_BODY: usize = 4 * 1024 * 1024;
/// How many 1-minute candles the chart shows.
pub const CANDLES: usize = 60;
/// The candle history is re-read this often; the live price moves the last candle in between.
const HISTORY_EVERY: Duration = Duration::from_secs(10);
/// A token is checked with the exchange again this often, so a revoked one is noticed.
const REVALIDATE_EVERY: Duration = Duration::from_secs(600);
/// While nothing is on screen the poller sleeps; the page wakes it when the section opens.
const IDLE_CHECK: Duration = Duration::from_secs(300);
const MAX_ASSETS: usize = 400;

// ── What the page sees ────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    /// Start of the minute, milliseconds since the epoch.
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub asset: String,
    pub price: f64,
    /// 24-hour change, in percent.
    pub change: f64,
    /// 24-hour volume, in the quote currency.
    pub volume: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ticker {
    pub price: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub change: f64,
    pub volume: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CryptoState {
    pub enabled: bool,
    pub provider: String,
    pub has_credential: bool,
    /// "off", "setup" (needs the user's API), "connecting", "live" or "stale".
    pub phase: String,
    /// Short code of the last problem ("" when none); the page turns it into a sentence.
    pub error: String,
    pub asset: String,
    /// "USDT" or "IRT" (Toman).
    pub quote: String,
    /// "1m", "5m", "15m", "1h", "4h", "1d".
    pub timeframe: String,
    pub ticker: Option<Ticker>,
    pub candles: Vec<Candle>,
    pub candles_error: String,
    pub assets: Vec<Asset>,
    /// When the last good read arrived, milliseconds since the epoch (0 = never).
    pub updated_at: f64,
    /// Grows with every state sent, so the page can tell a late answer from a newer event.
    pub seq: u64,
}

// ── Exchanges, markets and failures ───────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Provider {
    Nobitex,
    Binance,
    Toobit,
}

impl Provider {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "nobitex" => Some(Self::Nobitex),
            "binance" => Some(Self::Binance),
            "toobit" => Some(Self::Toobit),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Nobitex => "nobitex",
            Self::Binance => "binance",
            Self::Toobit => "toobit",
        }
    }

    fn supports(self, quote: Quote) -> bool {
        self == Self::Nobitex || quote == Quote::Usdt
    }

    /// How often the selected coin is read while the section is on screen.
    fn every(self) -> Duration {
        match self {
            Self::Nobitex => Duration::from_secs(5),
            Self::Binance => Duration::from_secs(2),
            Self::Toobit => Duration::from_secs(3),
        }
    }

    /// How often the list of every coin is read (it is the bigger answer).
    fn list_every(self) -> Duration {
        match self {
            Self::Nobitex => Duration::from_secs(30),
            Self::Binance => Duration::from_secs(60),
            Self::Toobit => Duration::from_secs(60),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Quote {
    Usdt,
    Irt,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Timeframe {
    M1,
    M5,
    M15,
    H1,
    H4,
    D1,
}

impl Timeframe {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "1m" => Some(Self::M1),
            "5m" => Some(Self::M5),
            "15m" => Some(Self::M15),
            "1h" => Some(Self::H1),
            "4h" => Some(Self::H4),
            "1d" => Some(Self::D1),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::M1 => "1m",
            Self::M5 => "5m",
            Self::M15 => "15m",
            Self::H1 => "1h",
            Self::H4 => "4h",
            Self::D1 => "1d",
        }
    }

    pub fn step_ms(self) -> i64 {
        match self {
            Self::M1 => 60_000,
            Self::M5 => 300_000,
            Self::M15 => 900_000,
            Self::H1 => 3_600_000,
            Self::H4 => 14_400_000,
            Self::D1 => 86_400_000,
        }
    }

    pub fn nobitex_res(self) -> &'static str {
        match self {
            Self::M1 => "1",
            Self::M5 => "5",
            Self::M15 => "15",
            Self::H1 => "60",
            Self::H4 => "240",
            Self::D1 => "D",
        }
    }

    pub fn binance_interval(self) -> &'static str {
        self.id()
    }
}

impl Quote {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "USDT" => Some(Self::Usdt),
            "IRT" => Some(Self::Irt),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Usdt => "USDT",
            Self::Irt => "IRT",
        }
    }

    /// Nobitex writes the Toman market as "rls" (rial) in its statistics.
    fn nobitex_dst(self) -> &'static str {
        match self {
            Self::Usdt => "usdt",
            Self::Irt => "rls",
        }
    }

    /// The chart history names the markets BTCUSDT and BTCIRT (the latter already in Toman).
    fn nobitex_suffix(self) -> &'static str {
        self.id()
    }

    /// Ten rial to the toman: the statistics are in rial, the page shows Toman.
    fn scale(self) -> f64 {
        match self {
            Self::Usdt => 1.0,
            Self::Irt => 0.1,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Fail {
    Network,
    /// Seconds the exchange asked to wait (0 = not said).
    RateLimited(u64),
    InvalidCredentials,
    InvalidSecret,
    Forbidden,
    Unavailable,
    Clock,
    Bad,
    UnknownAsset,
    Http(u16),
}

impl Fail {
    pub fn code(&self) -> String {
        match self {
            Self::Network => "network".into(),
            Self::RateLimited(_) => "rate_limited".into(),
            Self::InvalidCredentials => "invalid_credentials".into(),
            Self::InvalidSecret => "invalid_secret".into(),
            Self::Forbidden => "forbidden".into(),
            Self::Unavailable => "unavailable".into(),
            Self::Clock => "clock_skew".into(),
            Self::Bad => "bad_response".into(),
            Self::UnknownAsset => "unknown_asset".into(),
            Self::Http(n) => format!("http_{n}"),
        }
    }

    /// The exchange said the credentials themselves are wrong.
    fn rejects_credentials(&self) -> bool {
        matches!(self, Self::InvalidCredentials | Self::InvalidSecret)
    }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/// A finite number from a JSON number or a numeric string (the exchanges send both).
pub fn num(v: &Value) -> Option<f64> {
    let n = match v {
        Value::String(s) => s.trim().parse::<f64>().ok()?,
        Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    n.is_finite().then_some(n)
}

fn field(v: &Value, key: &str) -> Option<f64> {
    num(&v[key])
}

fn positive(v: &Value, key: &str) -> Option<f64> {
    field(v, key).filter(|n| *n > 0.0)
}

/// A token as an exchange issues it: letters, digits and a few separators, never
/// blanks or control characters (so it cannot break out of a header).
pub fn clean_credential(s: &str) -> Option<String> {
    let t = s.trim();
    let ok = !t.is_empty()
        && t.len() <= 256
        && t.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'+' | b'/' | b'='));
    ok.then(|| t.to_string())
}

/// HMAC-SHA256 of `message` under `secret`, as lower-case hex (Binance's signature).
pub fn sign(secret: &str, message: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC takes a key of any length");
    mac.update(message.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// Nobitex's request signature: Ed25519 over `timestamp + METHOD + path-with-query + body`
/// (a GET has no body), made with the 32-byte private key of the API key, as URL-safe Base64.
/// `None` when the private key is not 32 bytes of Base64.
pub fn sign_nobitex(secret: &str, timestamp: &str, method: &str, target: &str) -> Option<String> {
    let seed = URL_SAFE_NO_PAD
        .decode(secret.trim().trim_end_matches('=').replace('+', "-").replace('/', "_"))
        .ok()?;
    let pair = Ed25519KeyPair::from_seed_unchecked(&seed).ok()?;
    Some(URL_SAFE.encode(pair.sign(format!("{timestamp}{method}{target}").as_bytes()).as_ref()))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

fn minute_of(ms: i64) -> i64 {
    ms.div_euclid(60_000) * 60_000
}

/// 3 s, 6 s, 12 s, 24 s, 48 s, then a minute.
pub fn backoff(fails: u32) -> Duration {
    Duration::from_secs((3u64 << fails.saturating_sub(1).min(4)).min(60))
}

fn candle(t: i64, o: f64, h: f64, l: f64, c: f64, v: f64) -> Option<Candle> {
    if t <= 0 || [o, h, l, c].iter().any(|n| !(*n > 0.0)) {
        return None;
    }
    // Rounding on the exchange's side can leave a wick inside the body: widen it.
    Some(Candle { t, o, h: h.max(o).max(c), l: l.min(o).min(c), c, v: v.max(0.0) })
}

/// Oldest first, one candle per minute (the later one wins), the last `CANDLES`.
fn tidy(mut v: Vec<Candle>) -> Vec<Candle> {
    v.sort_by_key(|c| c.t);
    let mut out: Vec<Candle> = Vec::with_capacity(v.len());
    for c in v {
        match out.last_mut() {
            Some(last) if last.t == c.t => *last = c,
            _ => out.push(c),
        }
    }
    let skip = out.len().saturating_sub(CANDLES);
    out.split_off(skip)
}

/// The live price moves the candle of the current minute, as it does on any chart. When the
/// minute has just turned and the exchange has not listed it yet, it opens at the last close.
/// An empty history stays empty: nothing is invented to fill a chart.
pub fn bucket_of(ms: i64, step_ms: i64) -> i64 {
    ms.div_euclid(step_ms) * step_ms
}

pub fn apply_live_timeframe(candles: &mut Vec<Candle>, price: f64, now: i64, step_ms: i64) {
    if !(price > 0.0) {
        return;
    }
    let bucket = bucket_of(now, step_ms);
    let Some(last) = candles.last_mut() else { return };
    if last.t == bucket {
        last.c = price;
        last.h = last.h.max(price);
        last.l = last.l.min(price);
    } else if last.t < bucket {
        let open = last.c;
        candles.push(Candle { t: bucket, o: open, h: open.max(price), l: open.min(price), c: price, v: 0.0 });
        if candles.len() > CANDLES {
            candles.remove(0);
        }
    }
}

pub fn apply_live(candles: &mut Vec<Candle>, price: f64, now: i64) {
    apply_live_timeframe(candles, price, now, 60_000);
}

fn sort_assets(v: &mut Vec<Asset>) {
    v.sort_by(|a, b| {
        b.volume.partial_cmp(&a.volume).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.asset.cmp(&b.asset))
    });
    v.truncate(MAX_ASSETS);
}

// ── Parsing (pure) ────────────────────────────────────────────────────────────

pub fn parse_nobitex_ticker(j: &Value, asset: &str, quote: Quote) -> Option<Ticker> {
    let (key, k) = if asset.eq_ignore_ascii_case("USDT") {
        ("usdt-rls".to_string(), 0.1)
    } else {
        (format!("{}-{}", asset.to_ascii_lowercase(), quote.nobitex_dst()), quote.scale())
    };
    let m = &j["stats"][key.as_str()];
    if !m.is_object() || m["isClosed"].as_bool() == Some(true) {
        return None;
    }
    let price = positive(m, "latest")? * k;
    Some(Ticker {
        price,
        open: positive(m, "dayOpen").map_or(price, |p| p * k),
        high: positive(m, "dayHigh").map_or(price, |p| p * k).max(price),
        low: positive(m, "dayLow").map_or(price, |p| p * k).min(price),
        change: field(m, "dayChange").unwrap_or(0.0),
        volume: field(m, "volumeDst").map_or(0.0, |v| v.max(0.0) * k),
    })
}

pub fn parse_nobitex_assets(j: &Value, quote: Quote) -> Vec<Asset> {
    let suffix = format!("-{}", quote.nobitex_dst());
    let Some(map) = j["stats"].as_object() else { return Vec::new() };
    let k = quote.scale();
    let mut out: Vec<Asset> = map
        .iter()
        .filter_map(|(key, m)| {
            let asset = key.strip_suffix(suffix.as_str())?.to_ascii_uppercase();
            if !store::valid_asset(&asset) || m["isClosed"].as_bool() == Some(true) {
                return None;
            }
            Some(Asset {
                asset,
                price: positive(m, "latest")? * k,
                change: field(m, "dayChange").unwrap_or(0.0),
                volume: field(m, "volumeDst").map_or(0.0, |v| v.max(0.0) * k),
            })
        })
        .collect();
    // Tether (USDT in Toman from usdt-rls) is always offered in Nobitex:
    if !out.iter().any(|a| a.asset == "USDT") {
        if let Some(m) = map.get("usdt-rls") {
            if m["isClosed"].as_bool() != Some(true) {
                if let Some(price) = positive(m, "latest").map(|p| p * 0.1) {
                    out.push(Asset {
                        asset: "USDT".into(),
                        price,
                        change: field(m, "dayChange").unwrap_or(0.0),
                        volume: field(m, "volumeDst").map_or(0.0, |v| v.max(0.0) * 0.1),
                    });
                }
            }
        }
    }
    sort_assets(&mut out);
    out
}

/// `{"s":"ok","t":[…],"o":[…],"h":[…],"l":[…],"c":[…],"v":[…]}` with seconds for time.
pub fn parse_udf(j: &Value) -> Result<Vec<Candle>, Fail> {
    match j["s"].as_str() {
        Some("no_data") => return Ok(Vec::new()),
        Some("ok") => {}
        _ => return Err(Fail::Bad),
    }
    let arr = |k: &str| j[k].as_array();
    let (Some(at), Some(ao), Some(ah), Some(al), Some(ac)) = (arr("t"), arr("o"), arr("h"), arr("l"), arr("c")) else {
        return Err(Fail::Bad);
    };
    let av = arr("v");
    if [ao.len(), ah.len(), al.len(), ac.len()].iter().any(|n| *n != at.len()) || at.len() > 5000 {
        return Err(Fail::Bad);
    }
    let mut out = Vec::with_capacity(at.len());
    for i in 0..at.len() {
        let (Some(secs), Some(o), Some(h), Some(l), Some(c)) =
            (num(&at[i]).filter(|s| *s > 0.0), num(&ao[i]), num(&ah[i]), num(&al[i]), num(&ac[i]))
        else {
            continue;
        };
        let v = av.and_then(|v| v.get(i)).and_then(num).unwrap_or(0.0);
        if let Some(c) = candle(secs as i64 * 1000, o, h, l, c, v) {
            out.push(c);
        }
    }
    Ok(tidy(out))
}

pub fn parse_binance_ticker(j: &Value) -> Option<Ticker> {
    let price = positive(j, "lastPrice")?;
    Some(Ticker {
        price,
        open: positive(j, "openPrice").unwrap_or(price),
        high: positive(j, "highPrice").unwrap_or(price).max(price),
        low: positive(j, "lowPrice").unwrap_or(price).min(price),
        change: field(j, "priceChangePercent").unwrap_or(0.0),
        volume: field(j, "quoteVolume").map_or(0.0, |v| v.max(0.0)),
    })
}

pub fn parse_binance_assets(j: &Value) -> Vec<Asset> {
    let Some(list) = j.as_array() else { return Vec::new() };
    let mut out: Vec<Asset> = list
        .iter()
        .filter_map(|m| {
            let asset = m["symbol"].as_str()?.strip_suffix("USDT")?;
            if !store::valid_asset(asset) || m["count"].as_i64().unwrap_or(0) <= 0 {
                return None;
            }
            Some(Asset {
                asset: asset.to_string(),
                price: positive(m, "lastPrice")?,
                change: field(m, "priceChangePercent").unwrap_or(0.0),
                volume: field(m, "quoteVolume").map_or(0.0, |v| v.max(0.0)),
            })
        })
        .collect();
    sort_assets(&mut out);
    out
}

/// Toobit's 24-hour ticker for one symbol is a list of one:
/// `[{"s":"BTCUSDT","c":last,"h":high,"l":low,"o":open,"qv":quote volume,"pcp":change as a fraction}]`.
pub fn parse_toobit_ticker(j: &Value) -> Option<Ticker> {
    let m = j.as_array()?.first()?;
    let price = positive(m, "c")?;
    Some(Ticker {
        price,
        open: positive(m, "o").unwrap_or(price),
        high: positive(m, "h").unwrap_or(price).max(price),
        low: positive(m, "l").unwrap_or(price).min(price),
        // 0.0107 is 1.07 %.
        change: field(m, "pcp").map_or(0.0, |f| f * 100.0),
        volume: field(m, "qv").map_or(0.0, |v| v.max(0.0)),
    })
}

/// Every USDT market of Toobit. Its list keeps delisted and dead markets: only the ones
/// that traded in the last two days, with some volume, are listed.
pub fn parse_toobit_assets(j: &Value, now: i64) -> Vec<Asset> {
    let Some(list) = j.as_array() else { return Vec::new() };
    let mut out: Vec<Asset> = list
        .iter()
        .filter_map(|m| {
            let asset = m["s"].as_str()?.strip_suffix("USDT")?;
            let fresh = m["t"].as_i64().is_some_and(|t| now - t < 2 * 86_400_000);
            let volume = field(m, "qv").map_or(0.0, |v| v.max(0.0));
            if !store::valid_asset(asset) || !fresh || volume <= 0.0 {
                return None;
            }
            Some(Asset {
                asset: asset.to_string(),
                price: positive(m, "c")?,
                change: field(m, "pcp").map_or(0.0, |f| f * 100.0),
                volume,
            })
        })
        .collect();
    sort_assets(&mut out);
    out
}

/// `[[openTime(ms), "o", "h", "l", "c", "volume", closeTime, …], …]`
pub fn parse_klines(j: &Value) -> Result<Vec<Candle>, Fail> {
    let rows = j.as_array().ok_or(Fail::Bad)?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let r = r.as_array().ok_or(Fail::Bad)?;
        let t = r.first().and_then(Value::as_i64).ok_or(Fail::Bad)?;
        let get = |i: usize| r.get(i).and_then(num);
        let (Some(o), Some(h), Some(l), Some(c)) = (get(1), get(2), get(3), get(4)) else { continue };
        if let Some(c) = candle(t, o, h, l, c, get(5).unwrap_or(0.0)) {
            out.push(c);
        }
    }
    Ok(tidy(out))
}

/// What a non-2xx answer means. The exchange's own text is never passed on.
pub fn failure(status: u16, retry_after: u64, body: &[u8]) -> Option<Fail> {
    if (200..300).contains(&status) {
        return None;
    }
    let parsed = serde_json::from_slice::<Value>(body).ok();
    let code = parsed.as_ref().and_then(|j| j["code"].as_i64());
    // Nobitex says in words that the request's timestamp is too far from its own clock.
    let stale = parsed
        .as_ref()
        .and_then(|j| j["detail"].as_str())
        .is_some_and(|d| d.to_ascii_lowercase().contains("timestamp"));
    Some(match (status, code) {
        // -1107: Toobit's "the access key is missing or not in the right format".
        (_, Some(-2014 | -2015 | -2008 | -1107)) => Fail::InvalidCredentials,
        // Toobit's public market endpoints say it this way when the coin is not listed.
        (_, Some(-100010 | -100011)) => Fail::UnknownAsset,
        (_, Some(-1003)) => Fail::RateLimited(retry_after),
        (_, Some(-1022)) => Fail::InvalidSecret,
        (_, Some(-1021)) => Fail::Clock,
        (429 | 418, _) => Fail::RateLimited(retry_after),
        (401, _) if stale => Fail::Clock,
        (401, _) => Fail::InvalidCredentials,
        (403, _) => Fail::Forbidden,
        (451, _) => Fail::Unavailable,
        (s, _) => Fail::Http(s),
    })
}

// ── Network ───────────────────────────────────────────────────────────────────

struct Reply {
    status: u16,
    body: Vec<u8>,
    retry_after: u64,
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(15))
            .tcp_keepalive(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(15))
            .https_only(true)
            // A redirect could carry a token header to another host.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Arizo-Agent")
            .build()
            .expect("http client")
    })
}

/// A GET with sensitive headers. Errors become codes: the URL, the headers and
/// the exchange's answer never reach a log or the page.
async fn get(url: &str, headers: &[(&'static str, String)]) -> Result<Reply, Fail> {
    let mut last_err = String::new();
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        let mut req = http().get(url);
        for (name, value) in headers {
            let mut v = reqwest::header::HeaderValue::from_str(value).map_err(|_| Fail::Bad)?;
            v.set_sensitive(true);
            req = req.header(*name, v);
        }
        match req.send().await {
            Ok(mut res) => {
                let status = res.status().as_u16();
                let retry_after = res
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.trim().parse::<u64>().ok())
                    .unwrap_or(0);
                let mut body = Vec::new();
                let mut ok = true;
                loop {
                    match res.chunk().await {
                        Ok(Some(chunk)) => {
                            if body.len() + chunk.len() > MAX_BODY {
                                return Err(Fail::Bad);
                            }
                            body.extend_from_slice(&chunk);
                        }
                        Ok(None) => break,
                        Err(e) => {
                            crate::log(&format!("[crypto] chunk error on {url}: {e}"));
                            ok = false;
                            break;
                        }
                    }
                }
                if ok {
                    return Ok(Reply { status, body, retry_after });
                }
            }
            Err(e) => {
                last_err = e.to_string();
                crate::log(&format!("[crypto] attempt {attempt} failed on {url}: {e}"));
            }
        }
    }
    crate::log(&format!("[crypto] network error on {url}: {last_err}"));
    Err(Fail::Network)
}

async fn get_json(url: &str, headers: &[(&'static str, String)]) -> Result<Value, Fail> {
    let r = get(url, headers).await?;
    if let Some(f) = failure(r.status, r.retry_after, &r.body) {
        return Err(f);
    }
    serde_json::from_slice(&r.body).map_err(|_| Fail::Bad)
}

#[derive(Clone)]
struct Creds {
    token: String,
    secret: String,
}

impl Creds {
    fn load(provider: Provider) -> Option<Self> {
        let token = store::crypto_credential(provider.id(), "token");
        let secret = store::crypto_credential(provider.id(), "secret");
        (!token.is_empty() && !secret.is_empty()).then_some(Self { token, secret })
    }

    fn binance_header(&self) -> Vec<(&'static str, String)> {
        vec![("X-MBX-APIKEY", self.token.clone())]
    }

    fn toobit_header(&self) -> Vec<(&'static str, String)> {
        vec![("X-BB-APIKEY", self.token.clone())]
    }
}

/// A signed GET on Nobitex. `target` is the path with its query, exactly as it is sent.
async fn nobitex_get(creds: &Creds, target: &str) -> Result<Value, Fail> {
    let timestamp = (now_ms() / 1000).to_string();
    let signature = sign_nobitex(&creds.secret, &timestamp, "GET", target).ok_or(Fail::InvalidSecret)?;
    let headers = [
        ("Nobitex-Key", creds.token.clone()),
        ("Nobitex-Signature", signature),
        ("Nobitex-Timestamp", timestamp),
    ];
    get_json(&format!("{NOBITEX}{target}"), &headers).await
}

/// Asks the exchange whether these credentials are good, with a read-only call whose
/// answer (a profile, a balance sheet) is thrown away unread.
async fn validate(provider: Provider, creds: &Creds) -> Result<(), Fail> {
    match provider {
        Provider::Nobitex => {
            let j = nobitex_get(creds, "/users/profile").await?;
            if j["status"].as_str() == Some("ok") { Ok(()) } else { Err(Fail::Bad) }
        }
        Provider::Toobit => {
            // Toobit refuses a timestamp more than a second ahead of its own clock: stay a little behind.
            let query = format!("recvWindow=5000&timestamp={}", now_ms() - 1000);
            let url = format!("{TOOBIT}/api/v1/account?{query}&signature={}", sign(&creds.secret, &query));
            let r = get(&url, &creds.toobit_header()).await?;
            match failure(r.status, r.retry_after, &r.body) {
                None => Ok(()),
                Some(f) => Err(f),
            }
        }
        Provider::Binance => {
            let query = format!("omitZeroBalances=true&recvWindow=5000&timestamp={}", now_ms());
            let url = format!("{BINANCE}/api/v3/account?{query}&signature={}", sign(&creds.secret, &query));
            let r = get(&url, &creds.binance_header()).await?;
            match failure(r.status, r.retry_after, &r.body) {
                None => Ok(()),
                Some(f) => Err(f),
            }
        }
    }
}

async fn fetch_ticker(provider: Provider, creds: &Creds, asset: &str, quote: Quote) -> Result<Ticker, Fail> {
    match provider {
        Provider::Nobitex => {
            let target = if asset.eq_ignore_ascii_case("USDT") {
                "/market/stats?srcCurrency=usdt&dstCurrency=rls".to_string()
            } else {
                format!("/market/stats?srcCurrency={}&dstCurrency={}", asset.to_ascii_lowercase(), quote.nobitex_dst())
            };
            let j = nobitex_get(creds, &target).await?;
            if j["status"].as_str() != Some("ok") {
                return Err(Fail::Bad);
            }
            parse_nobitex_ticker(&j, asset, quote).ok_or(Fail::UnknownAsset)
        }
        Provider::Toobit => {
            let url = format!("{TOOBIT}/quote/v1/ticker/24hr?symbol={asset}USDT");
            parse_toobit_ticker(&get_json(&url, &[]).await?).ok_or(Fail::UnknownAsset)
        }
        Provider::Binance => {
            let url = format!("{BINANCE}/api/v3/ticker/24hr?symbol={asset}USDT");
            match get_json(&url, &creds.binance_header()).await {
                // Binance answers an unknown symbol with HTTP 400.
                Err(Fail::Http(400)) => Err(Fail::UnknownAsset),
                other => parse_binance_ticker(&other?).ok_or(Fail::UnknownAsset),
            }
        }
    }
}

async fn fetch_assets(provider: Provider, creds: &Creds, quote: Quote) -> Result<Vec<Asset>, Fail> {
    match provider {
        Provider::Nobitex => {
            let target = format!("/market/stats?dstCurrency={},rls", quote.nobitex_dst());
            let j = nobitex_get(creds, &target).await?;
            if j["status"].as_str() != Some("ok") {
                return Err(Fail::Bad);
            }
            Ok(parse_nobitex_assets(&j, quote))
        }
        Provider::Toobit => {
            let j = get_json(&format!("{TOOBIT}/quote/v1/ticker/24hr"), &[]).await?;
            Ok(parse_toobit_assets(&j, now_ms()))
        }
        Provider::Binance => {
            let j = get_json(&format!("{BINANCE}/api/v3/ticker/24hr"), &creds.binance_header()).await?;
            Ok(parse_binance_assets(&j))
        }
    }
}

async fn fetch_candles(provider: Provider, creds: &Creds, asset: &str, quote: Quote, tf: Timeframe, now: i64) -> Result<Vec<Candle>, Fail> {
    match provider {
        Provider::Nobitex => {
            let to = now / 1000;
            let step_sec = tf.step_ms() / 1000;
            let from = to - (CANDLES as i64 + 2) * step_sec;
            let target = format!(
                "/market/udf/history?symbol={}{}&resolution={}&from={from}&to={to}",
                asset.to_ascii_lowercase(),
                quote.nobitex_suffix().to_ascii_lowercase(),
                tf.nobitex_res()
            );
            parse_udf(&nobitex_get(creds, &target).await?)
        }
        Provider::Toobit => {
            // Same rows as Binance's: [openTime, o, h, l, c, volume, …].
            let url = format!("{TOOBIT}/quote/v1/klines?symbol={asset}USDT&interval={}&limit={CANDLES}", tf.binance_interval());
            parse_klines(&get_json(&url, &[]).await?)
        }
        Provider::Binance => {
            let url = format!("{BINANCE}/api/v3/klines?symbol={asset}USDT&interval={}&limit={CANDLES}", tf.binance_interval());
            parse_klines(&get_json(&url, &creds.binance_header()).await?)
        }
    }
}

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub enabled: bool,
    pub provider: Provider,
    pub asset: String,
    pub quote: Quote,
    pub timeframe: Timeframe,
    pub has_credential: bool,
}

/// What the settings ask for, made consistent: an unknown exchange or an unsupported market
/// falls back to the default, so the poller never has to doubt its inputs.
pub fn plan(s: &Settings, has_credential: impl Fn(Provider) -> bool) -> Plan {
    let provider = Provider::parse(&s.crypto_provider).unwrap_or(Provider::Nobitex);
    let quote = Quote::parse(&s.crypto_quote).filter(|q| provider.supports(*q)).unwrap_or(Quote::Usdt);
    let asset = if store::valid_asset(&s.crypto_asset) { s.crypto_asset.clone() } else { "BTC".into() };
    // Tether has no market against itself: on Nobitex it is the Toman one, whatever was saved.
    let quote = if asset == "USDT" && provider == Provider::Nobitex { Quote::Irt } else { quote };
    let timeframe = Timeframe::parse(&s.crypto_timeframe).unwrap_or(Timeframe::M1);
    Plan { enabled: s.crypto_enabled, provider, asset, quote, timeframe, has_credential: has_credential(provider) }
}

fn stored(provider: Provider) -> bool {
    Creds::load(provider).is_some()
}

fn base_state(p: &Plan) -> CryptoState {
    CryptoState {
        enabled: p.enabled,
        provider: p.provider.id().into(),
        has_credential: p.has_credential,
        phase: if !p.enabled { "off" } else if !p.has_credential { "setup" } else { "connecting" }.into(),
        error: String::new(),
        asset: p.asset.clone(),
        quote: p.quote.id().into(),
        timeframe: p.timeframe.id().into(),
        ticker: None,
        candles: Vec::new(),
        candles_error: String::new(),
        assets: Vec::new(),
        updated_at: 0.0,
        seq: 0,
    }
}

struct Shared {
    /// Bumped when the exchange, the credentials or the switch change: the old poller stops.
    generation: u64,
    /// Bumped when only the coin or the market change: the series starts over.
    selection: u64,
    /// The crypto section is on screen; nothing is read while it is not.
    active: bool,
    plan: Option<Plan>,
    wake: Arc<Notify>,
    state: CryptoState,
}

static SHARED: LazyLock<Mutex<Shared>> = LazyLock::new(|| {
    let plan = Plan { enabled: false, provider: Provider::Nobitex, asset: "BTC".into(), quote: Quote::Usdt, timeframe: Timeframe::M1, has_credential: false };
    Mutex::new(Shared { generation: 0, selection: 0, active: false, plan: None, wake: Arc::new(Notify::new()), state: base_state(&plan) })
});

static SEQ: AtomicU64 = AtomicU64::new(0);

/// Sent while the state lock is held, so the numbers follow the order the states were made in.
fn emit(app: &AppHandle, state: &CryptoState) {
    let mut out = state.clone();
    out.seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    let _ = app.emit_to("island", "crypto", &out);
}

/// The page's own settings follow what a crypto command saved (the tab, the switch).
fn announce_settings(app: &AppHandle) {
    let _ = app.emit("settings-changed", crate::state(app).store.public_settings());
}

fn current(generation: u64) -> bool {
    SHARED.lock().unwrap().generation == generation
}

fn publish(app: &AppHandle, generation: u64, f: impl FnOnce(&mut CryptoState)) {
    let mut s = SHARED.lock().unwrap();
    if s.generation != generation {
        return;
    }
    let before = s.state.clone();
    f(&mut s.state);
    if s.state != before {
        emit(app, &s.state);
    }
}

/// Starts, restarts or stops the poller to match the settings and the stored credentials.
pub fn sync(app: &AppHandle) {
    sync_with(app, false);
}

/// `force` starts afresh even when nothing in the plan changed (new credentials, same exchange).
fn sync_with(app: &AppHandle, force: bool) {
    let settings = crate::state(app).store.settings();
    let wanted = plan(&settings, stored);
    let (generation, wake, start) = {
        let mut s = SHARED.lock().unwrap();
        if let Some(old) = s.plan.clone().filter(|_| !force) {
            if old == wanted {
                return;
            }
            if old.enabled == wanted.enabled
                && old.provider == wanted.provider
                && old.has_credential == wanted.has_credential
                && wanted.enabled
                && wanted.has_credential
            {
                // Only the coin, market or timeframe changed: the session stays, the series starts over.
                s.selection = s.selection.wrapping_add(1);
                if old.quote != wanted.quote {
                    s.state.assets.clear();
                }
                s.plan = Some(wanted.clone());
                s.state.asset = wanted.asset.clone();
                s.state.quote = wanted.quote.id().into();
                s.state.timeframe = wanted.timeframe.id().into();
                s.state.ticker = None;
                s.state.candles.clear();
                s.state.candles_error.clear();
                s.state.error.clear();
                s.state.phase = "connecting".into();
                emit(app, &s.state);
                s.wake.notify_one();
                return;
            }
        }
        s.generation = s.generation.wrapping_add(1);
        s.selection = s.selection.wrapping_add(1);
        s.wake.notify_one();
        s.wake = Arc::new(Notify::new());
        s.plan = Some(wanted.clone());
        s.state = base_state(&wanted);
        emit(app, &s.state);
        (s.generation, s.wake.clone(), wanted.enabled && wanted.has_credential)
    };
    if start {
        let app = app.clone();
        tauri::async_runtime::spawn(run(app, generation, wanted.provider, wake));
    }
}

/// The app is closing: the poller ends, nothing is emitted.
pub fn shutdown() {
    let mut s = SHARED.lock().unwrap();
    s.generation = s.generation.wrapping_add(1);
    s.wake.notify_one();
}

// ── The poller ────────────────────────────────────────────────────────────────

struct Selection {
    id: u64,
    asset: String,
    quote: Quote,
    timeframe: Timeframe,
}

fn snapshot(generation: u64) -> Option<(Selection, bool)> {
    let s = SHARED.lock().unwrap();
    if s.generation != generation {
        return None;
    }
    let quote = Quote::parse(&s.state.quote).unwrap_or(Quote::Usdt);
    let tf = Timeframe::parse(&s.state.timeframe).unwrap_or(Timeframe::M1);
    Some((Selection { id: s.selection, asset: s.state.asset.clone(), quote, timeframe: tf }, s.active))
}

#[derive(Default)]
struct Cache {
    selection: u64,
    list_at: Option<Instant>,
    history_at: Option<Instant>,
    history_minute: i64,
    candles: Vec<Candle>,
    candles_error: String,
    assets: Vec<Asset>,
    assets_quote: Option<Quote>,
}

struct Frame {
    ticker: Ticker,
    candles: Vec<Candle>,
    candles_error: String,
    assets: Vec<Asset>,
}

async fn frame(provider: Provider, creds: &Creds, sel: &Selection, cache: &mut Cache) -> Result<Frame, Fail> {
    if cache.selection != sel.id {
        let keep_assets = cache.assets_quote == Some(sel.quote);
        let assets = if keep_assets { std::mem::take(&mut cache.assets) } else { Vec::new() };
        *cache = Cache { selection: sel.id, assets, assets_quote: Some(sel.quote), ..Cache::default() };
    }
    let now = now_ms();

    let ticker = fetch_ticker(provider, creds, &sel.asset, sel.quote).await?;

    // The list of every coin: a failure here must not spoil the coin on screen.
    if cache.assets.is_empty() || cache.list_at.map_or(true, |t| t.elapsed() >= provider.list_every()) {
        if let Ok(list) = fetch_assets(provider, creds, sel.quote).await {
            cache.assets = list;
            cache.assets_quote = Some(sel.quote);
        }
        cache.list_at = Some(Instant::now());
    }

    let minute = minute_of(now);
    let due = cache.history_at.map_or(true, |t| {
        let age = t.elapsed();
        age >= HISTORY_EVERY || (cache.history_minute != minute && age >= Duration::from_secs(3))
    });
    if due {
        match fetch_candles(provider, creds, &sel.asset, sel.quote, sel.timeframe, now).await {
            Ok(list) => {
                cache.candles_error = if list.is_empty() { "no_candles".into() } else { String::new() };
                cache.candles = list;
            }
            // Keep the older candles; say so only when there are none.
            Err(f) => cache.candles_error = if cache.candles.is_empty() { f.code() } else { String::new() },
        }
        cache.history_at = Some(Instant::now());
        cache.history_minute = minute;
    }
    let mut candles = cache.candles.clone();
    apply_live_timeframe(&mut candles, ticker.price, now, sel.timeframe.step_ms());
    Ok(Frame { ticker, candles, candles_error: cache.candles_error.clone(), assets: cache.assets.clone() })
}

fn publish_frame(app: &AppHandle, generation: u64, selection: u64, f: Frame) {
    let mut s = SHARED.lock().unwrap();
    if s.generation != generation || s.selection != selection {
        return;
    }
    let before = s.state.clone();
    s.state.phase = "live".into();
    s.state.error.clear();
    s.state.ticker = Some(f.ticker);
    s.state.candles = f.candles;
    s.state.candles_error = f.candles_error;
    s.state.assets = f.assets;
    s.state.updated_at = now_ms() as f64;
    if s.state != before {
        emit(app, &s.state);
    }
}

async fn nap(wake: &Notify, d: Duration) {
    tokio::select! {
        _ = wake.notified() => {}
        _ = tokio::time::sleep(d) => {}
    }
}

/// The credentials are wrong or gone: forget them and ask for new ones.
fn rejected(app: &AppHandle, provider: Provider, f: &Fail) {
    let _ = store::clear_crypto_credential(provider.id(), "token");
    let _ = store::clear_crypto_credential(provider.id(), "secret");
    // Brings the plan in line (no credential any more): this ends the poller and clears the prices.
    sync(app);
    let code = f.code();
    let mut s = SHARED.lock().unwrap();
    if s.state.phase == "setup" {
        s.state.error = code;
        emit(app, &s.state);
    }
}

async fn run(app: AppHandle, generation: u64, provider: Provider, wake: Arc<Notify>) {
    let Some(creds) = Creds::load(provider) else { return };
    let mut validated: Option<Instant> = None;
    let mut cache = Cache::default();
    let mut fails = 0u32;
    loop {
        let Some((sel, active)) = snapshot(generation) else { return };
        if !active {
            nap(&wake, IDLE_CHECK).await;
            continue;
        }

        if validated.map_or(true, |t| t.elapsed() >= REVALIDATE_EVERY) {
            match validate(provider, &creds).await {
                Ok(()) => validated = Some(Instant::now()),
                Err(f) if f.rejects_credentials() => {
                    if current(generation) {
                        rejected(&app, provider, &f);
                    }
                    return;
                }
                Err(f) => {
                    fails += 1;
                    let code = f.code();
                    publish(&app, generation, |s| {
                        s.phase = if s.ticker.is_some() { "stale" } else { "connecting" }.into();
                        s.error = code;
                    });
                    let wait = match f {
                        Fail::RateLimited(n) if n > 0 => Duration::from_secs(n.min(300)),
                        _ => backoff(fails),
                    };
                    nap(&wake, wait).await;
                    continue;
                }
            }
            if !current(generation) {
                return;
            }
        }

        let result = frame(provider, &creds, &sel, &mut cache).await;
        if !current(generation) {
            return;
        }
        let wait = match result {
            Ok(f) => {
                fails = 0;
                publish_frame(&app, generation, sel.id, f);
                provider.every()
            }
            Err(Fail::UnknownAsset) if sel.asset != "BTC" => {
                // This exchange has no such coin: go back to the default one.
                let _ = crate::state(&app).store.save_settings(&json!({ "cryptoAsset": "BTC" }));
                announce_settings(&app);
                sync(&app);
                Duration::from_millis(10)
            }
            Err(f) if f.rejects_credentials() => {
                rejected(&app, provider, &f);
                return;
            }
            Err(f) => {
                fails += 1;
                let code = f.code();
                publish(&app, generation, |s| {
                    s.phase = if s.ticker.is_some() { "stale" } else { "connecting" }.into();
                    s.error = code;
                });
                match f {
                    Fail::RateLimited(n) if n > 0 => Duration::from_secs(n.min(300)),
                    _ => backoff(fails),
                }
            }
        };
        nap(&wake, wait).await;
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Only the island and the Settings window may ask; the translation bubble never does.
fn allowed(win: &WebviewWindow) -> Result<(), String> {
    if matches!(win.label(), "island" | "settings") { Ok(()) } else { Err("forbidden".into()) }
}

fn current_state() -> CryptoState {
    let s = SHARED.lock().unwrap();
    let mut out = s.state.clone();
    out.seq = SEQ.load(Ordering::Relaxed);
    out
}

static CONNECTING: AtomicBool = AtomicBool::new(false);

struct Busy;

impl Busy {
    fn take() -> Option<Busy> {
        CONNECTING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| Busy)
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        CONNECTING.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub fn crypto_state(window: WebviewWindow) -> Result<CryptoState, String> {
    allowed(&window)?;
    Ok(current_state())
}

/// Checks the credentials with the exchange; only when it accepts them are they stored
/// and the prices read. The answer carries no secret.
#[tauri::command]
pub async fn crypto_connect(
    app: AppHandle,
    window: WebviewWindow,
    provider: String,
    token: String,
    secret: Option<String>,
) -> Result<CryptoState, String> {
    allowed(&window)?;
    let _busy = Busy::take().ok_or_else(|| "busy".to_string())?;
    let provider = Provider::parse(&provider).ok_or_else(|| "unsupported".to_string())?;
    let token = clean_credential(&token).ok_or_else(|| "invalid_input".to_string())?;
    let secret = match secret.as_deref() {
        None | Some("") => return Err("secret_required".into()),
        Some(s) => clean_credential(s).ok_or_else(|| "invalid_input".to_string())?,
    };
    let creds = Creds { token, secret };

    validate(provider, &creds).await.map_err(|f| f.code())?;

    let kept = store::set_crypto_credential(provider.id(), "token", &creds.token)
        .and_then(|_| store::set_crypto_credential(provider.id(), "secret", &creds.secret));
    if kept.is_err() {
        let _ = store::clear_crypto_credential(provider.id(), "token");
        let _ = store::clear_crypto_credential(provider.id(), "secret");
        return Err("storage_failed".into());
    }
    let saved = crate::state(&app)
        .store
        .save_settings(&json!({ "cryptoProvider": provider.id(), "cryptoEnabled": true }));
    if saved.is_none() {
        return Err("storage_failed".into());
    }
    announce_settings(&app);
    // Forced: the credentials are new even when the exchange is the same one.
    sync_with(&app, true);
    Ok(current_state())
}

/// Forgets the stored credentials of the exchange in use and stops reading prices.
#[tauri::command]
pub fn crypto_disconnect(app: AppHandle, window: WebviewWindow) -> Result<CryptoState, String> {
    allowed(&window)?;
    let provider = Provider::parse(&crate::state(&app).store.settings().crypto_provider).unwrap_or(Provider::Nobitex);
    let token = store::clear_crypto_credential(provider.id(), "token");
    let secret = store::clear_crypto_credential(provider.id(), "secret");
    sync(&app);
    if token.is_err() || secret.is_err() {
        return Err("storage_failed".into());
    }
    Ok(current_state())
}

/// The coin on screen and the market it is read in.
#[tauri::command]
pub fn crypto_select(app: AppHandle, window: WebviewWindow, asset: String, quote: String) -> Result<CryptoState, String> {
    allowed(&window)?;
    let asset = asset.trim().to_ascii_uppercase();
    if !store::valid_asset(&asset) {
        return Err("invalid_input".into());
    }
    let quote = Quote::parse(&quote).ok_or_else(|| "invalid_input".to_string())?;
    let provider = Provider::parse(&crate::state(&app).store.settings().crypto_provider).unwrap_or(Provider::Nobitex);
    if !provider.supports(quote) {
        return Err("unsupported".into());
    }
    crate::state(&app)
        .store
        .save_settings(&json!({ "cryptoAsset": asset, "cryptoQuote": quote.id() }))
        .ok_or_else(|| "storage_failed".to_string())?;
    announce_settings(&app);
    sync(&app);
    Ok(current_state())
}

/// The page says whether the crypto section is on screen: nothing is read while it is not.
#[tauri::command]
pub fn crypto_set_timeframe(app: AppHandle, window: WebviewWindow, timeframe: String) -> Result<CryptoState, String> {
    allowed(&window)?;
    let tf = Timeframe::parse(&timeframe).ok_or_else(|| "invalid_input".to_string())?;
    crate::state(&app)
        .store
        .save_settings(&json!({ "cryptoTimeframe": tf.id() }))
        .ok_or_else(|| "storage_failed".to_string())?;
    announce_settings(&app);
    sync(&app);
    Ok(current_state())
}

#[tauri::command]
pub fn crypto_active(window: WebviewWindow, active: bool) -> Result<(), String> {
    allowed(&window)?;
    let mut s = SHARED.lock().unwrap();
    if s.active != active {
        s.active = active;
        s.wake.notify_one();
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed copies of what the exchanges really answer.
    fn nobitex_stats() -> Value {
        json!({"status":"ok","stats":{
            "btc-usdt":{"isClosed":false,"bestSell":"82470","bestBuy":"82328.39","volumeSrc":"16.0843580615","volumeDst":"1319486.5847352223","latest":"82353.32","mark":"82576.92","dayLow":"80800","dayHigh":"82850","dayOpen":"81515.2","dayClose":"82353.32","dayChange":"1.03"},
            "eth-usdt":{"isClosed":false,"bestSell":"2423.58","bestBuy":"2420.1","volumeSrc":"295.6830466723","volumeDst":"708727.8795600017","latest":"2423.57","mark":"2425.38","dayLow":"2330","dayHigh":"2447.97","dayOpen":"2398.5","dayClose":"2423.57","dayChange":"1.05"},
            "1k_shib-usdt":{"isClosed":false,"volumeDst":"1200.5","latest":"0.0123","dayChange":"-0.4"},
            "old-usdt":{"isClosed":true,"latest":"1","volumeDst":"99999999"},
            "free-usdt":{"isClosed":false,"latest":"0","volumeDst":"5"}
        }})
    }

    fn nobitex_rls() -> Value {
        json!({"status":"ok","stats":{
            "btc-rls":{"isClosed":false,"volumeDst":"1912841384913.010330819","latest":"214800000140","dayLow":"211000000000","dayHigh":"216669980000","dayOpen":"213500000000","dayChange":"0.61"}
        }})
    }

    fn udf() -> Value {
        json!({"s":"ok","t":[1792413780,1792413840,1792413900,1792413960,1792414020],
            "o":[82328.39,82328.39,82340.0,82340.0,82400.0],"h":[82328.39,82328.39,82340.0,82470.0,82400.0],
            "l":[82328.39,82328.39,82340.0,82340.0,82400.0],"c":[82328.39,82328.39,82340.0,82400.0,82400.0],
            "v":[0.0002,0.0,0.000121,0.033408,0.00378963]})
    }

    fn binance_ticker() -> Value {
        json!({"symbol":"BTCUSDT","priceChange":"601.63000000","priceChangePercent":"0.734","lastPrice":"82582.01000000","openPrice":"81980.38000000","highPrice":"83158.00000000","lowPrice":"80684.36000000","volume":"13565.54915000","quoteVolume":"1112997363.86154370","count":2641241})
    }

    #[test]
    fn the_nobitex_ticker_reads_the_selected_market() {
        let t = parse_nobitex_ticker(&nobitex_stats(), "BTC", Quote::Usdt).unwrap();
        assert_eq!(t.price, 82353.32);
        assert_eq!((t.open, t.high, t.low), (81515.2, 82850.0, 80800.0));
        assert_eq!(t.change, 1.03);
        assert_eq!(t.volume, 1319486.5847352223);
        assert!(parse_nobitex_ticker(&nobitex_stats(), "btc", Quote::Usdt).is_some(), "the ticker's case does not matter");
        assert!(parse_nobitex_ticker(&nobitex_stats(), "XYZ", Quote::Usdt).is_none(), "no such market");
        assert!(parse_nobitex_ticker(&nobitex_stats(), "OLD", Quote::Usdt).is_none(), "a closed market has no price");
        assert!(parse_nobitex_ticker(&nobitex_stats(), "FREE", Quote::Usdt).is_none(), "a zero price is no price");
        assert!(parse_nobitex_ticker(&json!({"status":"failed"}), "BTC", Quote::Usdt).is_none());
    }

    #[test]
    fn toman_is_rial_divided_by_ten() {
        let t = parse_nobitex_ticker(&nobitex_rls(), "BTC", Quote::Irt).unwrap();
        assert!((t.price - 21_480_000_014.0).abs() < 1.0);
        assert!((t.high - 21_666_998_000.0).abs() < 1.0);
        assert_eq!(t.change, 0.61, "a percentage is not scaled");
        assert!(parse_nobitex_ticker(&nobitex_rls(), "BTC", Quote::Usdt).is_none(), "the rial market is not the USDT one");
    }

    #[test]
    fn the_nobitex_list_is_sorted_by_volume_and_drops_dead_markets() {
        let list = parse_nobitex_assets(&nobitex_stats(), Quote::Usdt);
        let names: Vec<&str> = list.iter().map(|a| a.asset.as_str()).collect();
        assert_eq!(names, ["BTC", "ETH", "1K_SHIB"], "closed and priceless markets are gone, big volume first");
        assert!(parse_nobitex_assets(&nobitex_stats(), Quote::Irt).is_empty(), "another market, another list");
        assert!(parse_nobitex_assets(&json!({}), Quote::Usdt).is_empty());
    }

    #[test]
    fn udf_candles_come_in_milliseconds_and_in_order() {
        let c = parse_udf(&udf()).unwrap();
        assert_eq!(c.len(), 5);
        assert_eq!(c[0].t, 1_792_413_780_000);
        assert_eq!(c[4].c, 82400.0);
        assert_eq!(c[3].h, 82470.0);
        assert!(c.windows(2).all(|w| w[0].t < w[1].t));
        assert!(c.iter().all(|k| k.h >= k.o.max(k.c) && k.l <= k.o.min(k.c)));
        assert_eq!(parse_udf(&json!({"s":"no_data"})).unwrap(), Vec::<Candle>::new(), "no data is an empty chart, not an error");
        assert_eq!(parse_udf(&json!({"s":"error"})), Err(Fail::Bad));
        assert_eq!(parse_udf(&json!({"s":"ok","t":[1,2],"o":[1],"h":[1],"l":[1],"c":[1]})), Err(Fail::Bad), "arrays must agree");
    }

    #[test]
    fn odd_candles_are_repaired_or_dropped_never_invented() {
        let j = json!({"s":"ok","t":[60,120,180,60,"x"],"o":[10,0,10,12,10],"h":[9,9,11,12,10],"l":[10,9,9,12,10],"c":[10,9,10,12,10],"v":[1,1,-5,1,1]});
        let c = parse_udf(&j).unwrap();
        // t=60 appears twice (the later wins), t=120 has a zero open (dropped), "x" is no time.
        assert_eq!(c.iter().map(|k| k.t).collect::<Vec<_>>(), [60_000, 180_000]);
        assert_eq!(c[0].o, 12.0, "the later duplicate wins");
        assert_eq!((c[1].h, c[1].l, c[1].v), (11.0, 9.0, 0.0), "a wick is widened to the body, a negative volume is zero");
        let many: Vec<Value> = (0..200).map(|i| json!(60 + i * 60)).collect();
        let ones: Vec<Value> = (0..200).map(|_| json!(5)).collect();
        let big = json!({"s":"ok","t":many,"o":ones,"h":ones,"l":ones,"c":ones});
        let kept = parse_udf(&big).unwrap();
        assert_eq!(kept.len(), CANDLES);
        assert_eq!(kept.last().unwrap().t, (60 + 199 * 60) * 1000, "the newest are kept");
    }

    #[test]
    fn binance_answers_are_read_as_they_come() {
        let t = parse_binance_ticker(&binance_ticker()).unwrap();
        assert_eq!((t.price, t.open, t.high, t.low, t.change), (82582.01, 81980.38, 83158.0, 80684.36, 0.734));
        assert_eq!(t.volume, 1112997363.8615437);
        assert!(parse_binance_ticker(&json!({"symbol":"X"})).is_none());

        let list = parse_binance_assets(&json!([
            {"symbol":"ETHBTC","lastPrice":"0.03","count":5,"quoteVolume":"1"},
            {"symbol":"ETHUSDT","lastPrice":"2400","count":5,"quoteVolume":"900","priceChangePercent":"1.5"},
            {"symbol":"BTCUSDT","lastPrice":"82000","count":9,"quoteVolume":"5000","priceChangePercent":"-0.2"},
            {"symbol":"DEADUSDT","lastPrice":"1","count":0,"quoteVolume":"0"},
            {"symbol":"bad!USDT","lastPrice":"1","count":3,"quoteVolume":"3"}
        ]));
        assert_eq!(list.iter().map(|a| a.asset.as_str()).collect::<Vec<_>>(), ["BTC", "ETH"]);

        let k = parse_klines(&json!([
            [1792413660000i64,"82632.00","82632.00","82578.00","82586.00","8.52306",1792413719999i64,"703984.98",1055,"4.7","390859","0"],
            [1792413720000i64,"82586.00","82608.89","82586.00","82590.00","7.59053",1792413779999i64,"626975.64",902,"5.6","463817","0"]
        ])).unwrap();
        assert_eq!(k.len(), 2);
        assert_eq!((k[1].t, k[1].o, k[1].h, k[1].l, k[1].c, k[1].v), (1_792_413_720_000, 82586.0, 82608.89, 82586.0, 82590.0, 7.59053));
        assert_eq!(parse_klines(&json!({"code":-1121})), Err(Fail::Bad));
    }

    #[test]
    fn the_live_price_moves_only_the_current_minute() {
        let now = 1_792_414_050_000;
        let mut c = vec![Candle { t: minute_of(now), o: 100.0, h: 101.0, l: 99.0, c: 100.5, v: 1.0 }];
        apply_live(&mut c, 102.0, now);
        assert_eq!((c[0].c, c[0].h, c[0].l, c[0].o), (102.0, 102.0, 99.0, 100.0));
        apply_live(&mut c, 98.0, now);
        assert_eq!((c[0].c, c[0].h, c[0].l), (98.0, 102.0, 98.0));
        // The minute has turned and the exchange has not listed it yet: it opens at the last close.
        let mut old = vec![Candle { t: minute_of(now) - 60_000, o: 1.0, h: 1.0, l: 1.0, c: 2.0, v: 0.0 }];
        apply_live(&mut old, 5.0, now);
        assert_eq!(old[0].c, 2.0, "an older candle is history: the live price does not touch it");
        assert_eq!(old.len(), 2);
        assert_eq!((old[1].t, old[1].o, old[1].h, old[1].l, old[1].c), (minute_of(now), 2.0, 5.0, 2.0, 5.0));
        // A full chart drops its oldest candle for the new one.
        let mut full: Vec<Candle> = (0..CANDLES as i64).map(|i| Candle { t: minute_of(now) - (CANDLES as i64 - i) * 60_000, o: 1.0, h: 1.0, l: 1.0, c: 1.0, v: 0.0 }).collect();
        let first = full[0].t;
        apply_live(&mut full, 1.5, now);
        assert_eq!(full.len(), CANDLES);
        assert!(full[0].t > first && full.last().unwrap().t == minute_of(now));
        // Nothing is invented: an empty history stays empty, and a bad price changes nothing.
        let mut none: Vec<Candle> = Vec::new();
        apply_live(&mut none, 5.0, now);
        assert!(none.is_empty());
        let mut same = vec![Candle { t: minute_of(now), o: 1.0, h: 1.0, l: 1.0, c: 1.0, v: 0.0 }];
        apply_live(&mut same, f64::NAN, now);
        apply_live(&mut same, -3.0, now);
        assert_eq!(same[0].c, 1.0);
    }

    #[test]
    fn answers_become_short_codes_and_never_the_exchanges_own_words() {
        assert_eq!(failure(200, 0, b"{}"), None);
        assert_eq!(failure(401, 0, br#"{"detail":"x"}"#), Some(Fail::InvalidCredentials));
        assert_eq!(failure(401, 0, br#"{"code":-2014,"msg":"API-key format invalid."}"#), Some(Fail::InvalidCredentials));
        assert_eq!(failure(401, 0, br#"{"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}"#), Some(Fail::InvalidCredentials));
        assert_eq!(failure(400, 0, br#"{"code":-1022,"msg":"Signature for this request is not valid."}"#), Some(Fail::InvalidSecret));
        assert_eq!(failure(400, 0, br#"{"code":-1021,"msg":"Timestamp outside recvWindow"}"#), Some(Fail::Clock));
        assert_eq!(failure(429, 17, b""), Some(Fail::RateLimited(17)));
        assert_eq!(failure(418, 0, b""), Some(Fail::RateLimited(0)));
        assert_eq!(failure(403, 0, b"<html>"), Some(Fail::Forbidden));
        // Nobitex: a wrong key or signature and a skewed PC clock are both 401, told apart by its words.
        assert_eq!(failure(401, 0, br#"{"detail":"API key is invalid."}"#), Some(Fail::InvalidCredentials));
        assert_eq!(
            failure(401, 0, br#"{"detail":"The timestamp value difference from now is more than 30 seconds."}"#),
            Some(Fail::Clock)
        );
        assert!(!Fail::Clock.rejects_credentials(), "a wrong clock must never wipe good credentials");
        assert_eq!(failure(451, 0, b""), Some(Fail::Unavailable));
        assert_eq!(failure(503, 0, b"<html>"), Some(Fail::Http(503)));
        assert_eq!(failure(410, 0, b"<html>Gone</html>").unwrap().code(), "http_410");
        for f in [Fail::Network, Fail::RateLimited(9), Fail::InvalidCredentials, Fail::InvalidSecret, Fail::Forbidden, Fail::Unavailable, Fail::Clock, Fail::Bad, Fail::UnknownAsset, Fail::Http(500)] {
            let c = f.code();
            assert!(!c.is_empty() && c.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'), "{c}");
        }
        assert!(Fail::InvalidCredentials.rejects_credentials() && Fail::InvalidSecret.rejects_credentials());
        assert!(!Fail::Network.rejects_credentials() && !Fail::RateLimited(0).rejects_credentials() && !Fail::Forbidden.rejects_credentials());
    }

    #[test]
    fn toobit_answers_are_read_as_they_come() {
        // Trimmed copies of what api.toobit.com answers.
        let one = json!([{"t":1792420939066i64,"s":"BTCUSDT","c":"81998.01","h":"83158","l":"80689.19","o":"81132.68","b":"81998","a":"81998.01","v":"6414.60226","qv":"526846618.8443812","pc":"865.33","pcp":"0.0107"}]);
        let t = parse_toobit_ticker(&one).unwrap();
        assert_eq!((t.price, t.open, t.high, t.low), (81998.01, 81132.68, 83158.0, 80689.19));
        assert!((t.change - 1.07).abs() < 1e-9, "a fraction becomes a percent: {}", t.change);
        assert_eq!(t.volume, 526846618.8443812);
        assert!(parse_toobit_ticker(&json!([])).is_none() && parse_toobit_ticker(&json!({"code":-100011})).is_none());
        assert!(parse_toobit_ticker(&json!([{"s":"XUSDT","c":"0"}])).is_none(), "no price, no ticker");

        let now = 1792420939066i64;
        let all = json!([
            {"t":now,"s":"ETHUSDT","c":"2423.5","qv":"900000","pcp":"-0.0123"},
            {"t":now - 1000,"s":"BTCUSDT","c":"81998.01","qv":"526846618","pcp":"0.0107"},
            {"t":1723115270771i64,"s":"GRDRUSDT","c":"0.38","qv":"10457","pcp":"0"},
            {"t":now,"s":"QUIETUSDT","c":"1","qv":"0","pcp":"0"},
            {"t":now,"s":"BTCUSDC","c":"81998","qv":"5","pcp":"0"},
            {"t":now,"s":"1000SATSUSDT","c":"0.0004","qv":"70","pcp":"0.5"}
        ]);
        let list = parse_toobit_assets(&all, now);
        let names: Vec<&str> = list.iter().map(|a| a.asset.as_str()).collect();
        assert_eq!(names, ["BTC", "ETH", "1000SATS"], "sorted by volume; dead, silent and other-quote markets dropped");
        assert!((list[1].change + 1.23).abs() < 1e-9);
        assert!(parse_toobit_assets(&json!({"x":1}), now).is_empty());
        // The candle rows have Binance's shape.
        let k = parse_klines(&json!([[1792420800000i64,"81934.01","82012.01","81924","82011.04","6.30496",0,"516702.45",30,"4.151","340157.53"]])).unwrap();
        assert_eq!((k[0].t, k[0].o, k[0].h, k[0].l, k[0].c, k[0].v), (1792420800000, 81934.01, 82012.01, 81924.0, 82011.04, 6.30496));
        assert_eq!(Provider::parse("toobit"), Some(Provider::Toobit));
        assert!(Provider::Toobit.supports(Quote::Usdt) && !Provider::Toobit.supports(Quote::Irt));
        assert_eq!(failure(400, 0, br#"{"code":-1107,"msg":"The accessKey is missing"}"#), Some(Fail::InvalidCredentials));
        assert_eq!(failure(400, 0, br#"{"code":-100011,"msg":"Not supported symbols"}"#), Some(Fail::UnknownAsset));
        assert_eq!(failure(400, 0, br#"{"code":-1003,"msg":"TOO_MANY_REQUESTS"}"#), Some(Fail::RateLimited(0)));
    }

    #[test]
    fn nobitex_requests_are_signed_with_ed25519() {
        // The private key 1..=32, signed over "1760000000GET/users/profile" by an independent
        // implementation (Node's crypto): Ed25519 is deterministic, so the text must match exactly.
        let seed = URL_SAFE.encode((1u8..=32).collect::<Vec<_>>());
        assert_eq!(seed, "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=");
        let want = "-nLm1aRBhnso7iLc9bWP8_wWWbxpTBrlpTKtBdC1c0RG9__7qdqs6Rgd9-O6MJ7Ssobw_yNcMW4Y7Z1POq3UAQ==";
        assert_eq!(sign_nobitex(&seed, "1760000000", "GET", "/users/profile").as_deref(), Some(want));
        // The query string is part of what is signed.
        assert_ne!(sign_nobitex(&seed, "1760000000", "GET", "/users/profile?a=1").unwrap(), want);
        // The private key may be pasted without its padding, or in the standard alphabet.
        assert_eq!(sign_nobitex(seed.trim_end_matches('='), "1760000000", "GET", "/users/profile").as_deref(), Some(want));
        // Anything that is not 32 bytes of Base64 is refused, not signed.
        assert_eq!(sign_nobitex("not base64!", "1", "GET", "/"), None);
        assert_eq!(sign_nobitex("AQID", "1", "GET", "/"), None);
        assert_eq!(sign_nobitex("", "1", "GET", "/"), None);
    }

    #[test]
    fn signatures_match_the_published_vectors() {
        // RFC 4231, test case 2.
        assert_eq!(sign("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
        // Binance's own documentation example.
        assert_eq!(
            sign(
                "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j",
                "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559"
            ),
            "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"
        );
    }

    #[test]
    fn credentials_must_look_like_credentials() {
        assert_eq!(clean_credential("  abc123DEF-_.~+/=  ").as_deref(), Some("abc123DEF-_.~+/="));
        for bad in ["", "   ", "a b", "tok\nen", "tok\ren", "é", "a;b", "a\"b", "a,b"] {
            assert_eq!(clean_credential(bad), None, "{bad:?}");
        }
        assert_eq!(clean_credential(&"a".repeat(257)), None);
        assert!(clean_credential(&"a".repeat(256)).is_some());
    }

    #[test]
    fn the_wait_after_a_failure_grows_to_a_minute() {
        let secs: Vec<u64> = (1..=8).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(secs, [3, 6, 12, 24, 48, 48, 48, 48]);
        assert_eq!(backoff(0).as_secs(), 3);
        assert!(backoff(u32::MAX) <= Duration::from_secs(60));
    }

    #[test]
    fn the_plan_follows_the_settings_and_never_doubts_them() {
        let mut s = Settings::default();
        let none = |_: Provider| false;
        let p = plan(&s, none);
        assert_eq!((p.enabled, p.provider, p.asset.as_str(), p.quote, p.timeframe, p.has_credential), (true, Provider::Nobitex, "BTC", Quote::Usdt, Timeframe::M1, false));
        assert_eq!(base_state(&p).phase, "setup", "no credential: nothing is shown but the setup");
        assert_eq!(base_state(&plan(&s, |_| true)).phase, "connecting");
        s.crypto_enabled = false;
        assert_eq!(base_state(&plan(&s, |_| true)).phase, "off");
        s.crypto_enabled = true;
        s.crypto_provider = "binance".into();
        s.crypto_quote = "IRT".into();
        let b = plan(&s, |p| p == Provider::Binance);
        assert_eq!((b.provider, b.quote, b.timeframe, b.has_credential), (Provider::Binance, Quote::Usdt, Timeframe::M1, true), "Binance has no Toman market");
        s.crypto_provider = "nobitex".into();
        assert_eq!(plan(&s, none).quote, Quote::Irt, "Nobitex keeps it");
        s.crypto_provider = "mystery".into();
        assert_eq!(plan(&s, none).provider, Provider::Nobitex);
        s.crypto_asset = "bad coin".into();
        assert_eq!(plan(&s, none).asset, "BTC");
        // Tether is read in Toman on Nobitex even when USDT was the saved market.
        s.crypto_asset = "USDT".into();
        s.crypto_quote = "USDT".into();
        assert_eq!(plan(&s, none).quote, Quote::Irt);
        s.crypto_asset = "BTC".into();
        assert_eq!(plan(&s, none).quote, Quote::Usdt);
    }

    #[test]
    fn a_fresh_state_carries_no_prices() {
        let st = base_state(&plan(&Settings::default(), |_| false));
        assert!(st.ticker.is_none() && st.candles.is_empty() && st.assets.is_empty());
        assert_eq!(st.updated_at, 0.0);
        let text = serde_json::to_string(&st).unwrap();
        assert!(text.contains("\"hasCredential\":false") && text.contains("\"phase\":\"setup\""));
        for forbidden in ["token", "secret", "apiKey", "Authorization"] {
            assert!(!text.contains(forbidden), "{forbidden} must never be in the state the page gets");
        }
    }
}
