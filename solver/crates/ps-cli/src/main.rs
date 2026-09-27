//! `ps` — Poker Study command line.
//!
//!   ps spot spots/river_bluffcatch.toml --profile profiles/station.toml
//!   ps spot spots/river_bluffcatch.toml --profile profiles/station.toml --hands
//!   ps spot spots/river_bluffcatch.toml --profile profiles/nit.toml --intensity 0.5 --json out.json

use anyhow::Result;
use clap::{Parser, Subcommand};
use ps_solve::{analyze, Options, Profile, Report, Spot};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "ps",
    about = "Poker Study: GTO baseline vs exploiting a specific opponent"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Build the app's puzzle library (see library/families.toml).
    Library {
        config: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// Only the first N flops of each family (for quick runs).
        #[arg(long)]
        flops: Option<usize>,
    },
    /// Solve a spot and show hero's answer: GTO vs the best exploit of a villain profile.
    Spot {
        spot: PathBuf,
        /// Villain profile TOML (default: GTO villain).
        #[arg(long)]
        profile: Option<PathBuf>,
        /// Profile intensity λ: 0 = GTO, 1 = full leak.
        #[arg(long, default_value_t = 1.0)]
        intensity: f64,
        /// Actions within this % of the pot of the best are "also fine".
        #[arg(long, default_value_t = 1.0)]
        fine_pct: f64,
        /// Also list every hand type.
        #[arg(long)]
        hands: bool,
        /// Write the full report as JSON.
        #[arg(long)]
        json: Option<PathBuf>,
        #[arg(long)]
        progress: bool,
    },
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Library { config, out, flops } => {
            ps_solve::library::build(&config, &out, flops, &mut |m| println!("{m}"))?;
        }
        Cmd::Spot {
            spot,
            profile,
            intensity,
            fine_pct,
            hands,
            json,
            progress,
        } => {
            let spot = Spot::load(&spot)?;
            let profile = match profile {
                Some(p) => Profile::load(&p)?,
                None => Profile::gto(),
            };
            let opts = Options {
                intensity,
                fine_pct,
                print_progress: progress,
                worst_case: true,
            };
            let report = analyze(&spot, &profile, &opts)?;
            print_report(&report, hands);
            if let Some(path) = json {
                std::fs::write(&path, serde_json::to_string_pretty(&report)?)?;
                println!("\nwrote {}", path.display());
            }
        }
    }
    Ok(())
}

/// "call" or "call · fold 20%" — the pure answer for a class, most common first.
fn pure_answer(pure: &[f64], labels: &[String]) -> String {
    let mut v: Vec<(usize, f64)> = pure
        .iter()
        .copied()
        .enumerate()
        .filter(|(_, x)| *x >= 0.05)
        .collect();
    v.sort_by(|a, b| b.1.total_cmp(&a.1));
    match v.as_slice() {
        [] => "-".into(),
        [(a, x), rest @ ..] if rest.is_empty() || *x >= 0.95 => labels[*a].clone(),
        [(a, x), rest @ ..] => {
            let tail: Vec<String> = rest
                .iter()
                .map(|(b, y)| format!("{} {:.0}%", labels[*b], 100.0 * y))
                .collect();
            format!("{} {:.0}% · {}", labels[*a], 100.0 * x, tail.join(" · "))
        }
    }
}

fn print_report(r: &Report, show_hands: bool) {
    let h = &r.headline;
    let l = &r.actions_short;
    println!(
        "{} · villain: {} (intensity {:.2})",
        r.spot, r.profile, r.intensity
    );
    println!(
        "board {} · pot {:.1}bb · hero {:?}",
        r.board, r.pot_bb, r.hero
    );
    if !r.history.is_empty() {
        println!("line: {}", r.history.join(" → "));
    }
    println!("options: {}", r.actions.join(" | "));

    println!("\nWHAT THE SPOT IS WORTH (hero EV from the start of the street, bb)");
    println!(
        "  GTO vs GTO                          {:>7.2}",
        h.gto_vs_gto
    );
    println!(
        "  GTO vs {:<28} {:>7.2}   ({:+.2} from his leaks alone)",
        r.profile,
        h.gto_vs_profile,
        h.gto_vs_profile - h.gto_vs_gto
    );
    println!(
        "  Best exploit vs {:<19} {:>7.2}   ({:+.2} more from adjusting)",
        r.profile,
        h.best_exploit_vs_profile,
        h.best_exploit_vs_profile - h.gto_vs_profile
    );
    println!(
        "  Exploit, one action per hand        {:>7.2}   ({:+.2} vs best)",
        h.pure_exploit_vs_profile,
        h.pure_exploit_vs_profile - h.best_exploit_vs_profile
    );
    println!(
        "  GTO playbook (one action per hand), vs a perfect opponent {:>5.2}   (worst-case cost of never mixing: {:.2})",
        h.pure_gto_vs_perfect_opponent,
        h.gto_vs_gto - h.pure_gto_vs_perfect_opponent
    );
    println!(
        "  [convergence: GTO exploitability {:.2}% pot, exploit gap {:.2}% pot]",
        h.gto_exploitability_pct, h.exploit_gap_pct
    );

    println!("\nYOUR ANSWER BY HAND CLASS  (every hand gets ONE action; % = share of the class's combos)");
    println!(
        "  {:<9} {:>6}  {:<34} {}",
        "class",
        "range",
        "GTO playbook",
        format!("vs {}", r.profile)
    );
    for c in &r.classes {
        println!(
            "  {:<9} {:>5.0}%  {:<34} {}",
            c.class.name(),
            100.0 * c.gto.weight,
            pure_answer(&c.gto.pure, l),
            pure_answer(&c.exploit.pure, l)
        );
    }

    println!("\nVILLAIN'S RANGE WHEN YOU DECIDE");
    println!(
        "  {:<9} {:>6} {:>10}",
        "class",
        "GTO",
        r.profile.chars().take(10).collect::<String>()
    );
    for (c, g, p) in &r.villain_range {
        if *g > 0.0005 || *p > 0.0005 {
            println!("  {:<9} {:>5.0}% {:>9.0}%", c.name(), 100.0 * g, 100.0 * p);
        }
    }

    if show_hands {
        println!(
            "\nHANDS  (your one answer; [also fine] = within tolerance; (action EV loss in bb))"
        );
        for x in &r.hands {
            let fmt = |reached: bool, pure: usize, fine: &[usize], ev: &[f64]| -> String {
                if !reached {
                    return "never gets here (played differently earlier)".into();
                }
                let mut s = l[pure].clone();
                if !fine.contains(&pure) {
                    s += &format!(" ({:+.2})", ev[pure]);
                }
                let alts: Vec<&str> = fine
                    .iter()
                    .filter(|&&a| a != pure)
                    .map(|&a| l[a].as_str())
                    .collect();
                if !alts.is_empty() {
                    s += &format!(" [{}]", alts.join(", "));
                }
                let worse: Vec<String> = (0..l.len())
                    .filter(|a| !fine.contains(a) && *a != pure)
                    .map(|a| format!("{} {:+.1}", l[a], ev[a]))
                    .collect();
                if !worse.is_empty() {
                    s += &format!("  ({})", worse.join(", "));
                }
                s
            };
            println!(
                "  {:<4} {:<8} GTO: {:<46} vs {}: {}",
                x.hand,
                x.class.name(),
                fmt(x.weight_gto > 0.0, x.pure_gto, &x.fine_gto, &x.ev_gto),
                r.profile,
                fmt(
                    x.weight_exploit > 0.0,
                    x.pure_exploit,
                    &x.fine_exploit,
                    &x.ev_exploit
                )
            );
        }
    }
}
