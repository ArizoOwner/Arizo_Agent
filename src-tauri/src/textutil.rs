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
                    let chars: Vec<char> = s.chars().collect();
                    for piece in chars.chunks(max) {
                        pieces.push(piece.iter().collect());
                    }
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

/// Joins the translations of the chunks `split_text` produced. A chunk cut at a
/// sentence boundary lost the space that followed it, so it is put back there.
pub fn join_translations(sources: &[String], translations: &[String]) -> String {
    let mut out = String::new();
    for (i, t) in translations.iter().enumerate() {
        let cut_after_sentence = sources.get(i).is_some_and(|s| s.chars().last().is_some_and(is_sentence_end))
            && sources.get(i + 1).is_some_and(|n| n.chars().next().is_some_and(|c| !c.is_whitespace()));
        if cut_after_sentence {
            out.push_str(t.trim_end_matches(' '));
            out.push(' ');
        } else {
            out.push_str(t);
        }
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
