//! GTO baseline and node-locked exploitative solutions for study spots.
//!
//! Built on `postflop-solver` (AGPL-3.0, Discounted CFR). This crate adds:
//! - `Spot`: a TOML description of a heads-up postflop decision.
//! - `Profile`: an opponent archetype as rules that bend the GTO strategy.
//! - `analyze`: GTO vs exploit, with *pure* (one action per hand) answers and their cost.

pub mod analyze;
pub mod library;
pub mod profile;
pub mod spot;

pub use analyze::{analyze, Options, Report};
pub use profile::Profile;
pub use spot::{Seat, Spot};
