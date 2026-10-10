// Speech. Windows ships no Persian voice, so `speechSynthesis` is silent for
// Farsi; Google's text-to-speech endpoint speaks every language in the catalogue.

use std::time::Duration;

use base64::Engine;
use reqwest::Client;

use crate::langs::normalize_code;
use crate::textutil::split_text;

const MAX_CHUNKS: usize = 4;
const CHUNK_SIZE: usize = 180;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

/// Base64 MP3 of `text` spoken in `lang`.
pub async fn synthesize(client: &Client, text: &str, lang: &str) -> Result<String, String> {
    let tl = match normalize_code(lang) {
        l if l.is_empty() => "en".to_string(),
        l => l,
    };
    let mut audio: Vec<u8> = Vec::new();
    for chunk in split_text(text.trim(), CHUNK_SIZE).into_iter().take(MAX_CHUNKS) {
        if chunk.trim().is_empty() {
            continue;
        }
        let url = reqwest::Url::parse_with_params(
            "https://translate.google.com/translate_tts",
            &[("ie", "UTF-8"), ("client", "tw-ob"), ("tl", tl.as_str()), ("q", chunk.as_str())],
        )
        .map_err(|e| e.to_string())?;
        let res = client
            .get(url)
            .header("User-Agent", UA)
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("TTS HTTP {}", res.status().as_u16()));
        }
        audio.extend_from_slice(&res.bytes().await.map_err(|e| e.to_string())?);
    }
    if audio.is_empty() {
        return Err("Nothing to speak".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(audio))
}
