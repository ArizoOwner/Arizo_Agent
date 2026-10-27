// The orchestrator: cache → engine → graceful fallback → history.

use std::sync::Mutex;

use reqwest::Client;

use crate::aphra::{self, AiConfig, AiError};
use crate::google;
use crate::model::{Reply, TranslationData, Warning};
use crate::store::{api_key, HistoryItem, Store};

const CACHE_LIMIT: usize = 200;

#[derive(Default)]
pub struct Translator {
    cache: Mutex<Vec<(String, TranslationData)>>, // oldest first: a cheap LRU
}

pub struct Request {
    pub request_id: u64,
    pub text: String,
    pub engine: String,
    pub tone: Option<String>,
    pub target_lang: String,
}

impl Translator {
    fn cache_get(&self, key: &str) -> Option<TranslationData> {
        let mut cache = self.cache.lock().unwrap();
        let at = cache.iter().position(|(k, _)| k == key)?;
        let entry = cache.remove(at);
        let value = entry.1.clone();
        cache.push(entry);
        Some(value)
    }

    fn cache_set(&self, key: String, value: TranslationData) {
        let mut cache = self.cache.lock().unwrap();
        cache.retain(|(k, _)| *k != key);
        cache.push((key, value));
        if cache.len() > CACHE_LIMIT {
            cache.remove(0);
        }
    }

    pub async fn translate(
        &self,
        client: &Client,
        store: &Store,
        req: Request,
        on_partial: impl Fn(String) + Send + Sync,
    ) -> Reply {
        let mut reply = Reply { request_id: req.request_id, ..Default::default() };
        let clean = req.text.trim().to_string();
        let settings = store.settings();

        if clean.is_empty() {
            reply.success = true;
            reply.data = Some(TranslationData {
                detected_lang: "en".into(),
                target_lang: "fa".into(),
                engine: req.engine,
                ..Default::default()
            });
            return reply;
        }

        let engine = if req.engine == "aphra" { "aphra" } else { "google" };
        let tone = req.tone.filter(|t| !t.is_empty()).unwrap_or_else(|| settings.aphra.tone.clone());
        let target = if req.target_lang.is_empty() { "auto".to_string() } else { req.target_lang.clone() };

        let cache_key = serde_json::json!([
            engine,
            target,
            settings.native_lang,
            settings.second_lang,
            if engine == "aphra" {
                serde_json::json!([tone, settings.aphra.model, settings.aphra.show_breakdown])
            } else {
                serde_json::Value::Null
            },
            clean,
        ])
        .to_string();

        if let Some(hit) = self.cache_get(&cache_key) {
            // A repeat lookup still counts (add_history skips it when history is off).
            store.add_history(HistoryItem {
                query: clean.clone(),
                translation: hit.translation.clone(),
                detected_lang: hit.detected_lang.clone(),
                target_lang: hit.target_lang.clone(),
                engine: hit.engine.clone(),
                ..Default::default()
            });
            reply.success = true;
            reply.cached = true;
            reply.data = Some(hit);
            return reply;
        }

        let lang = settings.app_language.clone();
        let mut warning: Option<Warning> = None;
        let result: Result<TranslationData, String> = if engine == "aphra" {
            let cfg = AiConfig {
                base_url: settings.aphra.base_url.clone(),
                api_key: api_key(),
                model: settings.aphra.model.clone(),
                tone: tone.clone(),
                show_breakdown: settings.aphra.show_breakdown,
                target_lang: target.clone(),
                native_lang: settings.native_lang.clone(),
                second_lang: settings.second_lang.clone(),
            };
            match aphra::translate(client, &clean, &cfg, &on_partial).await {
                Ok(data) => Ok(data),
                Err(err) => {
                    // Never leave the user empty-handed: degrade to the instant engine and say why.
                    // What the smart engine had streamed so far is wiped first, so the page never
                    // shows the start of one translation glued to another.
                    on_partial(String::new());
                    let missing = err.code == "MISSING_API_KEY";
                    warning = Some(Warning {
                        code: if missing { "MISSING_API_KEY".into() } else { "AI_FAILED".into() },
                        message: if missing { String::new() } else { ai_message(&err, &lang) },
                    });
                    google::translate(client, &clean, &target, &settings.native_lang, &settings.second_lang).await
                }
            }
        } else {
            google::translate(client, &clean, &target, &settings.native_lang, &settings.second_lang).await
        };

        match result {
            Ok(data) => {
                store.add_history(HistoryItem {
                    query: clean.clone(),
                    translation: data.translation.clone(),
                    detected_lang: data.detected_lang.clone(),
                    target_lang: data.target_lang.clone(),
                    engine: data.engine.clone(),
                    ..Default::default()
                });
                if warning.is_none() {
                    self.cache_set(cache_key, data.clone());
                }
                reply.success = true;
                reply.warning = warning;
                reply.data = Some(data);
            }
            Err(e) => {
                reply.error = Some(friendly_error(&e, &lang));
                reply.error_code = Some(e);
            }
        }
        reply
    }
}

fn friendly_error(code: &str, lang: &str) -> String {
    match (code == google::NETWORK_FAILED, lang) {
        (true, "en") => "No internet connection; the translation could not be made.".into(),
        (true, _) => "اتصال اینترنت برقرار نیست؛ ترجمه ممکن نشد.".into(),
        (false, "en") => "The translation failed.".into(),
        (false, _) => "خطا در فرآیند ترجمه".into(),
    }
}

/// A sentence for an AI failure, in the interface language.
pub fn ai_message(err: &AiError, lang: &str) -> String {
    let fa = lang != "en";
    let detail = if err.detail.is_empty() { String::new() } else { format!(" ({})", err.detail) };
    let text = match (err.code.as_str(), fa) {
        ("MISSING_API_KEY", true) => "ابتدا کلید API را وارد کنید.".to_string(),
        ("MISSING_API_KEY", false) => "Enter the API key first.".to_string(),
        ("BLOCKED", true) => "سرویس هوش مصنوعی از این شبکه در دسترس نیست (احتمالاً تحریم یا فیلتر). یک VPN یا سرویس دیگر امتحان کنید.".to_string(),
        ("BLOCKED", false) => "The AI service refuses this network (likely a regional block). Try a VPN or another provider.".to_string(),
        ("TRUNCATED", true) => "پاسخ مدل نیمه‌کاره ماند.".to_string(),
        ("TRUNCATED", false) => "The model's answer was cut off.".to_string(),
        ("AUTH", true) => format!("کلید API نامعتبر است یا دسترسی ندارد{detail}"),
        ("AUTH", false) => format!("The API key is invalid or has no access{detail}"),
        ("NOT_FOUND", true) => format!("مدل یا آدرس سرویس پیدا نشد؛ Base URL و نام مدل را بررسی کنید{detail}"),
        ("NOT_FOUND", false) => format!("Model or endpoint not found; check the Base URL and model name{detail}"),
        ("QUOTA", true) => format!("اعتبار حساب کافی نیست{detail}"),
        ("QUOTA", false) => format!("The account has no credit left{detail}"),
        ("RATE_LIMIT", true) => format!("سقف درخواست یا اعتبار سرویس پر شده است{detail}"),
        ("RATE_LIMIT", false) => format!("Rate limit or quota reached{detail}"),
        ("SERVER", true) => format!("سرویس هوش مصنوعی موقتاً در دسترس نیست ({}){detail}", err.status),
        ("SERVER", false) => format!("The AI service is temporarily unavailable ({}){detail}", err.status),
        ("TIMEOUT", true) => "پاسخ سرویس هوش مصنوعی خیلی طول کشید.".to_string(),
        ("TIMEOUT", false) => "The AI service took too long to answer.".to_string(),
        ("NETWORK", true) if err.detail == "local" => "اتصال به سرویس هوش مصنوعی برقرار نشد (سرور محلی روشن است؟)".to_string(),
        ("NETWORK", true) => "اتصال به سرویس هوش مصنوعی برقرار نشد".to_string(),
        ("NETWORK", false) if err.detail == "local" => "Could not reach the AI service (is the local server running?)".to_string(),
        ("NETWORK", false) => "Could not reach the AI service".to_string(),
        ("EMPTY", true) => "مدل پاسخ قابل استفاده‌ای برنگرداند.".to_string(),
        ("EMPTY", false) => "The model returned nothing usable.".to_string(),
        (_, true) => format!("خطای سرویس هوش مصنوعی ({}){detail}", err.status),
        (_, false) => format!("AI service error ({}){detail}", err.status),
    };
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(t: &str) -> TranslationData {
        TranslationData { translation: t.into(), ..Default::default() }
    }

    #[test]
    fn the_cache_is_a_bounded_lru() {
        let t = Translator::default();
        for i in 0..CACHE_LIMIT + 5 {
            t.cache_set(format!("k{i}"), data("x"));
        }
        assert!(t.cache_get("k0").is_none(), "the oldest entries are evicted");
        assert!(t.cache_get(&format!("k{}", CACHE_LIMIT + 4)).is_some());

        t.cache_set("keep".into(), data("a"));
        for i in 0..CACHE_LIMIT - 1 {
            t.cache_set(format!("n{i}"), data("x"));
            let _ = t.cache_get("keep"); // read refreshes recency
        }
        assert_eq!(t.cache_get("keep").unwrap().translation, "a");
    }

    #[test]
    fn errors_speak_the_interface_language() {
        let e = AiError { code: "AUTH".into(), status: 401, retryable: false, detail: "bad".into(), provider_message: String::new() };
        assert!(ai_message(&e, "en").contains("invalid"));
        assert!(ai_message(&e, "fa").contains("نامعتبر"));
        assert!(friendly_error(google::NETWORK_FAILED, "en").contains("internet"));
    }
}
