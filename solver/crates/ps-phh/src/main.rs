//! ps-phh: read poker hand histories (PHH) and write out how each player plays.
//!
//!   ps-phh <files or folders…> --out DIR [--decisions] [--tag NAME]
//!
//! Writes into DIR:
//!   players.tsv    one row per (venue, player, table size): HUD counters (see stats.rs)
//!   showdowns.tsv  one row per player still in at showdown: cards (if shown), board, line,
//!                  hand class on each street (ps-core::classify, the same classes the bots use)
//!   decisions.tsv  (with --decisions) one row per decision
//!   summary.json   hands read, kept and skipped (and why)

mod parse;
mod replay;
mod stats;

use anyhow::{bail, Context, Result};
use ps_core::{card_to_string, classify, Card};
use rayon::prelude::*;
use replay::{pos_index, replay, Act, Replay, Skip, POS_NAMES};
use stats::{tally, Counters, NAMES};
use std::collections::HashMap;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn table_size(n: usize) -> &'static str {
    match n {
        0..=4 => "3-4",
        5..=6 => "5-6",
        _ => "7-10",
    }
}

fn walk(p: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    if p.is_dir() {
        let mut es: Vec<_> = fs::read_dir(p)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        es.sort();
        for e in es {
            walk(&e, out)?;
        }
    } else if matches!(p.extension().and_then(|e| e.to_str()), Some("phh") | Some("phhs")) {
        out.push(p.to_path_buf());
    }
    Ok(())
}

fn cards(cs: &[Card]) -> String {
    cs.iter().map(|&c| card_to_string(c)).collect()
}

#[derive(Default)]
struct Part {
    players: HashMap<String, Counters>,
    read: u64,
    kept: u64,
    skipped: HashMap<&'static str, u64>,
    venues: HashMap<String, u64>,
}

impl Part {
    fn merge(mut self, o: Part) -> Part {
        for (k, v) in o.players {
            self.players.entry(k).or_default().merge(&v);
        }
        self.read += o.read;
        self.kept += o.kept;
        for (k, v) in o.skipped {
            *self.skipped.entry(k).or_default() += v;
        }
        for (k, v) in o.venues {
            *self.venues.entry(k).or_default() += v;
        }
        self
    }
}

fn line_of(r: &Replay, p: usize) -> String {
    let last = r.decisions.iter().map(|d| d.street).max().unwrap_or(0);
    let mut parts = Vec::new();
    for s in 0..=last {
        let a: String = r.decisions.iter().filter(|d| d.street == s && d.p == p).map(|d| d.act.code()).collect();
        parts.push(a);
    }
    parts.join("|")
}

fn showdown_rows(r: &Replay, venue: &str, hand: &str, names: &[String], out: &mut String) {
    use std::fmt::Write as _;
    if !r.showdown {
        return;
    }
    let pfa = r.decisions.iter().filter(|d| d.street == 0 && d.act == Act::Raise).last().map(|d| d.p);
    let river: Vec<_> = r.decisions.iter().filter(|d| d.street == 3).collect();
    let last_aggr = river.iter().filter(|d| d.act.aggressive()).last();
    for p in (0..r.n).filter(|&i| !r.folded[i]) {
        let role = match last_aggr {
            None => "check_down",
            Some(d) if d.p == p => "bet_called",
            Some(_) if river.iter().any(|d| d.p == p && d.act == Act::Call) => "call",
            Some(_) => "other",
        };
        let frac = match last_aggr {
            Some(d) if d.act == Act::Bet => format!("{:.3}", d.to / d.pot.max(1e-9)),
            _ => String::new(),
        };
        let (hole, cls) = match r.holes[p] {
            Some((a, b)) => {
                let cl: Vec<String> = [3usize, 4, 5]
                    .iter()
                    .map(|&k| if r.board.len() >= k { classify((a, b), &r.board[..k]).name().to_string() } else { String::new() })
                    .collect();
                (cards(&[a, b]), cl)
            }
            None => (String::new(), vec![String::new(); 3]),
        };
        let won = match r.won[p] {
            Some(true) => "1",
            Some(false) => "0",
            None => "",
        };
        let _ = writeln!(
            out,
            "{venue}\t{}\t{}\t{hand}\t{}\t{}\t{hole}\t{}\t{}\t{}\t{role}\t{frac}\t{}\t{}\t{}\t{}\t{won}\t{}",
            table_size(r.n),
            r.n,
            names[p],
            POS_NAMES[pos_index(p, r.n)],
            cards(&r.board),
            line_of(r, p),
            (pfa == Some(p)) as u8,
            cls[0],
            cls[1],
            cls[2],
            r.showed[p] as u8,
            r.allin as u8
        );
    }
}

fn decision_rows(r: &Replay, venue: &str, hand: &str, names: &[String], out: &mut String) {
    use std::fmt::Write as _;
    for d in &r.decisions {
        let hole = r.holes[d.p].map(|(a, b)| cards(&[a, b])).unwrap_or_default();
        let bl = d.board_len as usize;
        let cls = match r.holes[d.p] {
            Some(h) if bl >= 3 => classify(h, &r.board[..bl]).name(),
            _ => "",
        };
        // bet faced as a fraction of the pot before it; or the bet made, as a fraction of the pot
        let frac = if d.to_call > 0.0 && d.pot - d.to_call > 0.0 {
            format!("{:.3}", d.to_call / (d.pot - d.to_call))
        } else if d.act == Act::Bet {
            format!("{:.3}", d.to / d.pot.max(1e-9))
        } else {
            String::new()
        };
        // whose street it was: the previous street's aggressor, a bet into him (donk), checked to
        // by him, or nobody bet last street
        let role = match d.prev_aggr {
            _ if d.street == 0 => "",
            Some(a) if a == d.p => "aggr",
            Some(_) if !d.prev_aggr_acted && d.prev_aggr_can_act => "donk",
            Some(_) => "checked_to",
            None => "none",
        };
        let _ = writeln!(
            out,
            "{venue}\t{hand}\t{}\t{}\t{}\t{}\t{}\t{:.3}\t{:.3}\t{:.3}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{cls}\t{frac}\t{role}",
            names[d.p],
            r.n,
            POS_NAMES[pos_index(d.p, r.n)],
            d.street,
            d.act.code(),
            d.to / r.bb,
            d.to_call / r.bb,
            d.pot / r.bb,
            d.raises,
            d.limpers,
            (d.prev_aggr == Some(d.p)) as u8,
            d.live,
            d.allin as u8,
            hole,
            cards(&r.board[..d.board_len as usize]),
        );
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut inputs = Vec::new();
    let mut out_dir: Option<PathBuf> = None;
    let mut want_decisions = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                i += 1;
                out_dir = Some(PathBuf::from(args.get(i).context("--out needs a folder")?));
            }
            "--decisions" => want_decisions = true,
            a => inputs.push(PathBuf::from(a)),
        }
        i += 1;
    }
    let Some(out_dir) = out_dir else { bail!("usage: ps-phh <files or folders…> --out DIR [--decisions]") };
    fs::create_dir_all(&out_dir)?;
    let mut files = Vec::new();
    for p in &inputs {
        walk(p, &mut files)?;
    }
    eprintln!("{} files", files.len());

    let sd = Mutex::new(BufWriter::new(fs::File::create(out_dir.join("showdowns.tsv"))?));
    writeln!(
        sd.lock().unwrap(),
        "venue\ttable\tn\thand\tplayer\tpos\thole\tboard\tline\tpfa\triver_role\triver_frac\tcls_flop\tcls_turn\tcls_river\tshowed\twon\tallin"
    )?;
    let dec = if want_decisions {
        let f = Mutex::new(BufWriter::new(fs::File::create(out_dir.join("decisions.tsv"))?));
        writeln!(
            f.lock().unwrap(),
            "venue\thand\tplayer\tn\tpos\tstreet\tact\tto_bb\tto_call_bb\tpot_bb\traises\tlimpers\tis_prev_aggr\tlive\tallin\thole\tboard\tcls\tfrac\trole"
        )?;
        Some(f)
    } else {
        None
    };
    let done = std::sync::atomic::AtomicUsize::new(0);

    let total = files
        .par_iter()
        .enumerate()
        .fold(Part::default, |mut part, (fi, f)| {
            let text = match fs::read_to_string(f) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("{}: {e}", f.display());
                    return part;
                }
            };
            let mut sd_buf = String::new();
            let mut dec_buf = String::new();
            for h in parse::parse_text(&text) {
                part.read += 1;
                match replay(&h) {
                    Ok(r) => {
                        part.kept += 1;
                        *part.venues.entry(h.venue.clone()).or_default() += 1;
                        let size = table_size(r.n);
                        let keys: Vec<String> = h.players.iter().map(|p| format!("{}\t{}\t{}", h.venue, p, size)).collect();
                        for k in &keys {
                            part.players.entry(k.clone()).or_default();
                        }
                        // distinct players only (a name twice at one table would be a data error)
                        let mut cs: Vec<Counters> = keys.iter().map(|_| Counters::default()).collect();
                        {
                            let mut refs: Vec<&mut Counters> = cs.iter_mut().collect();
                            tally(&r, &mut refs);
                        }
                        for (k, c) in keys.iter().zip(&cs) {
                            part.players.get_mut(k).unwrap().merge(c);
                        }
                        // hand numbers repeat across files (each Pluribus session starts at 0)
                        let hand_id = format!("{fi}:{}", h.hand);
                        showdown_rows(&r, &h.venue, &hand_id, &h.players, &mut sd_buf);
                        if dec.is_some() {
                            decision_rows(&r, &h.venue, &hand_id, &h.players, &mut dec_buf);
                        }
                    }
                    Err(s) => *part.skipped.entry(Skip::name(s)).or_default() += 1,
                }
            }
            sd.lock().unwrap().write_all(sd_buf.as_bytes()).ok();
            if let Some(d) = &dec {
                d.lock().unwrap().write_all(dec_buf.as_bytes()).ok();
            }
            let k = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if k % 500 == 0 {
                eprintln!("{k}/{} files", files.len());
            }
            part
        })
        .reduce(Part::default, Part::merge);
    sd.lock().unwrap().flush()?;
    if let Some(d) = &dec {
        d.lock().unwrap().flush()?;
    }

    let mut w = BufWriter::new(fs::File::create(out_dir.join("players.tsv"))?);
    writeln!(w, "venue\tplayer\ttable\t{}", NAMES.join("\t"))?;
    let mut keys: Vec<_> = total.players.keys().cloned().collect();
    keys.sort();
    for k in keys {
        let c = &total.players[&k];
        let vals: Vec<String> = c.0.iter().map(|x| x.to_string()).collect();
        writeln!(w, "{k}\t{}", vals.join("\t"))?;
    }
    w.flush()?;
    let summary = serde_json::json!({
        "files": files.len(),
        "hands_read": total.read,
        "hands_kept": total.kept,
        "skipped": total.skipped,
        "venues": total.venues,
        "player_rows": total.players.len(),
    });
    fs::write(out_dir.join("summary.json"), serde_json::to_string_pretty(&summary)?)?;
    eprintln!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
