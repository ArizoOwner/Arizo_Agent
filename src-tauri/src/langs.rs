// Language catalogue and script-based language detection.
// Pure module: no network, no OS access, fully unit-tested.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Serialize, Clone, Copy, Debug)]
pub struct Lang {
    pub code: &'static str,
    pub name: &'static str,
    pub native: &'static str,
    pub rtl: bool,
}

const fn lang(code: &'static str, name: &'static str, native: &'static str, rtl: bool) -> Lang {
    Lang { code, name, native, rtl }
}

pub const LANGUAGES: &[Lang] = &[
    lang("fa", "Persian (Farsi)", "فارسی", true),
    lang("en", "English", "English", false),
    lang("ar", "Arabic", "العربية", true),
    lang("tr", "Turkish", "Türkçe", false),
    lang("de", "German", "Deutsch", false),
    lang("fr", "French", "Français", false),
    lang("es", "Spanish", "Español", false),
    lang("it", "Italian", "Italiano", false),
    lang("pt", "Portuguese", "Português", false),
    lang("ru", "Russian", "Русский", false),
    lang("uk", "Ukrainian", "Українська", false),
    lang("zh-CN", "Chinese (Simplified)", "中文", false),
    lang("ja", "Japanese", "日本語", false),
    lang("ko", "Korean", "한국어", false),
    lang("hi", "Hindi", "हिन्दी", false),
    lang("ur", "Urdu", "اردو", true),
    lang("he", "Hebrew", "עברית", true),
    lang("nl", "Dutch", "Nederlands", false),
    lang("pl", "Polish", "Polski", false),
    lang("sv", "Swedish", "Svenska", false),
];

fn find(code_lower: &str) -> Option<&'static Lang> {
    LANGUAGES.iter().find(|l| l.code.to_lowercase() == code_lower)
}

/// "en-US" → "en", "zh" → "zh-CN"; unknown codes pass through lower-cased.
pub fn normalize_code(code: &str) -> String {
    let c = code.trim().to_lowercase();
    if c.is_empty() {
        return String::new();
    }
    if c == "zh" || c == "zh-cn" || c == "zh-hans" {
        return "zh-CN".into();
    }
    if let Some(l) = find(&c) {
        return l.code.into();
    }
    let base = c.split(['-', '_']).next().unwrap_or("");
    if let Some(l) = find(base) {
        return l.code.into();
    }
    c
}

pub fn get_language(code: &str) -> Option<&'static Lang> {
    find(&normalize_code(code).to_lowercase())
}

pub fn language_name(code: &str) -> String {
    match get_language(code) {
        Some(l) => l.name.to_string(),
        None if code.is_empty() => "the source language".into(),
        None => code.to_string(),
    }
}

// Persian vocabulary used to tell Persian that contains English technical words
// ("سلام checkout کن") apart from Arabic. `~` stands for the zero-width non-joiner.
const PERSIAN_WORDS: &str = "سلام|درود|خوبی|در|به|از|که|رو|را|با|برای|این|آن|اینجا|آنجا|ها|های|کن|کنید|کرد|کردن|کردم|کردی|کردند|شد|شده|است|نیست|بود|می|نمی|یک|هم|چرا|چطور|چطوری|چگونه|کجا|چی|چیه|چیست|کی|اگر|اگه|ولی|اما|چون|تا|توی|تو|روی|داخل|زیر|بالا|داد|داده|میده|می~ده|نده|نمیده|نمی~ده|گرفت|بگیر|نگیر|زد|زدن|بزن|نزن|میزنه|می~زنه|رفت|برو|نرو|اومد|آمد|بیا|نیا|هست|باشه|نباشه|میشه|می~شه|نمیشه|نمی~شه|لطفا|لطفاً|مرسی|ممنون|تشکر|دارد|دارم|داری|دارند|باید|نباید|شاید|بزار|بذار|چک|تست|حل|ارور|خطا|مشکل|باگ|میخوام|می~خوام|میخواهم|می~خواهم|میتونم|می~تونم|میتونی|می~تونی|میتونه|می~تونه|بکنم|بررسی|پروژه|برنامه|کد|کامیت|مرج|پوش|پول|ریکوئست|برنچ|ریپو|کانفیگ|دیپلوی|بیلد|فیکس|اجرا|نصب|پکیج|ماژول|کامپوننت|تابع|متغیر|دیتابیس|سرور|کلاینت|لاگ|داکیومنت";

fn persian_words() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        let words = PERSIAN_WORDS.replace('~', "\u{200C}");
        let edge = r#"[.,!؟،؛:\-_()\[\]{}"']"#;
        Regex::new(&format!(r"(?i)(?:^|\s|{edge})(?:{words})(?:\s|{edge}|$)")).unwrap()
    })
}

fn in_range(c: char, lo: u32, hi: u32) -> bool {
    (lo..=hi).contains(&(c as u32))
}

fn is_arabic_script(c: char) -> bool {
    in_range(c, 0x0600, 0x06FF)
        || in_range(c, 0x0750, 0x077F)
        || in_range(c, 0xFB50, 0xFDFF)
        || in_range(c, 0xFE70, 0xFEFF)
}

/// Script and vocabulary based detection, tuned for Persian mixed with English.
pub fn detect(text: &str) -> String {
    let clean = text.trim();
    if clean.is_empty() {
        return "en".into();
    }

    let (mut arabic, mut latin, mut cyr, mut heb) = (0usize, 0usize, 0usize, 0usize);
    let (mut kana, mut hangul, mut han, mut deva) = (0usize, 0usize, 0usize, 0usize);
    let (mut fa_letters, mut ar_letters, mut ur_letters) = (0usize, 0usize, 0usize);

    for c in clean.chars() {
        if is_arabic_script(c) {
            arabic += 1;
        }
        if "پچژگکی".contains(c) || in_range(c, 0x06F0, 0x06F9) || c == '\u{200C}' {
            fa_letters += 1;
        }
        if "ةيكىءأإؤئ".contains(c) {
            ar_letters += 1;
        }
        if "ٹڈڑںھہےۓ".contains(c) {
            ur_letters += 1;
        }
        if c.is_ascii_alphabetic() || in_range(c, 0x00C0, 0x024F) {
            latin += 1;
        }
        if in_range(c, 0x0400, 0x04FF) {
            cyr += 1;
        }
        if in_range(c, 0x0590, 0x05FF) {
            heb += 1;
        }
        if in_range(c, 0x3040, 0x30FF) {
            kana += 1;
        }
        if in_range(c, 0xAC00, 0xD7AF) || in_range(c, 0x1100, 0x11FF) {
            hangul += 1;
        }
        if in_range(c, 0x4E00, 0x9FFF) {
            han += 1;
        }
        if in_range(c, 0x0900, 0x097F) {
            deva += 1;
        }
    }

    if arabic > 0 {
        if ur_letters > 0 {
            return "ur".into();
        }
        let has_fa_words = persian_words().is_match(clean);
        if has_fa_words || fa_letters > 0 {
            return "fa".into();
        }
        let ratio_ok = arabic + latin > 0 && (arabic as f64 / (arabic + latin) as f64) >= 0.15;
        if arabic >= 3 || ratio_ok {
            if ar_letters > fa_letters && fa_letters == 0 && !has_fa_words && arabic > latin {
                return "ar".into();
            }
            return "fa".into();
        }
        if ar_letters > 0 && fa_letters == 0 {
            return "ar".into();
        }
        return "fa".into();
    }

    let dominant = latin.max(cyr).max(heb).max(kana + han).max(hangul).max(deva);
    if dominant == 0 {
        return "en".into();
    }
    if kana > 0 && kana + han == dominant {
        return "ja".into();
    }
    if kana + han == dominant {
        return "zh-CN".into();
    }
    if hangul == dominant {
        return "ko".into();
    }
    if cyr == dominant {
        return "ru".into();
    }
    if heb == dominant {
        return "he".into();
    }
    if deva == dominant {
        return "hi".into();
    }
    "en".into()
}

/// The effective target. `auto` means: native-language text → second language,
/// anything else → native language.
pub fn resolve_target(requested: &str, detected: &str, native: &str, second: &str) -> String {
    let native = match normalize_code(native) {
        n if n.is_empty() => "fa".to_string(),
        n => n,
    };
    let second = match normalize_code(second) {
        s if s.is_empty() => "en".to_string(),
        s => s,
    };
    if !requested.is_empty() && requested != "auto" {
        return normalize_code(requested);
    }
    if detected == native {
        second
    } else {
        native
    }
}

/// `detect` answers "en" for every Latin-script text, so when the native or second
/// language is another Latin-script one, an "en" guess may really be that language.
pub fn ambiguous_latin_guess(guess: &str, native: &str, second: &str) -> bool {
    let other_latin = |c: &str| matches!(normalize_code(c).as_str(), "tr" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "pl" | "sv");
    guess == "en" && (other_latin(native) || other_latin(second))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_latin_guess_is_only_ambiguous_next_to_another_latin_language() {
        assert!(!ambiguous_latin_guess("en", "fa", "en"));
        assert!(!ambiguous_latin_guess("en", "", ""));
        assert!(!ambiguous_latin_guess("fa", "tr", "de"));
        assert!(ambiguous_latin_guess("en", "tr", "en"));
        assert!(ambiguous_latin_guess("en", "fa", "de"));
        assert!(ambiguous_latin_guess("en", "en", "fr"));
    }

    #[test]
    fn detects_scripts() {
        assert_eq!(detect("Hello, how are you?"), "en");
        assert_eq!(detect("سلام، حال شما چطور است؟"), "fa");
        assert_eq!(detect("مرحبا كيف حالك"), "ar");
        assert_eq!(detect("Привет, мир"), "ru");
        assert_eq!(detect("こんにちは"), "ja");
        assert_eq!(detect("你好世界"), "zh-CN");
        assert_eq!(detect("안녕하세요"), "ko");
        assert_eq!(detect("123 !!!"), "en");
        assert_eq!(detect(""), "en");
    }

    #[test]
    fn mixed_persian_and_english_jargon_stays_persian() {
        assert_eq!(detect("سلام checkout کن"), "fa");
        assert_eq!(detect("با docker compose اجرا کن"), "fa");
        assert_eq!(detect("ریکوئست تایم‌اوت خورد"), "fa");
    }

    #[test]
    fn auto_target_flips_native_and_second() {
        assert_eq!(resolve_target("auto", "fa", "fa", "en"), "en");
        assert_eq!(resolve_target("auto", "en", "fa", "en"), "fa");
        assert_eq!(resolve_target("auto", "de", "fa", "en"), "fa");
        assert_eq!(resolve_target("de", "fa", "fa", "en"), "de");
        assert_eq!(resolve_target("auto", "tr", "tr", "de"), "de");
    }

    #[test]
    fn codes_are_normalised() {
        assert_eq!(normalize_code("zh"), "zh-CN");
        assert_eq!(normalize_code("en-US"), "en");
        assert_eq!(normalize_code(" FA "), "fa");
        assert_eq!(normalize_code(""), "");
        assert_eq!(language_name("de"), "German");
    }
}
