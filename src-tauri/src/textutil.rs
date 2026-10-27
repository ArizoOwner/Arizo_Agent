// Text chunking shared by the Google, MyMemory and speech endpoints.

fn len(s: &str) -> usize {
    s.chars().count()
}

fn is_sentence_end(c: char) -> bool {
    matches!(c, '.' | '!' | '?' | '؟' | '۔' | '。' | '！' | '？')
}

/// Splits on the whitespace that follows sentence-ending punctuation.
fn split_sentences(part: &str) -> Vec<String> {
    let chars: Vec<char> = part.chars().collect();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 1;
    while i < chars.len() {
        if chars[i].is_whitespace() && !chars[i - 1].is_whitespace() && is_sentence_end(chars[i - 1]) {
            let mut j = i;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            out.push(chars[start..i].iter().collect::<String>());
            start = j;
            i = j + 1;
            continue;
        }
        i += 1;
    }
    if start < chars.len() {
        out.push(chars[start..].iter().collect());
    }
    out
}

/// Alternating text / newline-run segments, empty ones dropped.
fn segments(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_is_nl = false;
    for c in text.chars() {
        let nl = c == '\n';
        if !cur.is_empty() && nl != cur_is_nl {
            out.push(std::mem::take(&mut cur));
        }
        cur_is_nl = nl;
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn flush(pieces: &mut Vec<String>, current: &mut String) {
    if !current.is_empty() {
        pieces.push(std::mem::take(current));
    }
}

/// Cuts a run with no sentence end at the last space (or comma) before `max`, so a word is
/// never split in two; only a single unbroken token longer than `max` is cut where it must be.
fn slice_words(s: &str, max: usize, pieces: &mut Vec<String>) {
    let chars: Vec<char> = s.chars().collect();
    let mut start = 0;
    while chars.len() - start > max {
        let end = start + max;
        let cut = (start + max / 2..end)
            .rev()
            .find(|&i| chars[i].is_whitespace() || matches!(chars[i], ',' | '،' | ';' | '؛' | ':'))
            .map(|i| i + 1)
            .unwrap_or(end);
        pieces.push(chars[start..cut].iter().collect());
        start = cut;
    }
    if start < chars.len() {
        pieces.push(chars[start..].iter().collect());
    }
}

/// Splits long text on paragraph / sentence boundaries so each piece stays at or
/// below `max` characters. Separators are kept so the layout survives a round trip.
pub fn split_text(text: &str, max: usize) -> Vec<String> {
    if len(text) <= max {
        return vec![text.to_string()];
    }

    let mut pieces = Vec::new();
    let mut current = String::new();

    for part in segments(text) {
        let plen = len(&part);
        if plen > max {
            flush(&mut pieces, &mut current);
            for s in split_sentences(&part) {
                let slen = len(&s);
                if slen > max {
                    flush(&mut pieces, &mut current);
                    slice_words(&s, max, &mut pieces);
                } else if len(&current) + slen + 1 > max {
                    flush(&mut pieces, &mut current);
                    current = s;
                } else if current.is_empty() {
                    current = s;
                } else {
                    current.push(' ');
                    current.push_str(&s);
                }
            }
            flush(&mut pieces, &mut current);
        } else if len(&current) + plen > max {
            flush(&mut pieces, &mut current);
            current = part;
        } else {
            current.push_str(&part);
        }
    }
    flush(&mut pieces, &mut current);
    pieces
}

/// The whitespace a piece of text starts and ends with.
fn edges(s: &str) -> (&str, &str) {
    let body = s.trim();
    if body.is_empty() {
        return (s, "");
    }
    let start = s.find(body).unwrap_or(0);
    (&s[..start], &s[start + body.len()..])
}

/// Joins the translations of the chunks `split_text` produced. Every engine trims the
/// whitespace around what it is given, so each translation gets its source's back: the
/// paragraph break that ended a chunk, or the space after a sentence that was cut there.
/// Without it the next paragraph is glued onto the end of the last one.
pub fn join_translations(sources: &[String], translations: &[String]) -> String {
    let mut out = String::new();
    for (i, t) in translations.iter().enumerate() {
        let Some(src) = sources.get(i) else {
            out.push_str(t);
            continue;
        };
        let (lead, trail) = edges(src);
        // An existing break is never doubled: only what the translation is missing is added.
        if !t.starts_with(char::is_whitespace) && !out.ends_with(char::is_whitespace) {
            out.push_str(lead);
        }
        out.push_str(t.trim());
        let sentence_cut = trail.is_empty()
            && src.chars().last().is_some_and(is_sentence_end)
            && sources.get(i + 1).is_some_and(|n| n.chars().next().is_some_and(|c| !c.is_whitespace()));
        out.push_str(if sentence_cut { " " } else { trail });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn squash(s: &str) -> String {
        s.split_whitespace().collect()
    }

    #[test]
    fn keeps_chunks_under_the_limit_and_loses_nothing() {
        let mut text = (0..60).map(|i| format!("Sentence number {i} is here.")).collect::<Vec<_>>().join(" ");
        text.push_str(&"\n\nNew paragraph. ".repeat(30));
        let chunks = split_text(&text, 200);
        assert!(chunks.iter().all(|c| len(c) <= 200), "chunk too long");
        assert_eq!(squash(&chunks.concat()), squash(&text));
        assert_eq!(split_text("short", 100), vec!["short".to_string()]);
    }

    #[test]
    fn translations_of_sentence_cut_chunks_are_rejoined_with_a_space() {
        let text = (0..40).map(|i| format!("Sentence number {i} is here.")).collect::<Vec<_>>().join(" ");
        let chunks = split_text(&text, 100);
        assert!(chunks.len() > 1);
        assert_eq!(join_translations(&chunks, &chunks), text, "no separator lost at a chunk boundary");

        let paras = vec!["One.\n".to_string(), "Two.".to_string()];
        assert_eq!(join_translations(&paras, &paras), "One.\nTwo.", "an existing newline is not doubled");
    }

    #[test]
    fn a_paragraph_break_the_engine_trimmed_off_is_put_back() {
        // What Google does: every answer comes back without the break that ended its chunk.
        let sources = vec!["First.\n\n".to_string(), "Second.\n\n".to_string(), "Third.".to_string()];
        let trimmed = vec!["اول.".to_string(), "دوم.".to_string(), "سوم.".to_string()];
        assert_eq!(join_translations(&sources, &trimmed), "اول.\n\nدوم.\n\nسوم.");
        // An engine that kept them is not given a second one.
        let kept = vec!["اول.\n\n".to_string(), "دوم.\n\n".to_string(), "سوم.".to_string()];
        assert_eq!(join_translations(&sources, &kept), "اول.\n\nدوم.\n\nسوم.");
    }

    #[test]
    fn a_long_run_without_full_stops_is_cut_between_words() {
        // Chat logs, lists and some Persian text go on for a long time without a full stop.
        let text = "واژه ".repeat(300) + &"word, ".repeat(300);
        let chunks = split_text(&text, 400);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| len(c) <= 400));
        for c in &chunks[..chunks.len() - 1] {
            let last = c.chars().last().unwrap();
            assert!(last.is_whitespace() || last == ',', "a word was cut in two: …{:?}", c.chars().rev().take(8).collect::<String>());
        }
        assert_eq!(chunks.concat(), text, "nothing lost or added");
    }

    #[test]
    fn a_single_huge_word_is_sliced() {
        let text = "x".repeat(450);
        let chunks = split_text(&text, 200);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn splits_persian_sentences_on_their_punctuation() {
        let text = format!("{} {}", "سلام دنیا؟".repeat(30), "خداحافظ.".repeat(30));
        let chunks = split_text(&text, 120);
        assert!(chunks.iter().all(|c| len(c) <= 120));
        assert_eq!(squash(&chunks.concat()), squash(&text));
    }
}
