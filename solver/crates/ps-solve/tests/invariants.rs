//! Game-theory invariants the whole study pipeline must satisfy. If any of these fail, no
//! number the trainer shows can be trusted.
//!
//! Notation: v = GTO value for hero; ε = exploitability of the GTO solve (bb).
//!  1. GTO guarantee:     EV(GTO vs any villain) ≥ v − ε
//!  2. Best response:     EV(best exploit vs P) ≥ EV(any hero strategy vs P), incl. GTO
//!  3. Convergence:       solved exploit ≈ exact best-response value
//!  4. Pure is enough:    one-action-per-hand exploit ≈ best exploit (BR needs no mixing)
//!  5. No free lunch:     a fixed playbook vs a perfect opponent ≤ v + ε
//!  6. Identity profile:  λ = 0, or the GTO profile, changes nothing

use postflop_solver::*;
use ps_solve::{analyze, Options, Profile, Spot};
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn spot() -> Spot {
    Spot::load(&root().join("spots/river_bluffcatch.toml")).unwrap()
}

fn profile(name: &str) -> Profile {
    Profile::load(&root().join(format!("profiles/{name}.toml"))).unwrap()
}

fn check_invariants(name: &str, intensity: f64) {
    let spot = spot();
    let r = analyze(
        &spot,
        &profile(name),
        &Options {
            intensity,
            ..Default::default()
        },
    )
    .unwrap();
    let h = &r.headline;
    let eps = h.gto_exploitability_pct / 100.0 * spot.pot + 0.05; // bb, plus float slack
    let v = h.gto_vs_gto;
    println!("{name} λ={intensity}: {h:?}");
    assert!(h.gto_vs_profile >= v - eps, "1. GTO guarantee broken");
    assert!(
        h.best_exploit_vs_profile >= h.gto_vs_profile - 0.05,
        "2. BR below GTO"
    );
    assert!(
        h.best_exploit_vs_profile >= h.solved_exploit_vs_profile - 0.05,
        "2. BR below solved"
    );
    assert!(
        h.best_exploit_vs_profile - h.solved_exploit_vs_profile <= eps,
        "3. exploit not converged"
    );
    assert!(
        h.best_exploit_vs_profile - h.pure_exploit_vs_profile <= eps,
        "4. pure exploit loses value"
    );
    assert!(
        h.pure_gto_vs_perfect_opponent <= v + eps,
        "5. playbook beats a perfect opponent"
    );
}

#[test]
fn invariants_station() {
    check_invariants("station", 1.0);
}
#[test]
fn invariants_nit() {
    check_invariants("nit", 1.0);
}
#[test]
fn invariants_maniac() {
    check_invariants("maniac", 1.0);
}
#[test]
fn invariants_whale_half() {
    check_invariants("whale", 0.5);
}

#[test]
fn identity_profiles_change_nothing() {
    let spot = spot();
    for (p, lam) in [(profile("gto"), 1.0), (profile("station"), 0.0)] {
        let r = analyze(
            &spot,
            &p,
            &Options {
                intensity: lam,
                ..Default::default()
            },
        )
        .unwrap();
        let h = &r.headline;
        let eps = h.gto_exploitability_pct / 100.0 * spot.pot + 0.05;
        assert!((h.gto_vs_profile - h.gto_vs_gto).abs() < 1e-3, "{h:?}");
        // hero's best response to GTO can gain at most ~ the solve's exploitability
        assert!(
            h.best_exploit_vs_profile - h.gto_vs_gto <= 2.0 * eps,
            "{h:?}"
        );
    }
}

#[test]
fn zero_sum_chip_conservation() {
    let spot = spot();
    let mut g = spot.build_game().unwrap();
    g.allocate_memory(false);
    solve(&mut g, 300, 0.01, false);
    let ev = compute_current_ev(&g);
    assert!(
        (ev[0] + ev[1]).abs() < 1e-2,
        "EVs must sum to zero without rake: {ev:?}"
    );
}

/// Reproduces postflop-solver's own node-locking example through our profile machinery:
/// river, OOP holds AA or QQ, IP holds KK, OOP can shove the pot-sized stack.
/// Shoving 10 into 20 with QQ (always behind KK) wins 20 when KK folds and loses 10 when he calls:
///   EV(shove QQ) = 20·f − 10·(1 − f),   EV(check QQ) = 0   →   shove iff fold% f > 1/3.
/// KK calls 75% (f = .25): check QQ. Calls 50% (f = .5): shove QQ. AA always shoves.
#[test]
fn profile_lock_matches_hand_solved_toy_game() {
    let base = r#"
        name = "toy"
        board = "2s3h4d6c7c"
        oop_range = "AsAh,QsQh"
        ip_range = "KsKh"
        pot = 2.0
        stack = 1.0
        hero = "oop"
        sizes = { bet = "a", raise = "" }
    "#;
    let spot = Spot::from_toml(base).unwrap();
    for (call, qq) in [(0.75, "check"), (0.5, "all-in")] {
        let p = Profile::from_toml(&format!(
            "name = 'caller'\n[[rules]]\nfacing = 'bet'\nset = {{ call = {call}, fold = {} }}",
            1.0 - call
        ))
        .unwrap();
        let r = analyze(&spot, &p, &Options::default()).unwrap();
        let answer = |hand: &str| {
            let row = r.hands.iter().find(|x| x.hand == hand).unwrap();
            r.actions_short[row.pure_exploit].clone()
        };
        assert_eq!(answer("AA"), "all-in", "call {call}");
        assert_eq!(answer("QQ"), qq, "call {call}");
    }
}
