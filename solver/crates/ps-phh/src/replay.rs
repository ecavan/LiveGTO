//! Plays a PHH hand forward and records every decision with the situation it was made in.
//!
//! Seats follow PHH: player 0 posts the small blind, player 1 the big blind, the last player is
//! the button. Preflop the order is p2 … p(n-1), p0, p1; after the flop it is p0 … p(n-1), so a
//! higher index acts later (is "in position").

use crate::parse::RawHand;
use ps_core::{card_from_str, eval, Card};

const EPS: f64 = 1e-9;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Act {
    Fold,
    Check,
    Call,
    Bet,
    Raise,
}

impl Act {
    pub fn code(self) -> char {
        match self {
            Act::Fold => 'f',
            Act::Check => 'x',
            Act::Call => 'c',
            Act::Bet => 'b',
            Act::Raise => 'r',
        }
    }
    pub fn aggressive(self) -> bool {
        matches!(self, Act::Bet | Act::Raise)
    }
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub p: usize,
    pub street: u8,
    pub act: Act,
    /// The player's total bet on this street after acting (chips).
    pub to: f64,
    /// What he owed before acting (capped by his stack, as the engine reports it).
    pub to_call: f64,
    /// Everything in the pot before he acted.
    pub pot: f64,
    /// Bets and raises earlier on this street (posting blinds is not a raise).
    pub raises: u8,
    /// Preflop: players who called before the first raise (limpers). Blinds don't count.
    pub limpers: u8,
    /// Who made the first bet or raise of this street, and the latest one.
    #[allow(dead_code)]
    pub first_bettor: Option<usize>,
    pub last_bettor: Option<usize>,
    /// Last aggressor of the previous street (the preflop raiser, on the flop).
    pub prev_aggr: Option<usize>,
    /// Has the previous street's aggressor acted on this street yet, and can he still act.
    pub prev_aggr_acted: bool,
    pub prev_aggr_can_act: bool,
    /// All-in with this action.
    pub allin: bool,
    /// Players still in the hand before this action (including him).
    pub live: u8,
    /// Players in the hand when this street began.
    pub live_at_street: u8,
    /// Board cards out when he acted.
    pub board_len: u8,
}

#[derive(Debug)]
pub struct Replay {
    pub n: usize,
    pub bb: f64,
    pub decisions: Vec<Decision>,
    pub holes: Vec<Option<(Card, Card)>>,
    pub board: Vec<Card>,
    pub folded: Vec<bool>,
    pub saw_flop: Vec<bool>,
    /// Two or more players were left at the end.
    pub showdown: bool,
    /// Whether each player took (part of) a pot at showdown; None when it can't be told.
    pub won: Vec<Option<bool>>,
    /// Cards turned over at showdown (as opposed to dealt face up, as in the Pluribus logs).
    pub showed: Vec<bool>,
    /// Somebody was all-in before the river action ended (lines are cut short).
    pub allin: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Skip {
    Variant,
    Players,
    Blinds,
    Antes,
    Malformed,
}

impl Skip {
    pub fn name(self) -> &'static str {
        match self {
            Skip::Variant => "not no-limit hold'em",
            Skip::Players => "fewer than 3 or more than 10 players",
            Skip::Blinds => "straddle, dead blind or missing blind",
            Skip::Antes => "antes",
            Skip::Malformed => "malformed actions",
        }
    }
}

fn cards2(s: &str) -> Option<(Card, Card)> {
    if s.len() != 4 || s.contains('?') {
        return None;
    }
    Some((card_from_str(&s[0..2])?, card_from_str(&s[2..4])?))
}

fn seat(tok: &str) -> Option<usize> {
    tok.strip_prefix('p')?.parse::<usize>().ok()?.checked_sub(1)
}

pub fn replay(h: &RawHand) -> Result<Replay, Skip> {
    if h.variant != "NT" {
        return Err(Skip::Variant);
    }
    let n = h.stacks.len();
    if !(3..=10).contains(&n) || h.players.len() != n {
        return Err(Skip::Players);
    }
    if h.blinds.len() < 2 || h.blinds[0] <= 0.0 || h.blinds[1] <= 0.0 || h.blinds[0] > h.blinds[1] {
        return Err(Skip::Blinds);
    }
    if h.blinds.iter().skip(2).any(|&b| b.abs() > EPS) {
        return Err(Skip::Blinds);
    }
    if h.antes.iter().any(|&a| a.abs() > EPS) {
        return Err(Skip::Antes);
    }
    if h.stacks.iter().any(|x| x.is_nan() || *x <= 0.0) {
        return Err(Skip::Malformed);
    }
    let bb = h.blinds[1];
    // iPoker logs give no stacks ("inf"): play them as very deep (nobody is ever all-in)
    let mut stack: Vec<f64> = h.stacks.iter().map(|&x| if x.is_finite() { x } else { 1e9 }).collect();
    let mut bet = vec![0.0; n];
    let mut invested = vec![0.0; n];
    for i in 0..2 {
        let a = h.blinds[i].min(stack[i]);
        stack[i] -= a;
        bet[i] = a;
        invested[i] = a;
    }
    let mut folded = vec![false; n];
    let mut holes: Vec<Option<(Card, Card)>> = vec![None; n];
    let mut showed = vec![false; n];
    let mut board: Vec<Card> = Vec::new();
    let mut saw_flop = vec![false; n];
    let mut street: u8 = 0;
    let mut raises: u8 = 0;
    let mut limpers: u8 = 0;
    let mut first_bettor: Option<usize> = None;
    let mut last_bettor: Option<usize> = None;
    let mut prev_aggr: Option<usize> = None;
    let mut acted = vec![false; n];
    let mut decisions = Vec::new();
    let mut allin_any = false;
    let mut live_at_street = n as u8;

    for a in &h.actions {
        let parts: Vec<&str> = a.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        if parts[0] == "d" {
            match parts.get(1).copied() {
                Some("dh") => {
                    let p = parts.get(2).and_then(|t| seat(t)).ok_or(Skip::Malformed)?;
                    if p >= n {
                        return Err(Skip::Malformed);
                    }
                    if let Some(c) = parts.get(3).and_then(|s| cards2(s)) {
                        holes[p] = Some(c);
                    }
                }
                Some("db") => {
                    let s = parts.get(2).ok_or(Skip::Malformed)?;
                    if s.len() % 2 != 0 {
                        return Err(Skip::Malformed);
                    }
                    for i in 0..s.len() / 2 {
                        board.push(card_from_str(&s[2 * i..2 * i + 2]).ok_or(Skip::Malformed)?);
                    }
                    let new_street = match board.len() {
                        3 => 1,
                        4 => 2,
                        5 => 3,
                        _ => return Err(Skip::Malformed),
                    };
                    if street == 0 {
                        for i in 0..n {
                            saw_flop[i] = !folded[i];
                        }
                    }
                    street = new_street;
                    prev_aggr = last_bettor;
                    bet.iter_mut().for_each(|b| *b = 0.0);
                    raises = 0;
                    first_bettor = None;
                    last_bettor = None;
                    acted.iter_mut().for_each(|x| *x = false);
                    live_at_street = folded.iter().filter(|f| !**f).count() as u8;
                }
                _ => {}
            }
            continue;
        }
        let p = seat(parts[0]).ok_or(Skip::Malformed)?;
        if p >= n {
            return Err(Skip::Malformed);
        }
        let verb = parts.get(1).copied().unwrap_or("");
        if verb == "sm" {
            if let Some(c) = parts.get(2).and_then(|s| cards2(s)) {
                holes[p] = Some(c);
                showed[p] = true;
            }
            continue;
        }
        if verb == "sd" {
            continue;
        }
        if folded[p] || stack[p] <= EPS {
            return Err(Skip::Malformed);
        }
        let max = bet.iter().cloned().fold(0.0, f64::max);
        let owe = (max - bet[p]).max(0.0);
        let pot: f64 = invested.iter().sum();
        let live = folded.iter().filter(|f| !**f).count() as u8;
        let (pa_acted, pa_can) = match prev_aggr {
            Some(q) => (acted[q], !folded[q] && stack[q] > EPS),
            None => (false, false),
        };
        let mut d = Decision {
            p,
            street,
            act: Act::Fold,
            to: bet[p],
            to_call: owe.min(stack[p]),
            pot,
            raises,
            limpers,
            first_bettor,
            last_bettor,
            prev_aggr,
            prev_aggr_acted: pa_acted,
            prev_aggr_can_act: pa_can,
            allin: false,
            live,
            live_at_street,
            board_len: board.len() as u8,
        };
        match verb {
            "f" => {
                folded[p] = true;
                d.act = Act::Fold;
            }
            "cc" => {
                if owe <= EPS {
                    d.act = Act::Check;
                } else {
                    let add = owe.min(stack[p]);
                    stack[p] -= add;
                    bet[p] += add;
                    invested[p] += add;
                    d.act = Act::Call;
                    d.to = bet[p];
                    if street == 0 && raises == 0 {
                        limpers += 1;
                    }
                }
            }
            "cbr" => {
                let x: f64 = parts.get(2).and_then(|s| s.parse().ok()).ok_or(Skip::Malformed)?;
                let to = x.min(bet[p] + stack[p]);
                if to <= max + EPS {
                    return Err(Skip::Malformed);
                }
                let add = to - bet[p];
                stack[p] -= add;
                bet[p] = to;
                invested[p] += add;
                d.act = if street > 0 && max <= EPS { Act::Bet } else { Act::Raise };
                d.to = to;
                raises += 1;
                if first_bettor.is_none() {
                    first_bettor = Some(p);
                }
                last_bettor = Some(p);
            }
            _ => return Err(Skip::Malformed),
        }
        if stack[p] <= EPS && d.act != Act::Fold && d.act != Act::Check {
            d.allin = true;
            if street < 3 || d.act.aggressive() {
                allin_any = true;
            }
        }
        acted[p] = true;
        decisions.push(d);
    }

    let live: Vec<usize> = (0..n).filter(|&i| !folded[i]).collect();
    let showdown = live.len() >= 2;
    let mut won = vec![None; n];
    if showdown {
        // HandHQ's `winnings` are after rake and leave out uncalled bets (and are often 0), so the
        // winner is worked out from the cards: best shown hand wins, a hand mucked at showdown lost.
        if board.len() == 5 {
            let vals: Vec<Option<u32>> = live
                .iter()
                .map(|&i| {
                    holes[i].map(|(a, b)| {
                        let mut c = board.clone();
                        c.push(a);
                        c.push(b);
                        eval(&c)
                    })
                })
                .collect();
            if let Some(best) = vals.iter().flatten().max().copied() {
                for (k, &i) in live.iter().enumerate() {
                    // a hand mucked at showdown lost
                    won[i] = Some(vals[k] == Some(best));
                }
            }
        }
    }
    Ok(Replay { n, bb, decisions, holes, board, folded, saw_flop, showdown, won, showed, allin: allin_any })
}

/// Position code from a seat: "SB", "BB", or the distance from the button ("BTN", "CO", "HJ",
/// "LJ", "MP", "EP2", "EP1", "UTG" for 0…7).
pub fn pos_index(p: usize, n: usize) -> usize {
    match p {
        0 => 8,
        1 => 9,
        _ => (n - 1 - p).min(7),
    }
}

pub const POS_NAMES: [&str; 10] = ["BTN", "CO", "HJ", "LJ", "MP", "EP2", "EP1", "UTG", "SB", "BB"];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_text;

    const HAND: &str = "variant = 'NT'\nantes = [0, 0, 0, 0]\nblinds_or_straddles = [0.10, 0.25, 0, 0]\nstarting_stacks = [25, 54.75, 16.35, 24.65]\nactions = ['d dh p1 ????', 'd dh p2 ????', 'd dh p3 ????', 'd dh p4 ????', 'p3 f', 'p4 cbr 0.75', 'p1 f', 'p2 cc', 'd db 4dQs4s', 'p2 cc', 'p4 cbr 1', 'p2 cbr 3', 'p4 cc', 'd db 9h', 'p2 cc', 'p4 cc', 'd db Ad', 'p2 cc', 'p4 cc', 'p2 sm 8sAh', 'p4 sm ????']\nplayers = ['a', 'b', 'c', 'd']\n";

    #[test]
    fn replays_a_hand() {
        let h = &parse_text(HAND)[0];
        let r = replay(h).unwrap();
        assert_eq!(r.n, 4);
        assert!(r.showdown);
        assert_eq!(r.board.len(), 5);
        let d = &r.decisions;
        assert_eq!(d[0].act, Act::Fold); // p3 (UTG) folds
        assert_eq!((d[1].p, d[1].act, d[1].raises), (3, Act::Raise, 0)); // BTN opens
        assert_eq!((d[3].p, d[3].act, d[3].to_call), (1, Act::Call, 0.5)); // BB calls 0.50 more
        let flop: Vec<_> = d.iter().filter(|x| x.street == 1).collect();
        assert_eq!(flop[0].act, Act::Check);
        assert_eq!(flop[1].act, Act::Bet); // c-bet
        assert_eq!(flop[1].prev_aggr, Some(3));
        assert_eq!(flop[2].act, Act::Raise); // check-raise
        assert!((flop[1].pot - 1.6).abs() < 1e-9); // 0.10 + 0.75 + 0.75
        assert_eq!(r.won[1], Some(true));
        assert_eq!(r.won[3], Some(false));
        assert_eq!(pos_index(3, 4), 0);
        assert_eq!(pos_index(2, 4), 1);
    }

    #[test]
    fn skips_straddles() {
        let t = HAND.replace("[0.10, 0.25, 0, 0]", "[0.10, 0.25, 0.50, 0]");
        assert_eq!(replay(&parse_text(&t)[0]).unwrap_err(), Skip::Blinds);
    }
}
