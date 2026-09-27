//! A study spot: board, ranges, pot, stacks, bet sizes, who hero is, and the line to the decision.
//!
//! Amounts are written in big blinds; internally the solver works in integer chips at
//! `CHIPS_PER_BB` resolution.

use anyhow::{anyhow, bail, Context, Result};
use postflop_solver::*;
use serde::{Deserialize, Serialize};

/// 0.01bb resolution, so small (limped) pots still get exact bet sizes.
pub const CHIPS_PER_BB: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Seat {
    Oop,
    Ip,
}

impl Seat {
    pub fn player(self) -> usize {
        match self {
            Seat::Oop => 0,
            Seat::Ip => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sizes {
    /// Bet sizes, postflop-solver syntax, e.g. `"33%, 75%, a"`.
    #[serde(default = "default_bet")]
    pub bet: String,
    /// Raise sizes, e.g. `"3x"` (3× the previous bet).
    #[serde(default = "default_raise")]
    pub raise: String,
}

fn default_bet() -> String {
    // Deliberately few, human-usable sizes: small, big, all-in.
    "33%, 75%, a".into()
}
fn default_raise() -> String {
    "3x".into()
}

impl Default for Sizes {
    fn default() -> Self {
        Sizes {
            bet: default_bet(),
            raise: default_raise(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spot {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 3, 4 or 5 cards, e.g. `"Kh9d4c7s"`. The solve starts on the street this board implies.
    pub board: String,
    pub oop_range: String,
    pub ip_range: String,
    /// Pot at the start of the street, in bb.
    pub pot: f64,
    /// Effective stack behind at the start of the street, in bb.
    pub stack: f64,
    pub hero: Seat,
    /// Actions from the root to hero's decision: `x` check, `c` call, `f` fold, `b` / `b75` bet
    /// (smallest / closest to 75% pot), `r` raise, `a` all-in, or a card like `Qh` for a new street.
    #[serde(default)]
    pub line: Vec<String>,
    #[serde(default)]
    pub sizes: Sizes,
    /// Per-player overrides of `sizes` (e.g. a half-street game where OOP may not bet: `bet = ""`).
    #[serde(default)]
    pub sizes_oop: Option<Sizes>,
    #[serde(default)]
    pub sizes_ip: Option<Sizes>,
    /// postflop-solver adds an all-in option whenever stack ≤ this × pot. Set 0 to disable
    /// (toy games where a player must not be able to bet).
    #[serde(default = "default_add_allin")]
    pub add_allin_threshold: f64,
    /// CFR iterations cap for each solve.
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    /// Stop when exploitability falls below this % of the pot.
    #[serde(default = "default_target")]
    pub target_pct: f64,
}

fn default_add_allin() -> f64 {
    1.5
}

fn default_iterations() -> u32 {
    1000
}
fn default_target() -> f64 {
    0.1
}

impl Spot {
    pub fn from_toml(s: &str) -> Result<Spot> {
        Ok(toml::from_str(s)?)
    }

    pub fn load(path: &std::path::Path) -> Result<Spot> {
        let s =
            std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
        Spot::from_toml(&s).with_context(|| format!("parsing {}", path.display()))
    }

    pub fn hero(&self) -> usize {
        self.hero.player()
    }

    pub fn villain(&self) -> usize {
        self.hero() ^ 1
    }

    pub fn pot_chips(&self) -> i32 {
        (self.pot * CHIPS_PER_BB).round() as i32
    }

    /// Builds an unallocated game for this spot. Every call gives an identical tree, which is
    /// what lets us line up nodes across the GTO / exploit / locked copies by history.
    pub fn build_game(&self) -> Result<PostFlopGame> {
        let cards = ps_core::cards_from_str(&self.board)
            .ok_or_else(|| anyhow!("bad board {:?}", self.board))?;
        let (initial_state, turn, river) = match cards.len() {
            3 => (BoardState::Flop, NOT_DEALT, NOT_DEALT),
            4 => (BoardState::Turn, cards[3], NOT_DEALT),
            5 => (BoardState::River, cards[3], cards[4]),
            n => bail!("board must have 3-5 cards, got {n}"),
        };
        let card_config = CardConfig {
            range: [
                self.oop_range
                    .parse()
                    .map_err(|e| anyhow!("oop_range: {e}"))?,
                self.ip_range
                    .parse()
                    .map_err(|e| anyhow!("ip_range: {e}"))?,
            ],
            flop: [cards[0], cards[1], cards[2]],
            turn,
            river,
        };
        let parse = |s: &Sizes| {
            BetSizeOptions::try_from((s.bet.as_str(), s.raise.as_str())).map_err(|e| anyhow!("sizes: {e}"))
        };
        let oop = parse(self.sizes_oop.as_ref().unwrap_or(&self.sizes))?;
        let ip = parse(self.sizes_ip.as_ref().unwrap_or(&self.sizes))?;
        let tree_config = TreeConfig {
            initial_state,
            starting_pot: self.pot_chips(),
            effective_stack: (self.stack * CHIPS_PER_BB).round() as i32,
            rake_rate: 0.0,
            rake_cap: 0.0,
            flop_bet_sizes: [oop.clone(), ip.clone()],
            turn_bet_sizes: [oop.clone(), ip.clone()],
            river_bet_sizes: [oop, ip],
            turn_donk_sizes: None,
            river_donk_sizes: None,
            add_allin_threshold: self.add_allin_threshold,
            force_allin_threshold: 0.15,
            merging_threshold: 0.1,
        };
        let tree = ActionTree::new(tree_config).map_err(|e| anyhow!("tree: {e}"))?;
        PostFlopGame::with_config(card_config, tree).map_err(|e| anyhow!("game: {e}"))
    }

    /// Resolves `line` into a solver history (action indices / card ids) on `game`.
    pub fn resolve_line(&self, game: &mut PostFlopGame) -> Result<Vec<usize>> {
        game.back_to_root();
        let mut history = Vec::new();
        for tok in &self.line {
            if game.is_terminal_node() {
                bail!("line token {tok:?} after the hand ended");
            }
            let idx = if game.is_chance_node() {
                let c = ps_core::card_from_str(tok)
                    .ok_or_else(|| anyhow!("expected a card at a chance node, got {tok:?}"))?;
                if game.possible_cards() & (1u64 << c) == 0 {
                    bail!("card {tok} cannot be dealt here");
                }
                c as usize
            } else {
                match_action(game, tok)?
            };
            game.play(idx);
            history.push(idx);
        }
        if game.is_terminal_node() || game.is_chance_node() {
            bail!("line does not end at a decision node");
        }
        if game.current_player() != self.hero() {
            bail!("line ends at villain's decision, not hero's");
        }
        game.back_to_root();
        Ok(history)
    }
}

/// Pot (chips) at the current node, before the action about to be taken.
pub fn pot_at(game: &PostFlopGame) -> i32 {
    let tb = game.total_bet_amount();
    game.tree_config().starting_pot + tb[0] + tb[1]
}

pub fn match_action(game: &PostFlopGame, tok: &str) -> Result<usize> {
    let actions = game.available_actions();
    let pot = pot_at(game) as f64;
    let t = tok.to_ascii_lowercase();
    let (kind, pct) = t.split_at(1);
    let find = |pred: &dyn Fn(&Action) -> bool| actions.iter().position(|a| pred(a));
    let idx = match kind {
        "x" => find(&|a| matches!(a, Action::Check)),
        "c" => find(&|a| matches!(a, Action::Call)),
        "f" => find(&|a| matches!(a, Action::Fold)),
        "a" => find(&|a| matches!(a, Action::AllIn(_))),
        "b" | "r" => {
            let is_kind = |a: &Action| match (kind, a) {
                ("b", Action::Bet(_)) | ("r", Action::Raise(_)) => true,
                _ => false,
            };
            if pct.is_empty() {
                find(&is_kind)
            } else {
                let want: f64 = pct.parse().map_err(|_| anyhow!("bad size in {tok:?}"))?;
                actions
                    .iter()
                    .enumerate()
                    .filter(|(_, a)| is_kind(a))
                    .min_by(|(_, a), (_, b)| {
                        let d = |x: &Action| match x {
                            Action::Bet(v) | Action::Raise(v) => {
                                (100.0 * *v as f64 / pot - want).abs()
                            }
                            _ => f64::INFINITY,
                        };
                        d(a).total_cmp(&d(b))
                    })
                    .map(|(i, _)| i)
            }
        }
        _ => bail!("unknown line token {tok:?}"),
    };
    idx.ok_or_else(|| anyhow!("action {tok:?} not available here; options: {actions:?}"))
}

/// Human-readable action label, sizes in bb and % of pot.
pub fn action_label(action: &Action, pot_chips: i32) -> String {
    let bb = |v: i32| v as f64 / CHIPS_PER_BB;
    let pct = |v: i32| 100.0 * v as f64 / pot_chips as f64;
    match action {
        Action::Fold => "fold".into(),
        Action::Check => "check".into(),
        Action::Call => "call".into(),
        Action::Bet(v) => format!("bet {:.1}bb ({:.0}%)", bb(*v), pct(*v)),
        Action::Raise(v) => format!("raise to {:.1}bb", bb(*v)),
        Action::AllIn(v) => format!("all-in {:.1}bb", bb(*v)),
        other => format!("{other:?}"),
    }
}
