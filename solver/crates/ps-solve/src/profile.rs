//! Opponent profiles: human leaks expressed as edits to the GTO strategy.
//!
//! A profile is a list of rules. Each rule says *where* it applies (street, whether the player is
//! facing a bet, which hand classes) and *how* it bends the GTO frequencies:
//!
//! - `scale`: multiply how often a class of actions is taken, and give the difference back to
//!   (or take it from) the other actions in proportion to their GTO weight.
//!     σ'(S|h) = min(1, m^λ · σ(S|h)),   other actions rescaled to fill 1 − σ'(S|h)
//!   "A station folds a third as often as GTO when facing a bet" is `scale = { fold = 0.33 }`.
//!   Plain English: "does X m times as often as a solver would".
//!   (It scales the *frequency*, not the odds: a hand that bluffs 90% of the time under GTO
//!   bluffs 18% with `aggressive = 0.2`, not 64%.)
//!
//! - `set`: pull the hand towards a fixed target mix.
//!     σ'(·|h) = (1 − λ)·σ(·|h) + λ·target
//!   "A whale always raises his flush draws" is `set = { raise = 1.0 }`.
//!   Plain English: override what GTO does with what this player actually does.
//!
//! λ ∈ [0, 1] is the profile's *intensity*: λ = 0 is GTO, λ = 1 is the full leak. It is the knob
//! the bot ladder turns to make a 600-rated station versus a 1400-rated one.

use anyhow::{bail, Context, Result};
use postflop_solver::Action;
use ps_core::HandClass;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Street {
    Flop,
    Turn,
    River,
}

impl Street {
    pub fn from_board_len(n: usize) -> Street {
        match n {
            3 => Street::Flop,
            4 => Street::Turn,
            _ => Street::River,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Facing {
    /// Applies everywhere.
    #[default]
    Any,
    /// First to act, or checked to.
    None,
    /// Facing a bet or raise.
    Bet,
}

/// Size of the bet being faced, relative to the pot before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FacingSize {
    /// Under half pot.
    Small,
    /// Half pot to pot.
    Large,
    /// More than pot (incl. most shoves).
    Overbet,
}

impl FacingSize {
    pub fn of(fraction: f64) -> FacingSize {
        if fraction < 0.5 {
            FacingSize::Small
        } else if fraction <= 1.05 {
            FacingSize::Large
        } else {
            FacingSize::Overbet
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    /// Optional note shown in explanations ("never folds top pair").
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub streets: Option<Vec<Street>>,
    #[serde(default)]
    pub facing: Facing,
    /// Only when facing a bet of these sizes (implies `facing = "bet"`).
    #[serde(default)]
    pub facing_size: Option<Vec<FacingSize>>,
    #[serde(default)]
    pub hands: Option<Vec<HandClass>>,
    /// Only these hand types, e.g. `["KK", "AKs", "AKo"]` (for textbook toy games and very
    /// specific reads like "always calls with any ace-king").
    #[serde(default)]
    pub hand_types: Option<Vec<String>>,
    #[serde(default)]
    pub scale: BTreeMap<String, f64>,
    #[serde(default)]
    pub set: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub rules: Vec<Rule>,
}

/// Action classes a rule can refer to.
pub const ACTION_KEYS: &[&str] = &[
    "fold",
    "check",
    "call",
    "bet",
    "bet_small",
    "bet_large",
    "raise",
    "allin",
    "aggressive",
    "passive",
];

/// Bets below this fraction of the pot count as `bet_small`.
pub const SMALL_BET_FRACTION: f64 = 0.5;

/// Which action classes an action belongs to, given the pot before it.
pub fn action_keys(action: &Action, facing_bet: bool, pot: i32) -> Vec<&'static str> {
    match *action {
        Action::Fold => vec!["fold"],
        Action::Check => vec!["check", "passive"],
        Action::Call => vec!["call", "passive"],
        Action::Bet(v) => {
            let size = if (v as f64) < SMALL_BET_FRACTION * pot as f64 {
                "bet_small"
            } else {
                "bet_large"
            };
            vec!["bet", size, "aggressive"]
        }
        Action::Raise(_) => vec!["raise", "aggressive"],
        Action::AllIn(_) if facing_bet => vec!["allin", "raise", "aggressive"],
        Action::AllIn(_) => vec!["allin", "bet", "bet_large", "aggressive"],
        _ => vec![],
    }
}

/// Context of one decision node, shared by every hand at that node.
pub struct NodeCtx<'a> {
    pub street: Street,
    pub facing_bet: bool,
    /// Bet being faced as a fraction of the pot before it (None when not facing a bet).
    pub facing_fraction: Option<f64>,
    pub actions: &'a [Action],
    pub pot: i32,
}

impl Profile {
    pub fn from_toml(s: &str) -> Result<Profile> {
        let p: Profile = toml::from_str(s)?;
        p.validate()?;
        Ok(p)
    }

    pub fn load(path: &std::path::Path) -> Result<Profile> {
        let s =
            std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
        Profile::from_toml(&s).with_context(|| format!("parsing {}", path.display()))
    }

    /// The identity profile: plays exactly GTO.
    pub fn gto() -> Profile {
        Profile {
            name: "GTO".into(),
            description: "Plays the equilibrium strategy.".into(),
            rules: vec![],
        }
    }

    fn validate(&self) -> Result<()> {
        for (i, r) in self.rules.iter().enumerate() {
            for (k, v) in r.scale.iter().chain(r.set.iter()) {
                if !ACTION_KEYS.contains(&k.as_str()) {
                    bail!("rule {i}: unknown action class {k:?} (use one of {ACTION_KEYS:?})");
                }
                if !(v.is_finite() && *v >= 0.0) {
                    bail!("rule {i}: {k} must be a non-negative number");
                }
            }
            if r.scale.is_empty() && r.set.is_empty() {
                bail!("rule {i}: needs `scale` or `set`");
            }
        }
        Ok(())
    }

    fn applies(rule: &Rule, ctx: &NodeCtx, class: HandClass, hand_type: &str) -> bool {
        rule.streets
            .as_ref()
            .map_or(true, |s| s.contains(&ctx.street))
            && match rule.facing {
                Facing::Any => true,
                Facing::None => !ctx.facing_bet,
                Facing::Bet => ctx.facing_bet,
            }
            && rule.facing_size.as_ref().map_or(true, |sz| {
                ctx.facing_fraction
                    .map_or(false, |f| sz.contains(&FacingSize::of(f)))
            })
            && rule.hands.as_ref().map_or(true, |h| h.contains(&class))
            && rule.hand_types.as_ref().map_or(true, |t| t.iter().any(|x| x == hand_type))
    }

    /// Distorts one hand's GTO action mix `p` (length = #actions) in place.
    pub fn apply_hand(&self, ctx: &NodeCtx, class: HandClass, hand_type: &str, p: &mut [f64], intensity: f64) {
        let keys: Vec<Vec<&str>> = ctx
            .actions
            .iter()
            .map(|a| action_keys(a, ctx.facing_bet, ctx.pot))
            .collect();
        for rule in self.rules.iter().filter(|r| Self::applies(r, ctx, class, hand_type)) {
            for (k, &m) in &rule.scale {
                let in_s: Vec<bool> = keys.iter().map(|ks| ks.contains(&k.as_str())).collect();
                if !in_s.iter().any(|&b| b) || in_s.iter().all(|&b| b) {
                    continue; // nothing to scale, or nothing to trade against
                }
                let cur: f64 = p
                    .iter()
                    .zip(&in_s)
                    .filter(|(_, &b)| b)
                    .map(|(x, _)| x)
                    .sum();
                if cur <= 0.0 {
                    continue; // can't scale up an action this hand never takes: use `set`
                }
                let new = (cur * m.powf(intensity)).min(1.0);
                let rest = 1.0 - cur;
                let n_out = in_s.iter().filter(|&&b| !b).count() as f64;
                for (x, &b) in p.iter_mut().zip(&in_s) {
                    *x = if b {
                        *x * new / cur
                    } else if rest > 1e-12 {
                        *x * (1.0 - new) / rest
                    } else {
                        (1.0 - new) / n_out // hand only ever took S: spread the rest evenly
                    };
                }
            }
            if !rule.set.is_empty() {
                // Target mass per class key, split among matching actions in proportion to the
                // current mix (keeps the player's size preference), or evenly if they are all zero.
                let mut target = vec![0.0; p.len()];
                for (k, &mass) in &rule.set {
                    let idx: Vec<usize> = (0..p.len())
                        .filter(|&a| keys[a].contains(&k.as_str()))
                        .collect();
                    if idx.is_empty() {
                        continue;
                    }
                    let tot: f64 = idx.iter().map(|&a| p[a]).sum();
                    for &a in &idx {
                        target[a] += mass
                            * if tot > 0.0 {
                                p[a] / tot
                            } else {
                                1.0 / idx.len() as f64
                            };
                    }
                }
                if normalise(&mut target) {
                    for (pa, t) in p.iter_mut().zip(&target) {
                        *pa = (1.0 - intensity) * *pa + intensity * t;
                    }
                }
            }
        }
    }
}

fn normalise(p: &mut [f64]) -> bool {
    let s: f64 = p.iter().sum();
    if s > 0.0 && s.is_finite() {
        p.iter_mut().for_each(|x| *x /= s);
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(actions: &[Action], facing: bool) -> NodeCtx<'_> {
        NodeCtx {
            street: Street::River,
            facing_bet: facing,
            facing_fraction: facing.then_some(0.75),
            actions,
            pot: 100,
        }
    }

    #[test]
    fn scale_and_intensity() {
        let p = Profile::from_toml(
            r#"name = "s"
            [[rules]]
            facing = "bet"
            scale = { fold = 0.25 }"#,
        )
        .unwrap();
        let acts = [Action::Fold, Action::Call];
        let mut x = [0.5, 0.5];
        p.apply_hand(&ctx(&acts, true), HandClass::Medium, "", &mut x, 1.0);
        assert!((x[0] - 0.125).abs() < 1e-12 && (x[1] - 0.875).abs() < 1e-12); // folds 1/4 as often
        let mut y = [0.5, 0.5];
        p.apply_hand(&ctx(&acts, true), HandClass::Medium, "", &mut y, 0.0);
        assert_eq!(y, [0.5, 0.5]); // λ = 0 is GTO
    }

    #[test]
    fn scale_is_frequency_not_odds() {
        let p = Profile::from_toml("name='n'\n[[rules]]\nscale={ aggressive = 0.2 }").unwrap();
        let acts = [Action::Check, Action::Bet(30), Action::Bet(75)];
        let mut x = [0.1, 0.3, 0.6];
        p.apply_hand(&ctx(&acts, false), HandClass::Air, "", &mut x, 1.0);
        // bets 18% instead of 90%, sizes keep their 1:2 ratio, check takes the rest
        assert!(
            (x[1] - 0.06).abs() < 1e-12
                && (x[2] - 0.12).abs() < 1e-12
                && (x[0] - 0.82).abs() < 1e-12
        );
        // pure bettor: the removed mass goes to the only other option
        let mut y = [0.0, 0.0, 1.0];
        p.apply_hand(&ctx(&acts, false), HandClass::Air, "", &mut y, 1.0);
        assert!((y[0] - 0.8).abs() < 1e-12 && (y[2] - 0.2).abs() < 1e-12);
    }

    #[test]
    fn set_rule_filters_by_hand_and_splits_sizes() {
        let p = Profile::from_toml(
            r#"name = "w"
            [[rules]]
            hands = ["draw"]
            set = { aggressive = 1.0 }"#,
        )
        .unwrap();
        let acts = [Action::Check, Action::Bet(30), Action::Bet(75)];
        let mut x = [0.4, 0.45, 0.15];
        p.apply_hand(&ctx(&acts, false), HandClass::Draw, "", &mut x, 1.0);
        assert!((x[0]).abs() < 1e-12 && (x[1] - 0.75).abs() < 1e-12 && (x[2] - 0.25).abs() < 1e-12);
        let mut y = [0.4, 0.45, 0.15];
        p.apply_hand(&ctx(&acts, false), HandClass::Air, "", &mut y, 1.0);
        assert_eq!(y, [0.4, 0.45, 0.15]);
    }

    #[test]
    fn keys() {
        assert_eq!(
            action_keys(&Action::Bet(30), false, 100),
            vec!["bet", "bet_small", "aggressive"]
        );
        assert_eq!(
            action_keys(&Action::AllIn(500), true, 100),
            vec!["allin", "raise", "aggressive"]
        );
    }

    #[test]
    fn rejects_unknown_keys() {
        assert!(Profile::from_toml("name='x'\n[[rules]]\nscale={ jam = 2.0 }").is_err());
    }
}
