//! Textbook toy games with closed-form solutions, played on real cards.
//!
//! If the solver, the node-locking pipeline or our EV bookkeeping is wrong anywhere, these
//! numbers won't match. Sources and derivations: docs/theory-audit.md §2 (T1, T2).
//!
//! Notation: pot P = 100, bet B, s = B/P. EVs are the player's share of the pot (both shares sum
//! to 100). Board 3♠3♥3♣2♦2♠ makes every holding a pair-over-the-board: AA beats KK beats QQ,
//! with no ties and no draws.

use ps_solve::{analyze, Options, Profile, Report, Spot};

const TOL_EV: f64 = 0.35; // bb, i.e. 0.35% of the pot
const TOL_FREQ: f64 = 0.04;

fn run(spot_toml: &str, profile_toml: Option<&str>) -> Report {
    let spot = Spot::from_toml(spot_toml).unwrap();
    let profile = profile_toml.map_or_else(Profile::gto, |p| Profile::from_toml(p).unwrap());
    analyze(&spot, &profile, &Options::default()).unwrap()
}

fn hand<'a>(r: &'a Report, h: &str) -> &'a ps_solve::analyze::HandRow {
    r.hands.iter().find(|x| x.hand == h).unwrap_or_else(|| panic!("{h} not at node"))
}

fn action(r: &Report, label: &str) -> usize {
    r.actions_short.iter().position(|a| a == label).unwrap_or_else(|| panic!("no {label} in {:?}", r.actions_short))
}

fn close(x: f64, want: f64, tol: f64, what: &str) {
    assert!((x - want).abs() <= tol, "{what}: got {x:.4}, want {want:.4} ± {tol}");
}

// ---------------------------------------------------------------------------------------------
// T1 — Clairvoyance (polar) game. MoP ex. 11.1 / ch.14; Acevedo p.98–104; Brokos ch.2.
// OOP: {AA = nuts, QQ = air}; IP: {KK = bluff-catcher}. OOP may shove s·P.
// Equilibrium: OOP bets all AA, bluffs QQ with prob s/(1+s); IP calls 1/(1+s);
// OOP share = 50·(1+2s)/(1+s).
// ---------------------------------------------------------------------------------------------

fn t1(stack: f64, hero: &str, line: &str) -> String {
    format!(
        r#"name = "T1 clairvoyance"
        board = "3s3h3c2d2s"
        oop_range = "AsAh,QcQd"
        ip_range = "KcKd"
        pot = 100.0
        stack = {stack}
        hero = "{hero}"
        line = [{line}]
        sizes = {{ bet = "a", raise = "" }}
        iterations = 5000
        target_pct = 0.02"#
    )
}

#[test]
fn t1_clairvoyance_equilibrium_sweep() {
    for s in [0.5, 1.0, 2.0] {
        let r = run(&t1(100.0 * s, "oop", ""), None);
        close(r.headline.gto_vs_gto, 50.0 * (1.0 + 2.0 * s) / (1.0 + s), TOL_EV, &format!("OOP value s={s}"));
        let allin = action(&r, "all-in");
        close(hand(&r, "AA").mix_gto[allin], 1.0, TOL_FREQ, "AA always bets");
        close(hand(&r, "QQ").mix_gto[allin], s / (1.0 + s), TOL_FREQ, &format!("QQ bluff freq s={s}"));

        let r = run(&t1(100.0 * s, "ip", r#""a""#), None);
        close(hand(&r, "KK").mix_gto[action(&r, "call")], 1.0 / (1.0 + s), TOL_FREQ, &format!("KK call = MDF s={s}"));
    }
}

/// Node-locking KK's call frequency: the best response flips at the indifference point
/// (call ½ for a pot bet) and is pure on either side. Acevedo's MinES example, p.124–128.
#[test]
fn t1_locked_caller_best_responses() {
    let lock = |c: f64| {
        // KK's call frequency is the lock under test. KK also checks back when checked to, as in
        // the textbook game (the GTO strategy there is off-path and arbitrary: if KK bet into a
        // check, AA would rightly check to induce it).
        format!(
            "name='kk'\n[[rules]]\nfacing='bet'\nset={{ call = {c}, fold = {} }}\n[[rules]]\nfacing='none'\nset={{ check = 1.0 }}",
            1.0 - c
        )
    };
    for (c, qq, ev) in [(0.55, "check", 77.5), (0.45, "all-in", 77.5), (1.0, "check", 100.0), (0.0, "all-in", 100.0)] {
        let r = run(&t1(100.0, "oop", ""), Some(&lock(c)));
        let q = hand(&r, "QQ");
        assert_eq!(r.actions_short[q.pure_exploit], qq, "KK calls {c}: QQ should {qq}");
        let aa = hand(&r, "AA");
        assert!(aa.fine_exploit.contains(&action(&r, "all-in")), "AA shove must be (one of) the best");
        close(r.headline.best_exploit_vs_profile, ev, TOL_EV, &format!("OOP EV vs KK calling {c}"));
        close(r.headline.pure_exploit_vs_profile, ev, TOL_EV, "one-action exploit keeps full value");
    }
}

/// Maniac OOP bluffs every QQ: bluff share ½ > ⅓ needed, so KK must always call. IP share 50.
#[test]
fn t1_maniac_bettor_means_call() {
    let maniac = "name='maniac'\n[[rules]]\nhand_types=['QQ']\nfacing='none'\nset={ allin = 1.0 }";
    let r = run(&t1(100.0, "ip", r#""a""#), Some(maniac));
    assert_eq!(r.actions_short[hand(&r, "KK").pure_exploit], "call");
    close(r.headline.best_exploit_vs_profile, 50.0, TOL_EV, "IP EV vs maniac");
}

// ---------------------------------------------------------------------------------------------
// T2 — AKQ game, half street (MoP ch.13 p.138–145; Brokos ch.3; MIT L8).
// Both players {AA, KK, QQ}; identical combos block each other, which reproduces the AKQ deal.
// OOP can only check; IP may bet ½ pot. IP bets AA, bluffs QQ ⅓, checks KK; OOP calls KK ⅓.
// IP share 50 + 50/18 = 52.78.
// ---------------------------------------------------------------------------------------------

fn t2(hero: &str, line: &str) -> String {
    akq(hero, line, "")
}

fn akq(hero: &str, line: &str, oop_bet: &str) -> String {
    format!(
        r#"name = "T2 AKQ"
        board = "3s3h3c2d2s"
        oop_range = "AcAd,KcKd,QcQd"
        ip_range = "AcAd,KcKd,QcQd"
        pot = 100.0
        stack = 50.0
        hero = "{hero}"
        line = [{line}]
        sizes_oop = {{ bet = "{oop_bet}", raise = "" }}
        sizes_ip = {{ bet = "a", raise = "" }}
        add_allin_threshold = 0.0
        iterations = 5000
        target_pct = 0.02"#
    )
}

#[test]
fn t2_akq_half_street() {
    let r = run(&t2("ip", r#""x""#), None);
    close(r.headline.gto_vs_gto, 50.0 + 50.0 / 18.0, TOL_EV, "IP value 52.78");
    let allin = action(&r, "all-in");
    close(hand(&r, "AA").mix_gto[allin], 1.0, TOL_FREQ, "AA bets");
    close(hand(&r, "QQ").mix_gto[allin], 1.0 / 3.0, TOL_FREQ, "QQ bluffs 1/3");
    close(hand(&r, "KK").mix_gto[allin], 0.0, TOL_FREQ, "KK checks");

    let r = run(&t2("oop", r#""x", "a""#), None);
    let call = action(&r, "call");
    close(hand(&r, "KK").mix_gto[call], 1.0 / 3.0, TOL_FREQ, "KK calls 1/3");
    close(hand(&r, "AA").mix_gto[call], 1.0, TOL_FREQ, "AA calls");
    close(hand(&r, "QQ").mix_gto[call], 0.0, TOL_FREQ, "QQ folds");
}

/// Lock OOP's KK: QQ's bluff EV = 25 − 75c, so bluff iff c < ⅓. At c = 0 or 1, IP share 58.33.
#[test]
fn t2_akq_locked_kk() {
    for (set, qq) in [("fold = 1.0", "all-in"), ("call = 1.0", "check")] {
        let p = format!("name='kk'\n[[rules]]\nhand_types=['KK']\nfacing='bet'\nset={{ {set} }}");
        let r = run(&t2("ip", r#""x""#), Some(&p));
        assert_eq!(r.actions_short[hand(&r, "QQ").pure_exploit], qq, "{set}");
        close(r.headline.best_exploit_vs_profile, 58.33, TOL_EV, &format!("IP share with KK {set}"));
    }
}

// ---------------------------------------------------------------------------------------------
// T3 — Kuhn poker: T2 but OOP may also bet ½ pot. (Brokos "Reciprocal Ranges, Full Street";
// the Article.) Value unchanged: OOP 47.22. OOP's equilibrium is a family indexed by
// a ∈ [0, ⅓]: bet QQ a, AA 3a, check KK, check-call KK a + ⅓. IP's strategy is unique:
// KK calls ⅓ facing a bet; QQ bluffs ⅓ when checked to.
// ---------------------------------------------------------------------------------------------

#[test]
fn t3_kuhn_family() {
    let r = run(&akq("oop", "", "a"), None);
    close(r.headline.gto_vs_gto, 50.0 - 50.0 / 18.0, TOL_EV, "OOP value 47.22");
    let allin = action(&r, "all-in");
    let a = hand(&r, "QQ").mix_gto[allin];
    assert!((-TOL_FREQ..=1.0 / 3.0 + TOL_FREQ).contains(&a), "QQ bet freq a={a} outside [0, 1/3]");
    close(hand(&r, "AA").mix_gto[allin], 3.0 * a, 2.0 * TOL_FREQ, "AA bets 3a");
    close(hand(&r, "KK").mix_gto[allin], 0.0, TOL_FREQ, "KK checks");

    let r = run(&akq("oop", r#""x", "a""#, "a"), None);
    close(hand(&r, "KK").mix_gto[action(&r, "call")], a + 1.0 / 3.0, 2.0 * TOL_FREQ, "KK check-calls a + 1/3");

    let r = run(&akq("ip", r#""a""#, "a"), None);
    close(hand(&r, "KK").mix_gto[action(&r, "call")], 1.0 / 3.0, TOL_FREQ, "IP KK calls 1/3");
    let r = run(&akq("ip", r#""x""#, "a"), None);
    close(hand(&r, "QQ").mix_gto[action(&r, "all-in")], 1.0 / 3.0, TOL_FREQ, "IP QQ bluffs 1/3");
}
