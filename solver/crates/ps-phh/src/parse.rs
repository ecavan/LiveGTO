//! A small reader for the poker hand history (PHH) format: https://phh.readthedocs.io
//!
//! Only what no-limit hold'em needs: `variant`, `antes`, `blinds_or_straddles`,
//! `starting_stacks`, `actions`, `players`, `winnings`, `seat_count`, `venue`, `hand`.
//! A `.phhs` file holds many hands, each under a `[n]` header; a `.phh` file holds one.

#[derive(Debug, Clone, Default)]
pub struct RawHand {
    pub variant: String,
    pub venue: String,
    pub hand: String,
    pub antes: Vec<f64>,
    pub blinds: Vec<f64>,
    pub stacks: Vec<f64>,
    pub actions: Vec<String>,
    pub players: Vec<String>,
    pub winnings: Option<Vec<f64>>,
    pub seat_count: Option<u32>,
}

/// Splits a file's text into hands and parses each one.
pub fn parse_text(text: &str) -> Vec<RawHand> {
    let mut out = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    let mut sectioned = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') && !t.contains('=') {
            sectioned = true;
            if !cur.is_empty() {
                out.push(parse_hand(&cur));
                cur.clear();
            }
            continue;
        }
        cur.push(line);
    }
    if !cur.is_empty() && (sectioned || cur.iter().any(|l| l.contains("actions"))) {
        out.push(parse_hand(&cur));
    }
    out
}

fn parse_hand(lines: &[&str]) -> RawHand {
    let mut h = RawHand::default();
    for line in lines {
        let line = strip_comment(line);
        let Some((k, v)) = line.split_once('=') else { continue };
        let (k, v) = (k.trim(), v.trim());
        match k {
            "variant" => h.variant = unquote(v),
            "venue" => h.venue = unquote(v),
            "hand" => h.hand = unquote(v),
            "antes" => h.antes = nums(v),
            "blinds_or_straddles" => h.blinds = nums(v),
            "starting_stacks" => h.stacks = nums(v),
            "actions" => h.actions = strs(v),
            "players" => h.players = strs(v),
            "winnings" => h.winnings = Some(nums(v)),
            "seat_count" => h.seat_count = v.parse().ok(),
            _ => {}
        }
    }
    h
}

/// Drops a `# comment` that is not inside a quoted string.
fn strip_comment(line: &str) -> &str {
    let mut in_q = false;
    for (i, ch) in line.char_indices() {
        match ch {
            '\'' | '"' => in_q = !in_q,
            '#' if !in_q => return &line[..i],
            _ => {}
        }
    }
    line
}

fn unquote(v: &str) -> String {
    v.trim().trim_matches(|c| c == '\'' || c == '"').to_string()
}

fn nums(v: &str) -> Vec<f64> {
    v.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(|x| x.parse::<f64>().unwrap_or(f64::NAN))
        .collect()
}

/// `['a', 'b # c']` → ["a", "b"] (an action's own `# comment` is dropped).
fn strs(v: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for ch in v.chars() {
        match quote {
            None if ch == '\'' || ch == '"' => quote = Some(ch),
            Some(q) if ch == q => {
                let s = match cur.split_once('#') {
                    Some((a, _)) => a.trim().to_string(),
                    None => cur.trim().to_string(),
                };
                out.push(s);
                cur.clear();
                quote = None;
            }
            Some(_) => cur.push(ch),
            None => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sections_and_single_hands() {
        let t = "[1]\nvariant = 'NT'\nblinds_or_straddles = [0.10, 0.25, 0]\nstarting_stacks = [25, 54.75, 16.35]\nactions = ['d dh p1 ????', 'p3 cbr 0.75 # open', 'p1 f']\nplayers = ['a+b/c=', 'x', 'y']\n\n[2]\nvariant = 'NT'\nactions = []\n";
        let hs = parse_text(t);
        assert_eq!(hs.len(), 2);
        assert_eq!(hs[0].blinds, vec![0.10, 0.25, 0.0]);
        assert_eq!(hs[0].actions, vec!["d dh p1 ????", "p3 cbr 0.75", "p1 f"]);
        assert_eq!(hs[0].players[0], "a+b/c=");
        let one = parse_text("variant = 'NT'\nactions = ['p1 f']\n");
        assert_eq!(one.len(), 1);
    }
}
