// Persian ⇄ English idiom and fluency post-processor. Machine translation tends to
// render figurative expressions word by word; these rules put the natural
// equivalent back and tidy the typography.

use regex::Regex;
use std::sync::OnceLock;

struct FaRule {
    fa: Regex,
    reps: Vec<(Regex, &'static str)>,
}

fn re(p: &str) -> Regex {
    Regex::new(p).unwrap()
}

fn ci(p: &str) -> Regex {
    Regex::new(&format!("(?i){p}")).unwrap()
}

fn rule(fa: &str, reps: &[(&str, &'static str)]) -> FaRule {
    FaRule { fa: re(fa), reps: reps.iter().map(|(p, r)| (ci(p), *r)).collect() }
}

// `\x{200C}` is the zero-width non-joiner Persian writers put inside compound words.
fn fa_rules() -> &'static Vec<FaRule> {
    static R: OnceLock<Vec<FaRule>> = OnceLock::new();
    R.get_or_init(|| {
        vec![
            // «گره از کار ... گشودن» — untangle / solve difficulties
            rule(
                r"گره[\x{200C}\s]*(?:ی|ای)?[\x{200C}\s]*از[\x{200C}\s]*کار",
                &[
                    (r"\b(?:opens?|untying|unties?|unravelling|loosening)\s+a\s+knot\s+of\b", "untangles"),
                    (r"\bopens?\s+the\s+knot\s+of\b", "untangles"),
                    (r"\bopen\s+a\s+knot\s+from\b", "solve"),
                    (r"\bopens?\s+knots?\s+in\b", "untangles"),
                    (r"\bopens?\s+knots?\b", "resolves problems"),
                ],
            ),
            // «نفس‌گیر» — overwhelming / grueling
            rule(
                r"نفس[\x{200C}\s]*گیر",
                &[
                    (r"\bsometimes\s+it\s+seems\s+breathtaking\s+to\s+keep\s+up\s+with\s+it\b", "it can sometimes feel overwhelming to keep up"),
                    (r"\bseems?\s+breathtaking\s+to\s+keep\s+up\s+with\s+it\b", "can feel overwhelming to keep up"),
                    (r"\bit\s+seems\s+breathtaking\s+to\s+keep\s+up\b", "it feels overwhelming to keep up"),
                    (r"\bbreathtaking\s+to\s+keep\s+up\b", "overwhelming to keep up"),
                    (r"\bseems\s+breathtaking\b", "feels overwhelming"),
                    (r"\bbreathtaking\s+pace\b", "overwhelming pace"),
                ],
            ),
            // «با چنان سرعتی پیش تاختن»
            rule(
                r"سرعت.*(?:پیش[\x{200C}\s]*می[\x{200C}\s]*تازد|پیشرفت|شتاب)",
                &[
                    (r"\bmoving\s+forward\s+at\s+such\s+a\s+speed\b", "moving at such a pace"),
                    (r"\brunning\s+forward\s+at\s+such\s+a\s+speed\b", "advancing at such a pace"),
                    (r"\bgalloping\s+forward\b", "surging ahead"),
                ],
            ),
            // «پیچیدگی تراشیدن»
            rule(
                r"پیچیدگی.*(?:تراش|بتراش)",
                &[
                    (r"\bnot\s+just\s+creating\s+new\s+complications\b", "not simply adds complexity"),
                    (r"\bjust\s+shaving\s+new\s+complexities\b", "simply adding complexity"),
                    (r"\bcarv(?:ing|e|es)\s+new\s+complexities\b", "add fresh complexity"),
                    (r"\bcarv(?:ing|e|es)\s+new\s+complications\b", "create fresh complications"),
                ],
            ),
            rule(r"نوآوری[\x{200C}\s]+واقعی", &[(r"\breal\s+innovation\b", "true innovation")]),
            rule(
                r"نباید\s+فراموش\s+کرد",
                &[
                    (r"\bwe\s+should\s+not\s+forget\b", "we must not forget"),
                    (r"\bone\s+should\s+not\s+forget\b", "we must not forget"),
                ],
            ),
            // «دست و پنجه نرم کردن» — grapple with
            rule(
                r"دست\s+و\s+پنجه\s+نرم",
                &[
                    (r"\bsoften(?:ed|ing)?\s+hands?\s+and\s+paws?\s+(?:with\b)?", "grappled with"),
                    (r"\bsoften(?:ed|ing)?\s+hands?\s+and\s+claws?\b", "tackled"),
                    (r"\bplaying\s+soft\s+hands\b", "grappling with"),
                ],
            ),
            // «سنگ تمام گذاشتن» — spare no effort
            rule(
                r"سنگ\s+تمام\s+گذاشت",
                &[
                    (r"\bput\s+a\s+full\s+stone\b", "spared no effort"),
                    (r"\bputting\s+a\s+full\s+stone\b", "going all out"),
                    (r"\bset\s+a\s+full\s+stone\b", "left no stone unturned"),
                ],
            ),
            // «از کوره در رفتن» — lose one's temper
            rule(
                r"از\s+کوره\s+در\s+رفتن|از\s+کوره\s+در\s+رفت",
                &[
                    (r"\bget\s+out\s+of\s+the\s+furnace\b", "lose one's temper"),
                    (r"\bwent\s+out\s+of\s+the\s+furnace\b", "lost his temper"),
                    (r"\bjump(?:ed)?\s+out\s+of\s+the\s+kiln\b", "flew off the handle"),
                ],
            ),
            // «پشت گوش انداختن»
            rule(
                r"پشت\s+گوش\s+انداخت",
                &[
                    (r"\bthrow(?:ing)?\s+behind\s+(?:the\s+)?ear\b", "procrastinating on"),
                    (r"\bput(?:ting)?\s+behind\s+(?:the\s+)?ear\b", "brushing aside"),
                ],
            ),
            // «روی پای خود ایستادن»
            rule(
                r"روی\s+پای\s+خود\s+ایستادن|روی\s+پای\s+خودش",
                &[
                    (r"\bstand(?:ing)?\s+on\s+one's\s+own\s+foot\b", "standing on one's own two feet"),
                    (r"\bstand\s+on\s+his\s+own\s+foot\b", "stand on his own two feet"),
                ],
            ),
            // «چشم‌پوشی»
            rule(
                r"چشم[\x{200C}\s]*پوشی",
                &[
                    (r"\beye\s+covering\b", "turning a blind eye"),
                    (r"\bcovering\s+the\s+eyes\b", "overlooking"),
                ],
            ),
            // «زیر بار رفتن / نرفتن»
            rule(
                r"زیر\s+بار\s+(?:نمی[\x{200C}\s]*رود|نرفت|رفتن)",
                &[
                    (r"\bgo(?:ing)?\s+under\s+the\s+load\b", "accepting the burden"),
                    (r"\bdoes\s+not\s+go\s+under\s+the\s+load\b", "refuses to submit"),
                    (r"\bdid\s+not\s+go\s+under\s+the\s+load\b", "refused to give in"),
                ],
            ),
            // «مثل آب خوردن» — a piece of cake
            rule(r"مثل\s+آب\s+خوردن", &[(r"\blike\s+drinking\s+water\b", "a piece of cake")]),
            // «دندان روی جگر گذاشتن» — bite the bullet
            rule(r"دندان\s+روی\s+جگر", &[(r"\bput(?:ting)?\s+teeth\s+on\s+(?:the\s+)?liver\b", "biting the bullet")]),
            // «دل به دریا زدن» — take the plunge
            rule(
                r"دل\s+به\s+دریا\s+زد",
                &[
                    (r"\bhit\s+the\s+heart\s+to\s+the\s+sea\b", "took the plunge"),
                    (r"\bput\s+the\s+heart\s+into\s+the\s+sea\b", "took the leap"),
                ],
            ),
            // «آستین بالا زدن» — roll up one's sleeves
            rule(
                r"آستین\s+بالا\s+زد",
                &[
                    (r"\bhit\s+the\s+sleeves?\s+up\b", "rolled up the sleeves"),
                    (r"\bput\s+the\s+sleeves?\s+up\b", "rolled up the sleeves"),
                ],
            ),
            // «گره کور» — deadlock
            rule(
                r"گره[\x{200C}\s]+کور",
                &[(r"\bblind\s+knot\b", "deadlock"), (r"\ba\s+blind\s+knot\b", "an impasse")],
            ),
            // «راه به جایی نبردن» — lead nowhere
            rule(
                r"راه\s+به\s+جایی\s+نمی[\x{200C}\s]*برد|راه\s+به\s+جایی\s+نبرد",
                &[
                    (r"\bdoes\s+not\s+take\s+a\s+way\s+anywhere\b", "leads nowhere"),
                    (r"\bdid\s+not\s+take\s+a\s+way\s+anywhere\b", "led nowhere"),
                ],
            ),
            // «به بار نشستن» — bear fruit
            rule(
                r"به\s+بار\s+نشست",
                &[(r"\bsat\s+to\s+bear\b", "bore fruit"), (r"\bsat\s+on\s+the\s+load\b", "paid off")],
            ),
        ]
    })
}

/// English idioms whose literal Persian rendering is wrong, and the Persian they should become.
fn en_triggers() -> &'static Vec<Regex> {
    static R: OnceLock<Vec<Regex>> = OnceLock::new();
    R.get_or_init(|| {
        [
            r"\bpiece\s+of\s+cake\b",
            r"\bbreak\s+a\s+leg\b",
            r"\bbite\s+the\s+bullet\b",
            r"\bspill\s+the\s+beans\b",
            r"\bunder\s+the\s+weather\b",
            r"\bonce\s+in\s+a\s+blue\s+moon\b",
            r"\bcost(?:s)?\s+an\s+arm\s+and\s+a\s+leg\b",
            r"\bhit\s+the\s+nail\s+on\s+the\s+head\b",
            r"\bcut(?:ting)?\s+corners\b",
            r"\bburn(?:ing)?\s+the\s+midnight\s+oil\b",
            r"\bcall\s+it\s+a\s+day\b",
            r"\btake\s+it\s+with\s+a\s+grain\s+of\s+salt\b",
            r"\bactions\s+speak\s+louder\s+than\s+words\b",
            r"\bbetter\s+late\s+than\s+never\b",
        ]
        .iter()
        .map(|p| ci(p))
        .collect()
    })
}

fn en_fixes() -> &'static Vec<(Regex, &'static str)> {
    static R: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    R.get_or_init(|| {
        vec![
            (re(r"یک\s+تکه\s+کیک|تکه\s+ای\s+از\s+کیک"), "مثل آب خوردن"),
            (re(r"یک\s+پا\s+بشکن"), "موفق باشی"),
            (re(r"لوبیا\s+ها\s+را\s+بریزید"), "راز را فاش کردن"),
            (re(r"زیر\s+آب\s+و\s+هوا"), "ناخوش‌احوال"),
        ]
    })
}

pub fn enhance_fa_to_en(english: &str, original_fa: &str) -> String {
    if english.is_empty() {
        return english.to_string();
    }
    let mut result = english.to_string();
    for rule in fa_rules() {
        if rule.fa.is_match(original_fa) {
            for (pattern, replacement) in &rule.reps {
                result = pattern.replace_all(&result, *replacement).into_owned();
            }
        }
    }
    static SPACE_COMMA: OnceLock<Regex> = OnceLock::new();
    static SPACE_DOT: OnceLock<Regex> = OnceLock::new();
    static MULTI: OnceLock<Regex> = OnceLock::new();
    // Horizontal whitespace only, so paragraph breaks survive; a dot loses its
    // leading space only when it ends a sentence, not in ".env" or ".NET".
    let result = SPACE_COMMA.get_or_init(|| re(r"[^\S\r\n]+,")).replace_all(&result, ",").into_owned();
    let result = SPACE_DOT.get_or_init(|| re(r"[^\S\r\n]+\.(\s|$)")).replace_all(&result, ".$1").into_owned();
    let result = MULTI.get_or_init(|| re(r"[^\S\r\n]{2,}")).replace_all(&result, " ").into_owned();
    result.trim().to_string()
}

pub fn enhance_en_to_fa(persian: &str, original_en: &str) -> String {
    if persian.is_empty() {
        return persian.to_string();
    }
    let mut result = persian.to_string();
    if en_triggers().iter().any(|t| t.is_match(original_en)) {
        for (pattern, replacement) in en_fixes() {
            result = pattern.replace_all(&result, *replacement).into_owned();
        }
    }
    // Persian typography. Spaces go after the Persian marks only: «.» and «!» are left
    // alone so decimals, domains and abbreviations survive.
    static BEFORE: OnceLock<Regex> = OnceLock::new();
    static BEFORE_END: OnceLock<Regex> = OnceLock::new();
    static AFTER: OnceLock<Regex> = OnceLock::new();
    static MULTI: OnceLock<Regex> = OnceLock::new();
    // Horizontal whitespace only, so paragraph breaks survive; «.» and «!» lose
    // their leading space only at the end of a sentence (".env" keeps it).
    let result = BEFORE.get_or_init(|| re(r"[^\S\r\n]+([،؛؟])")).replace_all(&result, "$1").into_owned();
    let result = BEFORE_END.get_or_init(|| re(r"[^\S\r\n]+([.!])(\s|$)")).replace_all(&result, "$1$2").into_owned();
    let result = AFTER.get_or_init(|| re(r"([،؛؟])([^\s،؛.؟!])")).replace_all(&result, "$1 $2").into_owned();
    let result = MULTI.get_or_init(|| re(r"[^\S\r\n]{2,}")).replace_all(&result, " ").into_owned();
    result.trim().to_string()
}

/// Picks the enhancer that fits the language pair.
pub fn enhance_translation(translation: &str, source_text: &str, source_lang: &str, target_lang: &str) -> String {
    if translation.is_empty() {
        return translation.to_string();
    }
    let has_arabic_script = source_text.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c));
    let source_fa = source_lang == "fa" || has_arabic_script;
    if source_fa && target_lang == "en" {
        return enhance_fa_to_en(translation, source_text);
    }
    if source_lang == "en" && target_lang == "fa" {
        return enhance_en_to_fa(translation, source_text);
    }
    translation.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_persian_idioms_become_natural_english() {
        assert_eq!(
            enhance_translation("He put a full stone into it", "او سنگ تمام گذاشت", "fa", "en"),
            "He put a full stone into it".replace("put a full stone", "spared no effort")
        );
        assert_eq!(enhance_translation("It is like drinking water", "این مثل آب خوردن است", "fa", "en"), "It is a piece of cake");
        assert_eq!(
            enhance_translation("He went out of the furnace", "از کوره در رفت", "fa", "en"),
            "He lost his temper"
        );
    }

    #[test]
    fn rules_only_fire_when_the_source_has_the_idiom() {
        let text = "He went out of the furnace";
        assert_eq!(enhance_translation(text, "سلام دنیا", "fa", "en"), text);
    }

    #[test]
    fn english_to_persian_fixes_literal_renderings_and_spacing() {
        assert_eq!(
            enhance_translation("این یک تکه کیک است", "It is a piece of cake", "en", "fa"),
            "این مثل آب خوردن است"
        );
        assert_eq!(enhance_translation("سلام ،دنیا", "Hello, world", "en", "fa"), "سلام، دنیا");
    }

    #[test]
    fn persian_typography_leaves_urls_and_decimals_alone() {
        assert_eq!(enhance_en_to_fa("به google.com برو", "go to google.com"), "به google.com برو");
        assert_eq!(enhance_en_to_fa("عدد 3.14 است", "x"), "عدد 3.14 است");
    }

    #[test]
    fn cleanup_keeps_paragraph_breaks_and_dotted_tokens() {
        assert_eq!(enhance_fa_to_en("First .\n\nSecond  point ,ok", "x"), "First.\n\nSecond point,ok");
        assert_eq!(enhance_fa_to_en("Edit the .env file .", "x"), "Edit the .env file.");
        assert_eq!(enhance_en_to_fa("بند اول\n\nبند دوم", "x"), "بند اول\n\nبند دوم");
        assert_eq!(enhance_en_to_fa("فایل .gitignore را ببین .", "x"), "فایل .gitignore را ببین.");
        assert_eq!(enhance_en_to_fa("سلام ،دنیا !", "x"), "سلام، دنیا!");
    }

    #[test]
    fn other_pairs_are_untouched() {
        assert_eq!(enhance_translation("Hallo  Welt", "Hello world", "en", "de"), "Hallo  Welt");
    }
}
