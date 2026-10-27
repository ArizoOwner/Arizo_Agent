// The instant engine: Google Translate's free endpoint, with MyMemory as a
// second chance. No API key, long text is chunked automatically.

use std::time::Duration;

use reqwest::Client;
use serde_json::Value;

use crate::idioms::enhance_translation;
use crate::langs::{ambiguous_latin_guess, detect, normalize_code, resolve_target};
use crate::model::{Alternative, TranslationData};
use crate::textutil::{join_translations, split_text};

const GOOGLE_ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";
const GOOGLE_UA: &str = "GoogleTranslate/6.28.0.RC05.358249487 (Linux; U; Android 10; Pixel 4)";
/// Small enough that one piece is quick and Google never shortens its answer, large enough
/// that a page is a handful of requests.
const GOOGLE_CHUNK: usize = 1800;
/// A piece Google refused is tried again in pieces this small.
const GOOGLE_SMALL_CHUNK: usize = 500;
/// Pieces asked for at the same time: Google answers "429 too many" to a burst.
const GOOGLE_AT_ONCE: usize = 4;
const MYMEMORY_CHUNK: usize = 450;
const TIMEOUT: Duration = Duration::from_secs(12);

pub const NETWORK_FAILED: &str = "NETWORK_FAILED";

async fn google_request(client: &Client, chunk: String, sl: &str, tl: &str) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(
        GOOGLE_ENDPOINT,
        &[("client", "at"), ("sl", if sl.is_empty() { "auto" } else { sl }), ("tl", tl), ("dt", "t"), ("dt", "bd"), ("dt", "rm")],
    )
    .map_err(|e| e.to_string())?;

    let mut last = String::new();
    for attempt in 0..3 {
        let res = client
            .post(url.clone())
            .header("User-Agent", GOOGLE_UA)
            .form(&[("q", chunk.as_str())])
            .timeout(TIMEOUT)
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => return Ok(v),
                Err(e) => last = e.to_string(),
            },
            Ok(r) => last = format!("Google HTTP {}", r.status().as_u16()),
            Err(e) => last = e.to_string(),
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))).await;
        }
    }
    Err(last)
}

struct Parsed {
    translation: String,
    translit: String,
    alternatives: Vec<Alternative>,
    detected: String,
}

fn parse_google(data: &Value) -> Parsed {
    let mut translation = String::new();
    let mut translit = String::new();
    if let Some(parts) = data.get(0).and_then(Value::as_array) {
        for part in parts {
            let Some(part) = part.as_array() else { continue };
            if let Some(t) = part.first().and_then(Value::as_str) {
                translation.push_str(t);
            } else if let Some(r) = part.get(2).and_then(Value::as_str) {
                translit.push_str(r);
            }
        }
    }

    let mut alternatives = Vec::new();
    if let Some(items) = data.get(1).and_then(Value::as_array) {
        for item in items {
            let pos = item.get(0).and_then(Value::as_str).unwrap_or("").to_string();
            let terms: Vec<String> = item
                .get(1)
                .and_then(Value::as_array)
                .map(|t| t.iter().filter_map(Value::as_str).take(6).map(str::to_string).collect())
                .unwrap_or_default();
            if !terms.is_empty() {
                alternatives.push(Alternative { pos, terms });
            }
        }
    }

    Parsed {
        translation,
        translit: translit.trim().to_string(),
        alternatives,
        detected: normalize_code(data.get(2).and_then(Value::as_str).unwrap_or("")),
    }
}

/// One piece. A piece Google refuses, or answers with nothing for, is tried again cut into
/// smaller pieces, so one bad piece costs a little time instead of the whole text.
async fn google_piece(client: &Client, chunk: String, sl: &str, tl: &str) -> Result<Parsed, String> {
    let first = google_request(client, chunk.clone(), sl, tl).await.map(|v| parse_google(&v));
    match first {
        Ok(p) if !p.translation.trim().is_empty() => Ok(p),
        _ if chunk.chars().count() > GOOGLE_SMALL_CHUNK => {
            let parts = split_text(&chunk, GOOGLE_SMALL_CHUNK);
            let mut translations = Vec::with_capacity(parts.len());
            let mut detected = String::new();
            for part in &parts {
                let v = google_request(client, part.clone(), sl, tl).await?;
                let p = parse_google(&v);
                if p.translation.trim().is_empty() && !part.trim().is_empty() {
                    return Err("Google returned nothing".into());
                }
                if detected.is_empty() {
                    detected = p.detected;
                }
                translations.push(p.translation);
            }
            Ok(Parsed { translation: join_translations(&parts, &translations), translit: String::new(), alternatives: Vec::new(), detected })
        }
        Ok(p) => Ok(p),
        Err(e) => Err(e),
    }
}

/// Every piece, a few at a time, in order. Any piece that still fails fails them all:
/// half a translation must never be shown as the whole.
async fn google_chunks(client: &Client, chunks: &[String], sl: &str, tl: &str) -> Result<Vec<Parsed>, String> {
    use futures_util::stream::{self, StreamExt, TryStreamExt};
    stream::iter(chunks.iter().cloned().map(|c| google_piece(client, c, sl, tl)))
        .buffered(GOOGLE_AT_ONCE)
        .try_collect()
        .await
}

/// Translate `text` into `target_lang` (`auto` picks native ⇄ second).
pub async fn translate(
    client: &Client,
    text: &str,
    target_lang: &str,
    native: &str,
    second: &str,
) -> Result<TranslationData, String> {
    if text.trim().is_empty() {
        return Ok(TranslationData {
            detected_lang: "en".into(),
            target_lang: "fa".into(),
            engine: "google".into(),
            ..Default::default()
        });
    }

    let mut guess = detect(text);
    let mut tl = resolve_target(target_lang, &guess, native, second);
    // "en" is only a Latin-script guess here: let Google detect the source and
    // re-aim the target when it says the text is already in the language we picked.
    let auto_target = target_lang.is_empty() || target_lang == "auto";
    let ambiguous = auto_target && ambiguous_latin_guess(&guess, native, second);

    let chunks = split_text(text, GOOGLE_CHUNK);
    let single = chunks.len() == 1;

    let mut attempt = google_chunks(client, &chunks, if ambiguous { "" } else { &guess }, &tl).await;
    if ambiguous {
        let detected = attempt.as_ref().ok().map(|p| p[0].detected.clone()).unwrap_or_default();
        if !detected.is_empty() {
            let again = resolve_target(target_lang, &detected, native, second);
            guess = detected;
            if again != tl {
                tl = again;
                attempt = google_chunks(client, &chunks, "", &tl).await;
            }
        }
    }
    let sl = guess.clone();

    match attempt {
        Ok(parsed) => {
            let translations: Vec<String> = parsed.iter().map(|p| p.translation.clone()).collect();
            let raw = join_translations(&chunks, &translations).trim().to_string();
            if raw.is_empty() {
                return fallback_mymemory(client, text, &tl, &guess).await;
            }
            let first = &parsed[0];
            Ok(TranslationData {
                translation: enhance_translation(&raw, text, &sl, &tl),
                translit: if single { first.translit.clone() } else { String::new() },
                alternatives: if single { first.alternatives.clone() } else { Vec::new() },
                detected_lang: if first.detected.is_empty() { guess } else { first.detected.clone() },
                target_lang: tl,
                engine: "google".into(),
                ..Default::default()
            })
        }
        Err(_) => fallback_mymemory(client, text, &tl, &guess).await,
    }
}

/// MyMemory reports quota and language errors inside an HTTP 200 answer, with the
/// message as the "translation".
fn mymemory_ok(json: &Value, translated: &str) -> bool {
    let st = &json["responseStatus"];
    let status = st.as_i64().or_else(|| st.as_str().and_then(|s| s.trim().parse().ok())).unwrap_or(200);
    status == 200 && !translated.starts_with("MYMEMORY WARNING") && !translated.starts_with("PLEASE SELECT")
}

/// The most MyMemory is asked to do: its free allowance is about 5000 characters a day, so a
/// long text would use it up part of the way through and come back half translated.
const MYMEMORY_MAX: usize = 1500;

/// MyMemory accepts about 500 characters per request, so it chunks small.
async fn fallback_mymemory(client: &Client, text: &str, target: &str, source: &str) -> Result<TranslationData, String> {
    if text.chars().count() > MYMEMORY_MAX {
        return Err(NETWORK_FAILED.into());
    }
    let chunks = split_text(text, MYMEMORY_CHUNK);
    let mut translated: Vec<String> = Vec::new();
    for chunk in &chunks {
        let pair = format!("{source}|{target}");
        let url = reqwest::Url::parse_with_params(
            "https://api.mymemory.translated.net/get",
            &[("q", chunk.as_str()), ("langpair", pair.as_str())],
        )
        .map_err(|e| e.to_string())?;
        let res = client.get(url).timeout(TIMEOUT).send().await.map_err(|_| NETWORK_FAILED.to_string())?;
        if !res.status().is_success() {
            return Err(NETWORK_FAILED.into());
        }
        let json: Value = res.json().await.map_err(|_| NETWORK_FAILED.to_string())?;
        let t = json["responseData"]["translatedText"].as_str().unwrap_or("").to_string();
        if t.trim().is_empty() || !mymemory_ok(&json, &t) {
            return Err(NETWORK_FAILED.into());
        }
        translated.push(t);
    }
    let out = join_translations(&chunks, &translated);
    let raw = out.trim();
    Ok(TranslationData {
        translation: enhance_translation(raw, text, source, target),
        detected_lang: source.to_string(),
        target_lang: target.to_string(),
        engine: "mymemory".into(),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_translation_translit_and_dictionary() {
        let data = json!([
            [["سلام ", "Hello ", null, null, 1], ["دنیا", "world", null, null, 1], [null, null, "salam donya"]],
            [["noun", ["greeting", "salutation", "hello", "hi", "hey", "howdy", "extra"], null, null, 1]],
            "en"
        ]);
        let p = parse_google(&data);
        assert_eq!(p.translation, "سلام دنیا");
        assert_eq!(p.translit, "salam donya");
        assert_eq!(p.detected, "en");
        assert_eq!(p.alternatives.len(), 1);
        assert_eq!(p.alternatives[0].pos, "noun");
        assert_eq!(p.alternatives[0].terms.len(), 6, "at most six terms per part of speech");
    }

    #[test]
    fn mymemory_errors_inside_a_200_are_not_translations() {
        assert!(mymemory_ok(&json!({ "responseStatus": 200 }), "سلام"));
        assert!(mymemory_ok(&json!({ "responseStatus": "200" }), "سلام"));
        assert!(mymemory_ok(&json!({}), "سلام"));
        assert!(!mymemory_ok(&json!({ "responseStatus": 429 }), "x"));
        assert!(!mymemory_ok(&json!({ "responseStatus": "403" }), "x"));
        assert!(!mymemory_ok(&json!({ "responseStatus": 200 }), "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS"));
        assert!(!mymemory_ok(&json!({}), "PLEASE SELECT TWO DISTINCT LANGUAGES"));
    }

    /// Against the real service: `cargo test --lib -- --ignored google`.
    #[tokio::test]
    #[ignore]
    async fn a_long_text_comes_back_whole() {
        let client = Client::new();
        let text = (1..=60)
            .map(|i| format!("Paragraph {i}. The quick brown fox jumps over the lazy dog, and then it runs into the forest to find its friends."))
            .collect::<Vec<_>>()
            .join("\n\n");
        assert!(text.chars().count() > 6000);
        let r = translate(&client, &text, "fa", "fa", "en").await.expect("translated");
        assert_eq!(r.engine, "google");
        assert!(split_text(&text, GOOGLE_CHUNK).len() > 1, "the text really goes in pieces");
        let paras = r.translation.split("\n\n").filter(|p| !p.trim().is_empty()).count();
        assert_eq!(paras, 60, "every paragraph is translated and keeps its own line, none glued to the next");
        assert!(r.translation.contains("۶۰") || r.translation.contains("60"), "the last paragraph is there");
    }

    /// Persian into English, a long run with few full stops: `cargo test --lib -- --ignored google`.
    #[tokio::test]
    #[ignore]
    async fn a_long_persian_text_comes_back_whole() {
        let client = Client::new();
        let text = (1..=50)
            .map(|i| format!("بند {i}، امروز هوا خیلی خوب بود و ما با دوستانمان به پارک رفتیم، آنجا بازی کردیم و بعد به خانه برگشتیم"))
            .collect::<Vec<_>>()
            .join("\n");
        let r = translate(&client, &text, "en", "fa", "en").await.expect("translated");
        let lines = r.translation.lines().filter(|l| !l.trim().is_empty()).count();
        assert_eq!(lines, 50, "every line is translated and keeps its own line");
        assert!(r.translation.contains("50"), "the last line is there");
    }

    #[test]
    fn tolerates_missing_parts() {
        let p = parse_google(&json!([]));
        assert_eq!(p.translation, "");
        assert!(p.alternatives.is_empty());
        let p = parse_google(&json!(null));
        assert_eq!(p.detected, "");
    }
}
