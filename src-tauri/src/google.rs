// The instant engine: Google Translate's free endpoint, with MyMemory as a
// second chance. No API key, long text is chunked automatically.

use std::time::Duration;

use reqwest::Client;
use serde_json::Value;

use crate::idioms::enhance_translation;
use crate::langs::{detect, normalize_code, resolve_target};
use crate::model::{Alternative, TranslationData};
use crate::textutil::split_text;

const GOOGLE_ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";
const GOOGLE_UA: &str = "GoogleTranslate/6.28.0.RC05.358249487 (Linux; U; Android 10; Pixel 4)";
const GOOGLE_CHUNK: usize = 4500;
const MYMEMORY_CHUNK: usize = 450;
const TIMEOUT: Duration = Duration::from_secs(8);

pub const NETWORK_FAILED: &str = "NETWORK_FAILED";

async fn google_request(client: &Client, chunk: String, sl: &str, tl: &str) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(
        GOOGLE_ENDPOINT,
        &[("client", "at"), ("sl", if sl.is_empty() { "auto" } else { sl }), ("tl", tl), ("dt", "t"), ("dt", "bd"), ("dt", "rm")],
    )
    .map_err(|e| e.to_string())?;

    let mut last = String::new();
    for attempt in 0..2 {
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
        if attempt == 0 {
            tokio::time::sleep(Duration::from_millis(250)).await;
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

    let guess = detect(text);
    let tl = resolve_target(target_lang, &guess, native, second);
    let sl = guess.clone();

    let chunks = split_text(text, GOOGLE_CHUNK);
    let single = chunks.len() == 1;

    let attempt: Result<Vec<Parsed>, String> = async {
        let handles: Vec<_> = chunks
            .into_iter()
            .map(|c| {
                let (client, sl, tl) = (client.clone(), sl.clone(), tl.clone());
                tokio::spawn(async move { google_request(&client, c, &sl, &tl).await })
            })
            .collect();
        let mut out = Vec::new();
        for h in handles {
            let v = h.await.map_err(|e| e.to_string())??;
            out.push(parse_google(&v));
        }
        Ok(out)
    }
    .await;

    match attempt {
        Ok(parsed) => {
            let raw: String = parsed.iter().map(|p| p.translation.as_str()).collect::<String>().trim().to_string();
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

/// MyMemory accepts about 500 characters per request, so it chunks small.
async fn fallback_mymemory(client: &Client, text: &str, target: &str, source: &str) -> Result<TranslationData, String> {
    let mut out = String::new();
    for chunk in split_text(text, MYMEMORY_CHUNK) {
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
        if t.trim().is_empty() {
            return Err(NETWORK_FAILED.into());
        }
        out.push_str(&t);
    }
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
    fn tolerates_missing_parts() {
        let p = parse_google(&json!([]));
        assert_eq!(p.translation, "");
        assert!(p.alternatives.is_empty());
        let p = parse_google(&json!(null));
        assert_eq!(p.detected, "");
    }
}
