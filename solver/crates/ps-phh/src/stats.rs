//! HUD-style counters per player: how often he does something out of the times he could.
//!
//! Definitions (the usual tracker ones):
//! - VPIP / PFR: put money in voluntarily / raised, preflop, out of hands he acted in.
//! - Limp: called with no raise in front (open-limp or over-limp); the small blind completing
//!   counts. Open-limp: limped with nobody in yet.
//! - RFI by position: raised when everyone before him had folded (and open-limps by position).
//! - Behind limpers (no raise yet, not the big blind): isolate (raise) or limp behind.
//! - Versus an open: his first decision facing exactly one raise (cold, i.e. he hadn't limped).
//!   Versus an iso-raise: the same after he limped.
//! - Versus a 3-bet: he made the first raise and now faces the second.
//! - C-bet (flop, turn, river): last aggressor of the previous street, first chance to bet.
//! - Facing a c-bet: first decision facing that bet when it is the only bet of the street.
//! - Donk: bets into the previous street's aggressor, who acts after him.
//! - Check-raise: checked, then faced a bet, and raised.
//! - Went to showdown (WTSD): saw the flop and was still in at the end; won at showdown (W$SD).

use crate::replay::{pos_index, Act, Replay};

macro_rules! fields {
    ($($name:ident),* $(,)?) => {
        #[allow(non_camel_case_types, dead_code)]
        #[derive(Clone, Copy)]
        #[repr(usize)]
        pub enum F { $($name),* , COUNT }
        pub const NAMES: &[&str] = &[$(stringify!($name)),*];
    };
}

fields!(
    hands, vpip_opp, vpip, pfr,
    limp_opp, limp, olimp_opp, olimp,
    rfi_opp_btn, rfi_opp_co, rfi_opp_hj, rfi_opp_lj, rfi_opp_mp, rfi_opp_ep2, rfi_opp_ep1, rfi_opp_utg, rfi_opp_sb,
    rfi_btn, rfi_co, rfi_hj, rfi_lj, rfi_mp, rfi_ep2, rfi_ep1, rfi_utg, rfi_sb,
    olimp_btn, olimp_co, olimp_hj, olimp_lj, olimp_mp, olimp_ep2, olimp_ep1, olimp_utg, olimp_sb,
    behind_opp, behind_iso, behind_limp,
    vo_opp, vo_fold, vo_call, vo_raise,
    vo_bb_opp, vo_bb_fold, vo_bb_call, vo_bb_raise,
    vi_opp, vi_fold, vi_call, vi_raise,
    v3_opp, v3_fold, v3_call, v3_raise,
    bb_limped_opp, bb_limped_raise,
    saw_flop, wtsd, wsd_known, wsd,
    bet_f, bet_t, bet_r,
    raise_f, raise_t, raise_r,
    call_f, call_t, call_r,
    fold_f, fold_t, fold_r,
    check_f, check_t, check_r,
    cb_opp_f, cb_opp_t, cb_opp_r,
    cb_f, cb_t, cb_r,
    cb_hu_opp_f, cb_hu_f,
    vcb_opp_f, vcb_opp_t, vcb_opp_r,
    vcb_fold_f, vcb_fold_t, vcb_fold_r,
    vcb_raise_f, vcb_raise_t, vcb_raise_r,
    donk_opp_f, donk_opp_t, donk_opp_r,
    donk_f, donk_t, donk_r,
    xr_opp_f, xr_opp_t, xr_opp_r,
    xr_f, xr_t, xr_r,
    xd_opp_f, xd_opp_t, xd_opp_r,
    xd_bet_f, xd_bet_t, xd_bet_r,
    fbet_opp_f, fbet_opp_t, fbet_opp_r,
    fbet_fold_f, fbet_fold_t, fbet_fold_r,
    size_small, size_large, size_over,
    size_sum_pct,
);

#[derive(Clone)]
pub struct Counters(pub Vec<u64>);

impl Default for Counters {
    fn default() -> Self {
        Counters(vec![0; F::COUNT as usize])
    }
}

impl Counters {
    #[inline]
    fn add(&mut self, f: F, k: usize) {
        self.0[f as usize + k] += 1;
    }
    #[inline]
    fn inc(&mut self, f: F) {
        self.0[f as usize] += 1;
    }
    pub fn merge(&mut self, o: &Counters) {
        for (a, b) in self.0.iter_mut().zip(&o.0) {
            *a += b;
        }
    }
}

/// Adds one hand to the counters of each player (`c[i]` for PHH seat i).
pub fn tally(r: &Replay, c: &mut [&mut Counters]) {
    let n = r.n;
    let mut acted = vec![false; n];
    let mut vpip = vec![false; n];
    let mut pfr = vec![false; n];
    let mut limped = vec![false; n];
    let mut opener = vec![false; n];
    let mut limp_done = vec![false; n];
    let mut vo_done = vec![false; n];
    let mut v3_done = vec![false; n];
    for i in 0..n {
        c[i].inc(F::hands);
    }
    for d in r.decisions.iter().filter(|d| d.street == 0) {
        let p = d.p;
        let cp = &mut *c[p];
        if !acted[p] {
            acted[p] = true;
            cp.inc(F::vpip_opp);
        }
        match d.act {
            Act::Call => vpip[p] = true,
            Act::Raise => {
                vpip[p] = true;
                pfr[p] = true;
            }
            _ => {}
        }
        if d.raises == 0 && p != 1 && !limp_done[p] {
            limp_done[p] = true;
            cp.inc(F::limp_opp);
            if d.act == Act::Call {
                cp.inc(F::limp);
                limped[p] = true;
            }
            if d.limpers == 0 {
                cp.inc(F::olimp_opp);
                if d.act == Act::Call {
                    cp.inc(F::olimp);
                }
                let k = match pos_index(p, n) {
                    8 => 8,
                    x => x,
                };
                cp.add(F::rfi_opp_btn, k);
                if d.act == Act::Raise {
                    cp.add(F::rfi_btn, k);
                }
                if d.act == Act::Call {
                    cp.add(F::olimp_btn, k);
                }
            } else {
                // limpers in front, no raise: raise them (isolate), limp behind, or fold
                cp.inc(F::behind_opp);
                match d.act {
                    Act::Raise => cp.inc(F::behind_iso),
                    Act::Call => cp.inc(F::behind_limp),
                    _ => {}
                }
            }
        }
        if d.raises == 0 && p == 1 && d.limpers > 0 {
            cp.inc(F::bb_limped_opp);
            if d.act == Act::Raise {
                cp.inc(F::bb_limped_raise);
            }
        }
        if d.raises == 1 && !vo_done[p] && !opener[p] {
            vo_done[p] = true;
            let (o, fo, ca, ra) = if limped[p] {
                (F::vi_opp, F::vi_fold, F::vi_call, F::vi_raise)
            } else if p == 1 && d.limpers == 0 {
                (F::vo_bb_opp, F::vo_bb_fold, F::vo_bb_call, F::vo_bb_raise)
            } else {
                (F::vo_opp, F::vo_fold, F::vo_call, F::vo_raise)
            };
            cp.inc(o);
            cp.inc(match d.act {
                Act::Fold => fo,
                Act::Call => ca,
                _ => ra,
            });
        }
        if d.raises == 2 && opener[p] && !v3_done[p] {
            v3_done[p] = true;
            cp.inc(F::v3_opp);
            cp.inc(match d.act {
                Act::Fold => F::v3_fold,
                Act::Call => F::v3_call,
                _ => F::v3_raise,
            });
        }
        if d.act == Act::Raise && d.raises == 0 {
            opener[p] = true;
        }
    }
    for i in 0..n {
        if vpip[i] {
            c[i].inc(F::vpip);
        }
        if pfr[i] {
            c[i].inc(F::pfr);
        }
    }

    for s in 1..=3u8 {
        let k = (s - 1) as usize;
        let mut cb_done = vec![false; n];
        let mut vcb_done = vec![false; n];
        let mut donk_done = vec![false; n];
        let mut checked = vec![false; n];
        let mut xr_done = vec![false; n];
        let mut xd_done = vec![false; n];
        let mut fb_done = vec![false; n];
        for d in r.decisions.iter().filter(|d| d.street == s) {
            let p = d.p;
            let cp = &mut *c[p];
            match d.act {
                Act::Bet => {
                    cp.add(F::bet_f, k);
                    let frac = d.to / d.pot.max(1e-9);
                    if frac < 0.5 {
                        cp.inc(F::size_small);
                    } else if frac <= 1.05 {
                        cp.inc(F::size_large);
                    } else {
                        cp.inc(F::size_over);
                    }
                    cp.0[F::size_sum_pct as usize] += (100.0 * frac).round().min(1000.0) as u64;
                }
                Act::Raise => cp.add(F::raise_f, k),
                Act::Call => cp.add(F::call_f, k),
                Act::Fold => cp.add(F::fold_f, k),
                Act::Check => cp.add(F::check_f, k),
            }
            if d.prev_aggr == Some(p) && d.raises == 0 && !cb_done[p] {
                cb_done[p] = true;
                cp.add(F::cb_opp_f, k);
                if d.act == Act::Bet {
                    cp.add(F::cb_f, k);
                }
                if s == 1 && d.live_at_street == 2 {
                    cp.inc(F::cb_hu_opp_f);
                    if d.act == Act::Bet {
                        cp.inc(F::cb_hu_f);
                    }
                }
            }
            if let Some(a) = d.prev_aggr {
                if a != p && d.raises == 0 && !d.prev_aggr_acted && d.prev_aggr_can_act && !donk_done[p] {
                    donk_done[p] = true;
                    cp.add(F::donk_opp_f, k);
                    if d.act == Act::Bet {
                        cp.add(F::donk_f, k);
                    }
                }
                if a != p && d.raises == 1 && d.first_bettor == Some(a) && !vcb_done[p] {
                    vcb_done[p] = true;
                    cp.add(F::vcb_opp_f, k);
                    match d.act {
                        Act::Fold => cp.add(F::vcb_fold_f, k),
                        Act::Raise => cp.add(F::vcb_raise_f, k),
                        _ => {}
                    }
                }
            }
            // no aggressor last street (it checked through): bet when checked to?
            if d.prev_aggr.is_none() && d.raises == 0 && !xd_done[p] && s > 1 {
                xd_done[p] = true;
                cp.add(F::xd_opp_f, k);
                if d.act == Act::Bet {
                    cp.add(F::xd_bet_f, k);
                }
            }
            // facing the first bet of the street, whoever made it
            if d.raises == 1 && !fb_done[p] && d.first_bettor != Some(p) {
                fb_done[p] = true;
                cp.add(F::fbet_opp_f, k);
                if d.act == Act::Fold {
                    cp.add(F::fbet_fold_f, k);
                }
            }
            if checked[p] && d.raises >= 1 && !xr_done[p] {
                xr_done[p] = true;
                cp.add(F::xr_opp_f, k);
                if d.act == Act::Raise {
                    cp.add(F::xr_f, k);
                }
            }
            if d.act == Act::Check {
                checked[p] = true;
            }
        }
    }

    for i in 0..n {
        if r.saw_flop[i] {
            c[i].inc(F::saw_flop);
            if r.showdown && !r.folded[i] {
                c[i].inc(F::wtsd);
                if let Some(w) = r.won[i] {
                    c[i].inc(F::wsd_known);
                    if w {
                        c[i].inc(F::wsd);
                    }
                }
            }
        }
    }
}
