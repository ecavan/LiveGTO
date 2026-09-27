//! Builds the puzzle library the app ships with.
//!
//! For each spot family (a preflop situation) and flop:
//!   1. Solve the flop with GTO (coarse tree), only to get *realistic ranges* at the start of the
//!      turn after common flop lines (c-bet called, checked through).
//!   2. For sampled turn cards: analyse the turn decisions (IP after a check, OOP facing a bet)
//!      against every profile.
//!   3. Solve the turn with GTO to get river ranges after common turn lines, sample river cards,
//!      and analyse the river decisions the same way.
//! Each (decision spot × profile) becomes one record: the table picture, the range-vs-range grids,
//! the class-level answers, and a handful of puzzles — real hole cards with one correct action.
//!
//! Profiles act from the street of the decision onwards; earlier streets are GTO. (A station's
//! flop calls would make his turn range wider still — see DESIGN.md "Open questions".)

use crate::analyze::{analyze_many, Options, Report};
use crate::profile::Profile;
use crate::spot::{action_label, match_action, pot_at, Seat, Sizes, Spot, CHIPS_PER_BB};
use anyhow::{anyhow, Context, Result};
use postflop_solver::*;
use ps_core::HandClass;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Family {
    pub id: String,
    pub name: String,
    /// One line describing the preflop action, e.g. "BTN opens 2.5bb, BB calls".
    pub preflop: String,
    pub oop_pos: String,
    pub ip_pos: String,
    pub oop_range: String,
    pub ip_range: String,
    /// Pot and effective stack at the flop, bb.
    pub pot: f64,
    pub stack: f64,
    pub flops: Vec<String>,
    #[serde(default = "d_turns")]
    pub turns_per_line: usize,
    #[serde(default = "d_rivers")]
    pub rivers_per_line: usize,
    /// Profile files (relative to the families file's `profiles_dir`).
    pub profiles: Vec<String>,
    #[serde(default = "d_seed")]
    pub seed: u64,
}

fn d_turns() -> usize {
    2
}
fn d_rivers() -> usize {
    1
}
fn d_seed() -> u64 {
    7
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LibraryConfig {
    pub profiles_dir: String,
    pub family: Vec<Family>,
}

/// Flop lines that reach the turn, and turn lines that reach the river (solver line tokens).
const STREET_LINES: &[(&str, &[&str])] = &[("cbet_called", &["x", "b33", "c"]), ("checked", &["x", "x"])];
const TURN_LINES: &[(&str, &[&str])] = &[("barrel_called", &["x", "b75", "c"]), ("checked", &["x", "x"])];
/// Decisions studied on each street: (id, who is hero, line to the decision, description).
const DECISIONS: &[(&str, Seat, &[&str], &str)] = &[
    ("ip_checked_to", Seat::Ip, &["x"], "checked to you"),
    ("oop_vs_bet", Seat::Oop, &["x", "b75"], "facing a 75% bet"),
];

/// Tiny deterministic RNG (xorshift) so the library is reproducible without a dependency.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn pick_cards(&mut self, mask: u64, n: usize) -> Vec<u8> {
        let mut cards: Vec<u8> = (0..52u8).filter(|&c| mask & (1u64 << c) != 0).collect();
        let mut out = Vec::new();
        while out.len() < n && !cards.is_empty() {
            let i = (self.next() % cards.len() as u64) as usize;
            out.push(cards.swap_remove(i));
        }
        out
    }
}

/// Ranges, pot and stack after `line` on a solved game (which must end at a chance node).
struct Continuation {
    oop_range: String,
    ip_range: String,
    pot: f64,
    stack: f64,
    history: Vec<String>,
    dealable: u64,
}

fn continue_after(game: &mut PostFlopGame, line: &[&str], pos: [&str; 2]) -> Result<Continuation> {
    game.back_to_root();
    let mut history = Vec::new();
    for tok in line {
        let idx = match_action(game, tok)?;
        let who = pos[game.current_player()];
        history.push(format!("{who} {}", action_label(&game.available_actions()[idx], pot_at(game))));
        game.play(idx);
    }
    if !game.is_chance_node() {
        anyhow::bail!("line {line:?} does not end the street");
    }
    let tb = game.total_bet_amount();
    let range = |p: usize| -> Result<String> {
        let r = Range::from_hands_weights(game.private_cards(p), game.weights(p)).map_err(|e| anyhow!(e))?;
        Ok(r.to_string())
    };
    Ok(Continuation {
        oop_range: range(0)?,
        ip_range: range(1)?,
        pot: pot_at(game) as f64 / CHIPS_PER_BB,
        stack: (game.tree_config().effective_stack - tb[0]) as f64 / CHIPS_PER_BB,
        history,
        dealable: game.possible_cards(),
    })
}

fn flop_game(fam: &Family, flop: &str) -> Result<PostFlopGame> {
    let card_config = CardConfig {
        range: [
            fam.oop_range.parse().map_err(|e| anyhow!("oop_range: {e}"))?,
            fam.ip_range.parse().map_err(|e| anyhow!("ip_range: {e}"))?,
        ],
        flop: flop_from_str(flop).map_err(|e| anyhow!(e))?,
        turn: NOT_DEALT,
        river: NOT_DEALT,
    };
    // Coarse tree: its only job is realistic turn ranges after "c-bet called" / "checked through".
    let o = |b: &str, r: &str| BetSizeOptions::try_from((b, r)).map_err(|e| anyhow!(e));
    let tree = TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot: (fam.pot * CHIPS_PER_BB).round() as i32,
        effective_stack: (fam.stack * CHIPS_PER_BB).round() as i32,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [o("", "3x")?, o("33%", "3x")?],
        turn_bet_sizes: [o("75%", "")?, o("75%", "")?],
        river_bet_sizes: [o("75%, a", "")?, o("75%, a", "")?],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    };
    PostFlopGame::with_config(card_config, ActionTree::new(tree).map_err(|e| anyhow!(e))?).map_err(|e| anyhow!(e))
}

fn spot_from(_fam: &Family, board: &str, c: &Continuation, hero: Seat, line: &[&str], name: &str) -> Spot {
    Spot {
        name: name.to_string(),
        description: String::new(),
        board: board.to_string(),
        oop_range: c.oop_range.clone(),
        ip_range: c.ip_range.clone(),
        pot: c.pot,
        stack: c.stack,
        hero,
        line: line.iter().map(|s| s.to_string()).collect(),
        sizes: Sizes::default(),
        sizes_oop: None,
        sizes_ip: None,
        add_allin_threshold: 1.5,
        iterations: 1000,
        target_pct: 0.2,
    }
}

// ------------------------------------------------------------------------------------------
// Grids and puzzles
// ------------------------------------------------------------------------------------------

fn rank_idx(c: char) -> usize {
    "23456789TJQKA".find(c).unwrap()
}

/// 13×13 cell index (row-major, A first). Suited above the diagonal, offsuit below.
fn cell(cards: &str) -> usize {
    let b = cards.as_bytes();
    let (r1, s1, r2, s2) = (rank_idx(b[0] as char), b[1], rank_idx(b[2] as char), b[3]);
    let (hi, lo) = (r1.max(r2), r1.min(r2));
    let (row, col) = if hi == lo {
        (12 - hi, 12 - hi)
    } else if s1 == s2 {
        (12 - hi, 12 - lo)
    } else {
        (12 - lo, 12 - hi)
    };
    row * 13 + col
}

/// Number of combos of each cell that are not blocked by the board.
fn cell_combos(board: &[u8]) -> Vec<f64> {
    let mut n = vec![0.0; 169];
    for c1 in 0..52u8 {
        for c2 in 0..c1 {
            if board.contains(&c1) || board.contains(&c2) {
                continue;
            }
            let s = format!("{}{}", ps_core::card_to_string(c1), ps_core::card_to_string(c2));
            n[cell(&s)] += 1.0;
        }
    }
    n
}

fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}
fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// Cell frequency (share of the cell's live combos that reach here) and reach-weighted equity.
fn grid(board: &[u8], rows: impl Iterator<Item = (String, f64, f64)>) -> Value {
    let n = cell_combos(board);
    let mut w = vec![0.0; 169];
    let mut e = vec![0.0; 169];
    for (cards, reach, eq) in rows {
        let i = cell(&cards);
        w[i] += reach;
        e[i] += reach * eq;
    }
    let freq: Vec<f64> = (0..169).map(|i| if n[i] > 0.0 { r3(w[i] / n[i]) } else { 0.0 }).collect();
    let eq: Vec<f64> = (0..169).map(|i| if w[i] > 0.0 { r3(e[i] / w[i]) } else { 0.0 }).collect();
    json!({ "freq": freq, "eq": eq })
}

/// Heuristic puzzle rating until real solve-rate data exists. See DESIGN.md §5.
fn rating(exploit_shift: bool, gap_pct: f64, class: HandClass, answer: &str) -> i32 {
    let mut r = 900.0;
    if exploit_shift {
        r += 300.0;
    }
    r += 250.0 * (1.0 - (gap_pct / 25.0).min(1.0));
    let counterintuitive = match class {
        HandClass::Monster | HandClass::Strong => answer == "fold" || answer == "check",
        HandClass::Weak | HandClass::Air => answer == "call" || answer == "raise" || answer.starts_with("bet") || answer == "all-in",
        _ => false,
    };
    if counterintuitive {
        r += 150.0;
    }
    r.clamp(400.0, 2200.0).round() as i32
}

fn puzzles(r: &Report, is_gto: bool, max: usize) -> Vec<Value> {
    let pot = r.pot_bb;
    let min_gap = (0.04 * pot).max(0.3);
    let fine_tol = 0.01 * pot;
    let mut cands: Vec<(f64, Value, HandClass)> = Vec::new();
    for c in &r.combos {
        let (w, ev, answer) = if is_gto {
            (c.w_gto, &c.ev_gto, c.pure_gto)
        } else {
            (c.w_exploit, &c.ev_exploit, c.pure_exploit)
        };
        if w <= 1e-4 {
            continue;
        }
        let best = ev.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let fine: Vec<usize> = (0..ev.len()).filter(|&a| best - ev[a] <= fine_tol).collect();
        let wrong_best = (0..ev.len()).filter(|a| !fine.contains(a)).map(|a| ev[a]).fold(f64::NEG_INFINITY, f64::max);
        if !wrong_best.is_finite() || best - wrong_best < min_gap || !fine.contains(&answer) {
            continue;
        }
        let gap = best - wrong_best;
        let gto_answer = c.pure_gto;
        let shift = !is_gto && !fine.contains(&gto_answer);
        let rel: Vec<f64> = ev.iter().map(|x| r2(x - best)).collect();
        let rel_gto: Vec<f64> = c.ev_gto.iter().map(|x| r2(x - c.ev_gto.iter().cloned().fold(f64::NEG_INFINITY, f64::max))).collect();
        let tags: Vec<&str> = if shift { vec!["exploit"] } else { vec![] };
        let p = json!({
            "cards": c.cards,
            "hand": c.hand,
            "class": c.class,
            "answer": answer,
            "fine": fine,
            "gto_answer": gto_answer,
            "ev": rel,
            "ev_gto": rel_gto,
            "eq": r3(if is_gto { c.eq_gto } else { c.eq_exploit }),
            "gap_bb": r2(gap),
            "rating": rating(shift, 100.0 * gap / pot, c.class, &r.actions_short[answer]),
            "tags": tags,
        });
        // Prefer common hands, and hands where the exploit changes the answer.
        let score = w * if shift { 3.0 } else { 1.0 };
        cands.push((score, p, c.class));
    }
    cands.sort_by(|a, b| b.0.total_cmp(&a.0));
    // Round-robin over classes so a record isn't all "air, fold".
    let mut out = Vec::new();
    let mut used = vec![false; cands.len()];
    while out.len() < max {
        let mut took = false;
        for cls in HandClass::ALL {
            if let Some(i) = (0..cands.len()).find(|&i| !used[i] && cands[i].2 == cls) {
                used[i] = true;
                out.push(cands[i].1.clone());
                took = true;
                if out.len() >= max {
                    break;
                }
            }
        }
        if !took {
            break;
        }
    }
    out
}

fn record(fam: &Family, id: &str, board: &str, prior: &[String], dec: &str, desc: &str, profile_file: &str, profile: &Profile, r: &Report) -> Value {
    let hero_pos = match r.hero {
        Seat::Oop => &fam.oop_pos,
        Seat::Ip => &fam.ip_pos,
    };
    let villain_pos = match r.hero {
        Seat::Oop => &fam.ip_pos,
        Seat::Ip => &fam.oop_pos,
    };
    let board_cards = ps_core::cards_from_str(board).unwrap();
    let street_hist: Vec<String> = r
        .history
        .iter()
        .map(|h| h.replacen("hero", hero_pos, 1).replacen("villain", villain_pos, 1))
        .collect();
    let is_gto = profile.rules.is_empty();
    let h = &r.headline;
    json!({
        "id": id,
        "family": fam.id,
        "family_name": fam.name,
        "street": r.street,
        "decision": dec,
        "decision_desc": desc,
        "board": board_cards.iter().map(|&c| ps_core::card_to_string(c)).collect::<Vec<_>>(),
        "hero": { "pos": hero_pos, "seat": r.hero },
        "villain": { "pos": villain_pos, "profile": profile_file.trim_end_matches(".toml"),
                      "name": profile.name, "desc": profile.description.trim(),
                      "notes": profile.rules.iter().map(|x| x.note.clone()).filter(|n| !n.is_empty()).collect::<Vec<_>>() },
        "history": { "preflop": fam.preflop, "prior": prior, "street": street_hist },
        "pot": r2(r.pot_bb), "to_call": r2(r.to_call_bb), "stack": r2(r.stack_bb),
        "actions": r.actions, "actions_short": r.actions_short,
        "headline": {
            "gto_vs_gto": r2(h.gto_vs_gto), "gto_vs_profile": r2(h.gto_vs_profile),
            "exploit_vs_profile": r2(h.best_exploit_vs_profile), "pure_exploit": r2(h.pure_exploit_vs_profile),
        },
        "classes": r.classes.iter().map(|c| json!({
            "class": c.class,
            "gto": { "weight": r3(c.gto.weight), "pure": c.gto.pure.iter().map(|x| r3(*x)).collect::<Vec<_>>() },
            "exploit": { "weight": r3(c.exploit.weight), "pure": c.exploit.pure.iter().map(|x| r3(*x)).collect::<Vec<_>>() },
        })).collect::<Vec<_>>(),
        "villain_range": r.villain_range.iter().map(|(c, g, p)| json!([c, r3(*g), r3(*p)])).collect::<Vec<_>>(),
        "grid": {
            "hero": grid(&board_cards, r.combos.iter().map(|c| (c.cards.clone(), if is_gto { c.reach_gto } else { c.reach_exploit }, if is_gto { c.eq_gto } else { c.eq_exploit }))),
            "villain_gto": grid(&board_cards, r.villain_combos.iter().map(|c| (c.cards.clone(), c.reach_gto, c.eq_gto))),
            "villain_profile": grid(&board_cards, r.villain_combos.iter().map(|c| (c.cards.clone(), c.reach_profile, c.eq_profile))),
        },
        "puzzles": puzzles(r, is_gto, 8),
    })
}

/// Builds the library. Writes one JSON file per flop plus `index.json`.
pub fn build(config_path: &Path, out_dir: &Path, only_flops: Option<usize>, log: &mut dyn FnMut(&str)) -> Result<()> {
    let cfg_str = std::fs::read_to_string(config_path).with_context(|| format!("reading {}", config_path.display()))?;
    let cfg: LibraryConfig = toml::from_str(&cfg_str)?;
    let base = config_path.parent().unwrap_or(Path::new("."));
    let profiles_dir = base.join(&cfg.profiles_dir);
    std::fs::create_dir_all(out_dir)?;
    let mut index = Vec::new();
    for fam in &cfg.family {
        let profiles: Vec<(String, Profile)> = fam
            .profiles
            .iter()
            .map(|f| Ok((f.clone(), Profile::load(&profiles_dir.join(f))?)))
            .collect::<Result<_>>()?;
        let profs: Vec<Profile> = profiles.iter().map(|(_, p)| p.clone()).collect();
        let opts = Options { worst_case: false, ..Options::default() };
        let mut rng = Rng(fam.seed.max(1));
        let pos = [fam.oop_pos.as_str(), fam.ip_pos.as_str()];
        for flop in fam.flops.iter().take(only_flops.unwrap_or(usize::MAX)) {
            let file = format!("{}_{}.json", fam.id, flop);
            let path = out_dir.join(&file);
            if path.exists() {
                log(&format!("skip {file} (exists)"));
                let v: Value = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
                index.extend(index_entries(&v, &file));
                continue;
            }
            let t0 = std::time::Instant::now();
            log(&format!("[{}] flop {flop}: solving GTO for turn ranges", fam.id));
            let mut fg = flop_game(fam, flop)?;
            fg.allocate_memory(true);
            let pot_chips = (fam.pot * CHIPS_PER_BB) as f32;
            solve(&mut fg, 600, pot_chips * 0.005, false);
            let mut records = Vec::new();
            for (fl_id, fl_line) in STREET_LINES {
                let cont = match continue_after(&mut fg, fl_line, pos) {
                    Ok(c) => c,
                    Err(e) => {
                        log(&format!("  flop line {fl_id}: {e}"));
                        continue;
                    }
                };
                for turn in rng.pick_cards(cont.dealable, fam.turns_per_line) {
                    let tboard = format!("{flop}{}", ps_core::card_to_string(turn));
                    let mut prior_t = cont.history.clone();
                    prior_t.push(ps_core::card_to_string(turn));
                    for (dec, hero, line, desc) in DECISIONS {
                        let id = format!("{}/{}/{}/{}", fam.id, tboard, fl_id, dec);
                        let spot = spot_from(fam, &tboard, &cont, *hero, line, &id);
                        match analyze_many(&spot, &profs, &opts) {
                            Ok(rs) => {
                                for ((pf, prof), r) in profiles.iter().zip(&rs) {
                                    records.push(record(fam, &format!("{id}/{}", pf.trim_end_matches(".toml")), &tboard, &prior_t, dec, desc, pf, prof, r));
                                }
                            }
                            Err(e) => log(&format!("  {id}: {e}")),
                        }
                        log(&format!("  {id} ({:.0}s)", t0.elapsed().as_secs_f64()));
                    }
                    // River: GTO turn solve for river ranges.
                    let tspot = spot_from(fam, &tboard, &cont, Seat::Ip, &[], "turn");
                    let mut tg = tspot.build_game()?;
                    tg.allocate_memory(false);
                    solve(&mut tg, 1000, (cont.pot * CHIPS_PER_BB * 0.002) as f32, false);
                    for (tl_id, tl_line) in TURN_LINES {
                        let rc = match continue_after(&mut tg, tl_line, pos) {
                            Ok(c) => c,
                            Err(e) => {
                                log(&format!("  turn line {tl_id}: {e}"));
                                continue;
                            }
                        };
                        for river in rng.pick_cards(rc.dealable, fam.rivers_per_line) {
                            let rboard = format!("{tboard}{}", ps_core::card_to_string(river));
                            let mut prior_r = prior_t.clone();
                            prior_r.extend(rc.history.iter().cloned());
                            prior_r.push(ps_core::card_to_string(river));
                            for (dec, hero, line, desc) in DECISIONS {
                                let id = format!("{}/{}/{}-{}/{}", fam.id, rboard, fl_id, tl_id, dec);
                                let spot = spot_from(fam, &rboard, &rc, *hero, line, &id);
                                match analyze_many(&spot, &profs, &opts) {
                                    Ok(rs) => {
                                        for ((pf, prof), r) in profiles.iter().zip(&rs) {
                                            records.push(record(fam, &format!("{id}/{}", pf.trim_end_matches(".toml")), &rboard, &prior_r, dec, desc, pf, prof, r));
                                        }
                                    }
                                    Err(e) => log(&format!("  {id}: {e}")),
                                }
                                log(&format!("  {id} ({:.0}s)", t0.elapsed().as_secs_f64()));
                            }
                        }
                    }
                }
            }
            let v = json!({ "family": fam.id, "flop": flop, "records": records });
            std::fs::write(&path, serde_json::to_string(&v)?)?;
            index.extend(index_entries(&v, &file));
            log(&format!("  wrote {file}: {} records in {:.0}s", v["records"].as_array().unwrap().len(), t0.elapsed().as_secs_f64()));
        }
    }
    let idx = json!({ "version": 1, "records": index });
    std::fs::write(out_dir.join("index.json"), serde_json::to_string(&idx)?)?;
    Ok(())
}

fn index_entries(v: &Value, file: &str) -> Vec<Value> {
    v["records"]
        .as_array()
        .map(|rs| {
            rs.iter()
                .map(|r| {
                    json!({
                        "id": r["id"], "file": file, "street": r["street"], "decision": r["decision"],
                        "hero": r["hero"]["pos"], "profile": r["villain"]["profile"],
                        "board": r["board"], "n": r["puzzles"].as_array().map_or(0, |p| p.len()),
                        "ratings": r["puzzles"].as_array().map(|p| p.iter().map(|x| x["rating"].clone()).collect::<Vec<_>>()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}
