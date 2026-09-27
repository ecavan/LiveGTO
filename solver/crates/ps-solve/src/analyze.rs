//! The core study computation for one spot and one villain profile.
//!
//! Five copies of the same game tree, lined up node-for-node by action history:
//!
//! | game | hero            | villain            | what it answers                                 |
//! |------|-----------------|--------------------|-------------------------------------------------|
//! | A    | solved          | solved             | GTO baseline                                    |
//! | B    | solved          | locked = profile   | best exploit of this villain                    |
//! | C    | locked = GTO    | locked = profile   | what GTO alone wins against him                 |
//! | P    | locked = pure(B)| locked = profile   | exploit with exactly one action per hand        |
//! | Q    | locked = quota(A)| free (best resp.) | worst case of a never-mix GTO playbook          |
//!
//! Both playbooks give every hand exactly one action — the live-player answer format, no dice:
//! - pure(B), against a known villain: each hand takes its highest-EV action. Against a fixed
//!   opponent a best response never needs to mix, so this loses (almost) nothing.
//! - quota(A), the GTO baseline: GTO mixes only where hands are indifferent, so "highest EV" is a
//!   coin flip there and can tilt a whole class to one side (every bluff-catcher folds). Instead we
//!   keep GTO's *range-level* frequencies and give each action to the hands that lean towards it
//!   most: "call with the best 40% of your bluff-catchers, fold the rest". That is how strong live
//!   players stay balanced without randomising.
//!
//! Why this is exact rather than learned: with villain's strategy σ_V fixed at every node, hero's
//! best response BR(σ_V) = argmax_σH u_H(σ_H, σ_V) is a one-player optimisation. CFR on game B
//! converges to it, and `compute_mes_ev` gives its value directly, so the two can be checked
//! against each other.

use crate::profile::{NodeCtx, Profile, Street};
use crate::spot::{action_label, pot_at, Spot, CHIPS_PER_BB};
use anyhow::Result;
use postflop_solver::*;
use ps_core::HandClass;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct Options {
    /// Profile intensity λ ∈ [0, 1].
    pub intensity: f64,
    /// Actions within this % of the pot of the best EV are shown as "also fine".
    pub fine_pct: f64,
    pub print_progress: bool,
    /// Also compute the worst case of the never-mix GTO playbook (one extra tree; slower).
    pub worst_case: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            intensity: 1.0,
            fine_pct: 1.0,
            print_progress: false,
            worst_case: true,
        }
    }
}

/// Hero's EV in each configuration, in bb, as hero's expected share of the starting pot.
#[derive(Debug, Clone, Serialize)]
pub struct Headline {
    pub gto_vs_gto: f64,
    pub gto_vs_profile: f64,
    pub best_exploit_vs_profile: f64,
    pub solved_exploit_vs_profile: f64,
    pub pure_exploit_vs_profile: f64,
    pub pure_gto_vs_perfect_opponent: f64,
    /// Exploitability of the GTO solve, % of starting pot.
    pub gto_exploitability_pct: f64,
    /// best − solved exploit value, % of starting pot (convergence of game B).
    pub exploit_gap_pct: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    /// Share of hero's range (by combo weight) at the decision node.
    pub weight: f64,
    /// Randomised solver mix: P(action).
    pub mix: Vec<f64>,
    /// Share of combos whose single best action is each action (the pure answer).
    pub pure: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClassRow {
    pub class: HandClass,
    pub gto: Plan,
    pub exploit: Plan,
}

#[derive(Debug, Clone, Serialize)]
pub struct HandRow {
    /// Hand type, e.g. `AKs`, `QQ`, `T9o`.
    pub hand: String,
    pub class: HandClass,
    pub combos: usize,
    pub weight_gto: f64,
    pub weight_exploit: f64,
    /// Average EV of each action, bb, relative to the best action (so the best is 0).
    pub ev_gto: Vec<f64>,
    pub ev_exploit: Vec<f64>,
    /// Solver's randomised mix (reach-weighted over the combos), for reference only.
    pub mix_gto: Vec<f64>,
    pub mix_exploit: Vec<f64>,
    /// Highest-EV action.
    pub best_gto: usize,
    pub best_exploit: usize,
    /// The one-action answer (quota playbook for GTO, highest EV vs the profile), by combo majority.
    pub pure_gto: usize,
    pub pure_exploit: usize,
    /// Actions within `fine_pct` of the pot of the best one.
    pub fine_gto: Vec<usize>,
    pub fine_exploit: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub spot: String,
    pub profile: String,
    pub intensity: f64,
    pub board: String,
    pub street: Street,
    pub pot_bb: f64,
    /// Amount hero must call (0 if not facing a bet).
    pub to_call_bb: f64,
    /// Effective stack behind at the decision (after bets so far).
    pub stack_bb: f64,
    pub hero: crate::spot::Seat,
    pub history: Vec<String>,
    pub actions: Vec<String>,
    /// Short labels for tables: `check`, `bet 33%`, `raise`, `all-in`.
    pub actions_short: Vec<String>,
    pub headline: Headline,
    pub classes: Vec<ClassRow>,
    pub hands: Vec<HandRow>,
    /// Villain's range at hero's decision, by hand class: (class, share if GTO, share if profile).
    pub villain_range: Vec<(HandClass, f64, f64)>,
    /// Every hero combo that can be here (real cards, for puzzles and range grids).
    pub combos: Vec<ComboRow>,
    /// Every villain combo in his range here, under GTO and under the profile.
    pub villain_combos: Vec<VillainCombo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComboRow {
    pub cards: String,
    pub hand: String,
    pub class: HandClass,
    /// Share of hero's range (normalised weight) in the GTO line / the exploit line.
    pub w_gto: f64,
    pub w_exploit: f64,
    /// EV of each action in bb (hero's share of the pot from here on), vs GTO / vs the profile.
    pub ev_gto: Vec<f64>,
    pub ev_exploit: Vec<f64>,
    /// One-action answers: GTO playbook and best exploit.
    pub pure_gto: usize,
    pub pure_exploit: usize,
    /// Equity vs villain's range at this node (GTO range / profile range).
    pub eq_gto: f64,
    pub eq_exploit: f64,
    /// Raw reach (0..1): how much of this combo gets here, GTO line / exploit line.
    pub reach_gto: f64,
    pub reach_exploit: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct VillainCombo {
    pub cards: String,
    pub hand: String,
    pub class: HandClass,
    pub w_gto: f64,
    pub w_profile: f64,
    pub eq_gto: f64,
    pub eq_profile: f64,
    pub reach_gto: f64,
    pub reach_profile: f64,
}

type History = Vec<usize>;

/// Visits every decision node (depth-first), calling `f(game, history)` with the game positioned
/// at that node.
pub fn for_each_decision_node(
    game: &mut PostFlopGame,
    mut f: impl FnMut(&mut PostFlopGame, &[usize]),
) {
    let mut stack: Vec<History> = vec![vec![]];
    while let Some(h) = stack.pop() {
        game.apply_history(&h);
        if game.is_terminal_node() {
            continue;
        }
        if game.is_chance_node() {
            let mut m = game.possible_cards();
            while m != 0 {
                let c = m.trailing_zeros() as usize;
                m &= m - 1;
                let mut k = h.clone();
                k.push(c);
                stack.push(k);
            }
            continue;
        }
        let n = game.available_actions().len();
        f(game, &h);
        for i in 0..n {
            let mut k = h.clone();
            k.push(i);
            stack.push(k);
        }
    }
}

/// Hand classes of a player's private hands on a board, cached per board.
struct ClassCache {
    hands: [Vec<(u8, u8)>; 2],
    cache: HashMap<(Vec<u8>, usize), Vec<HandClass>>,
}

impl ClassCache {
    fn new(game: &PostFlopGame) -> Self {
        ClassCache {
            hands: [
                game.private_cards(0).to_vec(),
                game.private_cards(1).to_vec(),
            ],
            cache: HashMap::new(),
        }
    }
    fn get(&mut self, board: &[u8], player: usize) -> &[HandClass] {
        let hands = &self.hands[player];
        self.cache
            .entry((board.to_vec(), player))
            .or_insert_with(|| hands.iter().map(|&h| ps_core::classify(h, board)).collect())
    }
}

fn node_street(game: &PostFlopGame) -> Street {
    Street::from_board_len(game.current_board().len())
}

fn facing_bet(actions: &[Action]) -> bool {
    actions.iter().any(|a| matches!(a, Action::Fold))
}

/// The profile's version of the villain strategy at the current node of `solved`.
fn distorted_strategy(
    game: &PostFlopGame,
    profile: &Profile,
    classes: &[HandClass],
    intensity: f64,
) -> Vec<f32> {
    let actions = game.available_actions();
    let facing = facing_bet(&actions);
    let pot = pot_at(game);
    let tb = game.total_bet_amount();
    let to_call = (tb[0] - tb[1]).abs();
    let facing_fraction = facing.then(|| to_call as f64 / (pot - to_call).max(1) as f64);
    let ctx = NodeCtx {
        street: node_street(game),
        facing_bet: facing,
        facing_fraction,
        actions: &actions,
        pot,
    };
    let strat = game.strategy();
    let n_act = actions.len();
    let n_hands = classes.len();
    let types: Vec<String> = game.private_cards(game.current_player()).iter().map(|&h| hand_type(h)).collect();
    let mut out = vec![0f32; strat.len()];
    let mut p = vec![0f64; n_act];
    for j in 0..n_hands {
        for a in 0..n_act {
            p[a] = strat[a * n_hands + j] as f64;
        }
        if p.iter().sum::<f64>() <= 0.0 {
            continue; // hand not in range / blocked: leave unlocked
        }
        profile.apply_hand(&ctx, classes[j], &types[j], &mut p, intensity);
        for a in 0..n_act {
            out[a * n_hands + j] = p[a] as f32;
        }
    }
    out
}

/// One-hot strategy: each hand plays its single highest-EV action at the current node.
/// Requires a solved game positioned at a decision node of `player`.
fn pure_strategy(game: &mut PostFlopGame, player: usize) -> Vec<f32> {
    game.cache_normalized_weights();
    let evd = game.expected_values_detail(player);
    let n_act = game.available_actions().len();
    let n_hands = game.private_cards(player).len();
    let mut out = vec![0f32; n_act * n_hands];
    for j in 0..n_hands {
        let best = (0..n_act)
            .max_by(|&a, &b| {
                let (x, y) = (evd[a * n_hands + j], evd[b * n_hands + j]);
                let key = |v: f32| if v.is_nan() { f32::NEG_INFINITY } else { v };
                key(x).total_cmp(&key(y))
            })
            .unwrap_or(0);
        out[best * n_hands + j] = 1.0;
    }
    out
}

/// One action per hand that keeps the node's range-level action frequencies (see module docs).
/// A hand may only take an action whose EV is within `fine_pct` % of the pot of its best one, so
/// every answer in the playbook is also a correct answer on its own.
/// Requires a solved game positioned at a decision node of `player`.
///
/// Off the equilibrium path (lines the GTO villain never takes) the villain's reach is zero, so
/// per-hand EVs are undefined there. Those are exactly the lines a best-responding opponent will
/// try, so there we keep GTO's frequencies with hero's raw reach and skip the EV guard.
fn quota_strategy(game: &mut PostFlopGame, player: usize, fine_pct: f64) -> Vec<f32> {
    game.cache_normalized_weights();
    let w = game.weights(player).to_vec();
    let on_path = game
        .normalized_weights(player ^ 1)
        .iter()
        .map(|&x| x as f64)
        .sum::<f64>()
        > 1e-9;
    let s = game.strategy();
    let ev = if on_path {
        game.expected_values_detail(player)
    } else {
        vec![0.0; s.len()]
    };
    let tol = (fine_pct / 100.0 * pot_at(game) as f64) as f32;
    let n_act = game.available_actions().len();
    let n_hands = w.len();
    let mut remaining: Vec<f64> = (0..n_act)
        .map(|a| {
            (0..n_hands)
                .map(|j| w[j] as f64 * s[a * n_hands + j] as f64)
                .sum()
        })
        .collect();
    let mut pairs: Vec<(f32, usize, usize)> = Vec::with_capacity(n_act * n_hands);
    let key = |v: f32| if v.is_nan() { f32::NEG_INFINITY } else { v };
    let best_ev = |j: usize| {
        (0..n_act)
            .map(|a| key(ev[a * n_hands + j]))
            .fold(f32::NEG_INFINITY, f32::max)
    };
    for j in (0..n_hands).filter(|&j| w[j] > 0.0) {
        let top = best_ev(j);
        for a in (0..n_act).filter(|&a| key(ev[a * n_hands + j]) >= top - tol) {
            pairs.push((s[a * n_hands + j], a, j));
        }
    }
    pairs.sort_by(|x, y| y.0.total_cmp(&x.0));
    let mut assigned: Vec<Option<usize>> = vec![None; n_hands];
    for &(_, a, j) in &pairs {
        if assigned[j].is_none() && remaining[a] >= 0.5 * w[j] as f64 {
            assigned[j] = Some(a);
            remaining[a] -= w[j] as f64;
        }
    }
    let mut out = vec![0f32; n_act * n_hands];
    for j in 0..n_hands {
        let a = assigned[j].unwrap_or_else(|| {
            let score = |x: usize| {
                if on_path {
                    key(ev[x * n_hands + j])
                } else {
                    s[x * n_hands + j]
                }
            };
            (0..n_act)
                .max_by(|&x, &y| score(x).total_cmp(&score(y)))
                .unwrap_or(0)
        });
        out[a * n_hands + j] = 1.0;
    }
    out
}

fn allocated(spot: &Spot) -> Result<PostFlopGame> {
    let mut g = spot.build_game()?;
    g.allocate_memory(false);
    Ok(g)
}

fn lock_at(game: &mut PostFlopGame, history: &[usize], strategy: &[f32]) {
    game.apply_history(history);
    game.lock_current_strategy(strategy);
}

fn to_bb(chips: f32, spot: &Spot) -> f64 {
    (chips as f64 + spot.pot_chips() as f64 / 2.0) / CHIPS_PER_BB
}

pub fn analyze(spot: &Spot, profile: &Profile, opts: &Options) -> Result<Report> {
    Ok(analyze_many(spot, std::slice::from_ref(profile), opts)?.remove(0))
}

/// Analyses one spot against several villain profiles, solving the GTO baseline only once.
pub fn analyze_many(spot: &Spot, profiles: &[Profile], opts: &Options) -> Result<Vec<Report>> {
    let target = (spot.target_pct / 100.0 * spot.pot_chips() as f64) as f32;
    let mut a = allocated(spot)?;
    let line = spot.resolve_line(&mut a)?;
    let expl_a = solve(&mut a, spot.iterations, target, opts.print_progress);
    let mut classes = ClassCache::new(&a);
    profiles
        .iter()
        .map(|p| analyze_against(&mut a, &line, expl_a, &mut classes, spot, p, opts))
        .collect()
}

fn analyze_against(
    a: &mut PostFlopGame,
    line: &[usize],
    expl_a: f32,
    classes: &mut ClassCache,
    spot: &Spot,
    profile: &Profile,
    opts: &Options,
) -> Result<Report> {
    let hero = spot.hero();
    let villain = spot.villain();
    let target = (spot.target_pct / 100.0 * spot.pot_chips() as f64) as f32;

    // B, C, Q from A
    let mut b = allocated(spot)?;
    let mut c = allocated(spot)?;
    let mut q = if opts.worst_case { Some(allocated(spot)?) } else { None };
    for_each_decision_node(a, |g, h| {
        let player = g.current_player();
        if player == villain {
            let board = g.current_board();
            let cls = classes.get(&board, villain).to_vec();
            let s = distorted_strategy(g, profile, &cls, opts.intensity);
            lock_at(&mut b, h, &s);
            lock_at(&mut c, h, &s);
        } else {
            let s = g.strategy();
            lock_at(&mut c, h, &s);
            if let Some(q) = q.as_mut() {
                let pure = quota_strategy(g, hero, opts.fine_pct);
                lock_at(q, h, &pure);
            }
        }
    });

    // Solve B: hero's best response against the locked villain. The usual exploitability stop
    // doesn't apply (the locked villain is exploitable by design), so stop on hero's own gap.
    let best_b = compute_mes_ev(&b)[hero];
    let mut t = 0;
    while t < spot.iterations {
        solve_step(&b, t);
        t += 1;
        if t % 10 == 0 && best_b - compute_current_ev(&b)[hero] <= target {
            break;
        }
    }
    finalize(&mut b);

    // P from B
    let mut p = allocated(spot)?;
    for_each_decision_node(&mut b, |g, h| {
        let s = if g.current_player() == villain {
            g.strategy()
        } else {
            pure_strategy(g, hero)
        };
        lock_at(&mut p, h, &s);
    });

    let headline = Headline {
        gto_vs_gto: to_bb(compute_current_ev(&*a)[hero], spot),
        gto_vs_profile: to_bb(compute_current_ev(&c)[hero], spot),
        best_exploit_vs_profile: to_bb(best_b, spot),
        solved_exploit_vs_profile: to_bb(compute_current_ev(&b)[hero], spot),
        pure_exploit_vs_profile: to_bb(compute_current_ev(&p)[hero], spot),
        pure_gto_vs_perfect_opponent: q.as_ref().map_or(f64::NAN, |q| to_bb(-compute_mes_ev(q)[villain], spot)),
        gto_exploitability_pct: 100.0 * expl_a as f64 / spot.pot_chips() as f64,
        exploit_gap_pct: 100.0 * (best_b - compute_current_ev(&b)[hero]) as f64
            / spot.pot_chips() as f64,
    };

    // Decision node report
    a.apply_history(line);
    b.apply_history(line);
    let board = a.current_board();
    let pot = pot_at(&a);
    let actions = a.available_actions();
    let hero_cls = classes.get(&board, hero).to_vec();
    let villain_cls = classes.get(&board, villain).to_vec();
    let hero_cards = a.private_cards(hero).to_vec();
    let fine = opts.fine_pct / 100.0 * pot as f64 / CHIPS_PER_BB;
    let tb = a.total_bet_amount();
    let to_call_bb = (tb[0] - tb[1]).abs() as f64 / CHIPS_PER_BB;
    let stack_bb = (a.tree_config().effective_stack - tb[0].max(tb[1])) as f64 / CHIPS_PER_BB + to_call_bb;

    struct View {
        w: Vec<f32>,
        mix: Vec<f32>,
        ev: Vec<f32>,
        vw: Vec<f32>,
        /// One-hot pure answer per hand.
        pure: Vec<f32>,
        eq: Vec<f32>,
        veq: Vec<f32>,
        /// Raw reach (range weight × own strategy along the line), 0..1 per combo.
        reach: Vec<f32>,
        vreach: Vec<f32>,
    }
    let view = |g: &mut PostFlopGame, quota: bool| {
        let pure = if quota {
            quota_strategy(g, hero, opts.fine_pct)
        } else {
            pure_strategy(g, hero)
        };
        g.cache_normalized_weights();
        View {
            w: g.normalized_weights(hero).to_vec(),
            mix: g.strategy(),
            ev: g.expected_values_detail(hero),
            vw: g.normalized_weights(villain).to_vec(),
            pure,
            eq: g.equity(hero),
            veq: g.equity(villain),
            reach: g.weights(hero).to_vec(),
            vreach: g.weights(villain).to_vec(),
        }
    };
    let va = view(a, true);
    let vb = view(&mut b, false);
    let n_act = actions.len();
    let n_hands = hero_cards.len();
    let pure_of = |v: &View, j: usize| -> usize {
        (0..n_act)
            .find(|&x| v.pure[x * n_hands + j] > 0.5)
            .unwrap_or(0)
    };

    let plan_for = |v: &View, cls: HandClass| -> Plan {
        let mut w = 0.0;
        let mut mix = vec![0.0; n_act];
        let mut pure = vec![0.0; n_act];
        for j in (0..n_hands).filter(|&j| hero_cls[j] == cls) {
            let wj = v.w[j] as f64;
            if wj <= 0.0 {
                continue;
            }
            w += wj;
            for x in 0..n_act {
                mix[x] += wj * v.mix[x * n_hands + j] as f64;
            }
            pure[pure_of(v, j)] += wj;
        }
        if w > 0.0 {
            mix.iter_mut().chain(pure.iter_mut()).for_each(|x| *x /= w);
        }
        Plan {
            weight: w,
            mix,
            pure,
        }
    };
    let tot_a: f64 = va.w.iter().map(|&x| x as f64).sum();
    let tot_b: f64 = vb.w.iter().map(|&x| x as f64).sum();
    let classes_rows: Vec<ClassRow> = HandClass::ALL
        .iter()
        .map(|&cls| {
            let mut g = plan_for(&va, cls);
            let mut e = plan_for(&vb, cls);
            g.weight /= tot_a.max(1e-12);
            e.weight /= tot_b.max(1e-12);
            ClassRow {
                class: cls,
                gto: g,
                exploit: e,
            }
        })
        .filter(|r| r.gto.weight > 0.0 || r.exploit.weight > 0.0)
        .collect();

    // Hand-type rows (AKs / QQ / T9o), split by class because suits change the class.
    let mut groups: BTreeMap<(String, HandClass), Vec<usize>> = BTreeMap::new();
    for j in 0..n_hands {
        if va.w[j] > 0.0 || vb.w[j] > 0.0 {
            groups
                .entry((hand_type(hero_cards[j]), hero_cls[j]))
                .or_default()
                .push(j);
        }
    }
    let group_ev = |v: &View, idx: &[usize]| -> Vec<f64> {
        let (mut s, mut n) = (vec![0.0; n_act], 0.0);
        for &j in idx {
            // weight by the combo's GTO reach so both columns average the same combos
            let wj = (va.w[j] as f64).max(1e-9);
            n += wj;
            for x in 0..n_act {
                s[x] += wj * v.ev[x * n_hands + j] as f64;
            }
        }
        s.iter().map(|x| x / n / CHIPS_PER_BB).collect()
    };
    let rel = |ev: Vec<f64>| -> (Vec<f64>, usize, Vec<usize>) {
        let best = (0..n_act).max_by(|&x, &y| ev[x].total_cmp(&ev[y])).unwrap();
        let top = ev[best];
        let r: Vec<f64> = ev.iter().map(|x| x - top).collect();
        let ok = (0..n_act).filter(|&x| -r[x] <= fine).collect();
        (r, best, ok)
    };
    let mut hands: Vec<HandRow> = groups
        .into_iter()
        .map(|((label, class), idx)| {
            let (ev_gto, best_gto, fine_gto) = rel(group_ev(&va, &idx));
            let (ev_exploit, best_exploit, fine_exploit) = rel(group_ev(&vb, &idx));
            let majority = |v: &View| -> usize {
                let mut t = vec![0.0; n_act];
                for &j in &idx {
                    t[pure_of(v, j)] += (v.w[j] as f64).max(1e-9);
                }
                (0..n_act).max_by(|&x, &y| t[x].total_cmp(&t[y])).unwrap()
            };
            let mix = |v: &View| -> Vec<f64> {
                let mut m = vec![0.0; n_act];
                let mut t = 0.0;
                for &j in &idx {
                    let wj = v.w[j] as f64;
                    t += wj;
                    for x in 0..n_act {
                        m[x] += wj * v.mix[x * n_hands + j] as f64;
                    }
                }
                m.iter().map(|x| if t > 0.0 { x / t } else { 0.0 }).collect()
            };
            HandRow {
                mix_gto: mix(&va),
                mix_exploit: mix(&vb),
                pure_gto: majority(&va),
                pure_exploit: majority(&vb),
                hand: label,
                class,
                combos: idx.len(),
                weight_gto: idx.iter().map(|&j| va.w[j] as f64).sum::<f64>() / tot_a.max(1e-12),
                weight_exploit: idx.iter().map(|&j| vb.w[j] as f64).sum::<f64>() / tot_b.max(1e-12),
                ev_gto,
                ev_exploit,
                best_gto,
                best_exploit,
                fine_gto,
                fine_exploit,
            }
        })
        .collect();
    hands.sort_by(|x, y| {
        x.class
            .cmp(&y.class)
            .then(y.weight_gto.total_cmp(&x.weight_gto))
    });

    let share = |w: &[f32]| -> Vec<f64> {
        let mut s = vec![0.0; HandClass::ALL.len()];
        for (j, &x) in w.iter().enumerate() {
            s[villain_cls[j].index()] += x as f64;
        }
        let t: f64 = s.iter().sum();
        s.iter().map(|x| x / t.max(1e-12)).collect()
    };
    let (sa, sb) = (share(&va.vw), share(&vb.vw));
    let villain_range = HandClass::ALL
        .iter()
        .map(|&c| (c, sa[c.index()], sb[c.index()]))
        .collect();

    let cards_str = |(c1, c2): (u8, u8)| {
        format!("{}{}", ps_core::card_to_string(c1.max(c2)), ps_core::card_to_string(c1.min(c2)))
    };
    let norm = |w: &[f32]| -> f64 { w.iter().map(|&x| x as f64).sum::<f64>().max(1e-12) };
    let (nva, nvb) = (norm(&va.w), norm(&vb.w));
    let evs = |v: &View, j: usize| -> Vec<f64> {
        (0..n_act).map(|x| v.ev[x * n_hands + j] as f64 / CHIPS_PER_BB).collect()
    };
    let combos: Vec<ComboRow> = (0..n_hands)
        .filter(|&j| va.w[j] > 0.0 || vb.w[j] > 0.0)
        .map(|j| ComboRow {
            cards: cards_str(hero_cards[j]),
            hand: hand_type(hero_cards[j]),
            class: hero_cls[j],
            w_gto: va.w[j] as f64 / nva,
            w_exploit: vb.w[j] as f64 / nvb,
            ev_gto: evs(&va, j),
            ev_exploit: evs(&vb, j),
            pure_gto: pure_of(&va, j),
            pure_exploit: pure_of(&vb, j),
            eq_gto: va.eq[j] as f64,
            eq_exploit: vb.eq[j] as f64,
            reach_gto: va.reach[j] as f64,
            reach_exploit: vb.reach[j] as f64,
        })
        .collect();
    let villain_cards = a.private_cards(villain).to_vec();
    let (nvwa, nvwb) = (norm(&va.vw), norm(&vb.vw));
    let villain_combos: Vec<VillainCombo> = (0..villain_cards.len())
        .filter(|&j| va.vw[j] > 0.0 || vb.vw[j] > 0.0)
        .map(|j| VillainCombo {
            cards: cards_str(villain_cards[j]),
            hand: hand_type(villain_cards[j]),
            class: villain_cls[j],
            w_gto: va.vw[j] as f64 / nvwa,
            w_profile: vb.vw[j] as f64 / nvwb,
            eq_gto: va.veq[j] as f64,
            eq_profile: vb.veq[j] as f64,
            reach_gto: va.vreach[j] as f64,
            reach_profile: vb.vreach[j] as f64,
        })
        .collect();

    // Readable history
    let mut history = Vec::new();
    a.back_to_root();
    for &h in line {
        if a.is_chance_node() {
            history.push(ps_core::card_to_string(h as u8));
        } else {
            let who = if a.current_player() == hero {
                "hero"
            } else {
                "villain"
            };
            history.push(format!(
                "{who} {}",
                action_label(&a.available_actions()[h], pot_at(&a))
            ));
        }
        a.play(h);
    }

    Ok(Report {
        spot: spot.name.clone(),
        profile: profile.name.clone(),
        intensity: opts.intensity,
        board: board.iter().map(|&c| ps_core::card_to_string(c)).collect(),
        street: Street::from_board_len(board.len()),
        pot_bb: pot as f64 / CHIPS_PER_BB,
        to_call_bb,
        stack_bb,
        hero: spot.hero,
        history,
        actions: actions.iter().map(|x| action_label(x, pot)).collect(),
        actions_short: actions.iter().map(|x| short_label(x, pot)).collect(),
        headline,
        classes: classes_rows,
        hands,
        villain_range,
        combos,
        villain_combos,
    })
}

pub fn short_label(action: &Action, pot_chips: i32) -> String {
    match action {
        Action::Bet(v) => format!("bet {:.0}%", 100.0 * *v as f64 / pot_chips as f64),
        Action::Raise(_) => "raise".into(),
        Action::AllIn(_) => "all-in".into(),
        other => action_label(other, pot_chips),
    }
}

/// `AKs`, `AKo`, `QQ` for a pair of cards.
pub fn hand_type((c1, c2): (u8, u8)) -> String {
    const R: &[u8; 13] = b"23456789TJQKA";
    let (hi, lo) = if c1 >> 2 >= c2 >> 2 {
        (c1, c2)
    } else {
        (c2, c1)
    };
    let (rh, rl) = (R[(hi >> 2) as usize] as char, R[(lo >> 2) as usize] as char);
    if hi >> 2 == lo >> 2 {
        format!("{rh}{rl}")
    } else if hi & 3 == lo & 3 {
        format!("{rh}{rl}s")
    } else {
        format!("{rh}{rl}o")
    }
}
