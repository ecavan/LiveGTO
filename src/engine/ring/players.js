/**
 * Players for the live table: people, not pure archetypes. Each seat is a *mix* of styles drawn
 * from a live $1/$2 pool (say 70% station, 30% whale), with a name, and every one of them slowly
 * adjusts to what you do (steals more from a tight player, calls down a bluffer).
 *
 * Every strategy is vectorised (all 1,326 combos at once) so the coach can read their ranges:
 * preflop by hand percentile and situation, postflop by hand class with the same profile rules as
 * the heads-up bots and the solver, made more honest multiway.
 */
import { PREFLOP_RANK } from '../hu/preflopRank.js';
import { ALL_COMBOS, handType, CLASSES } from '../hu/hand.js';
import { BASE_OPEN, BASE_FACING, sizeBucket, applyProfile, streetRole } from '../hu/bots.js';
import { classesOn, HT } from '../hu/policy.js';
import { N } from '../hu/equity.js';
import { menu, legal, board, pot, posOf, live } from './game.js';
import PREFLOP from './preflop.json';

const PCT = Object.fromEntries(PREFLOP_RANK.map(([h, , cum]) => [h, cum]));
const PCT_OF = Float64Array.from(HT, k => PCT[k]);

/**
 * The archetypes. Their preflop play (`pre`) is fitted to real players of each type in
 * preflop.json (analysis/fit_preflop.py): every number is the top share of all hands that does
 * something, so the frequencies come out right when everyone is dealt a random hand.
 *   open[pos]      raise first in            openLimp[pos]  limp first in (the next hands down)
 *   behind         [isolate, limp behind] with limpers in front
 *   bbIso          big blind raises limpers
 *   vs1 / bb       [3-bet, continue] facing one raise (cold / in the big blind)
 *   vsIso          [re-raise, continue] after limping and facing a raise: shares of his limp range
 *   vs2 / vs3      [raise, continue] facing a 3-bet / a 4-bet or a big shove: shares of the
 *                  range he came in with (the opener's opening range, the 3-bettor's 3-bets)
 *   noise          recreational randomness: a slice of the hands he'd fold he plays anyway
 */
const ARCH = {
  whale: { name: 'Whale', profile: 'whale', learn: 0.2, ramp: 200, blurb: 'plays half his hands, limps and calls, chases draws' },
  station: { name: 'Station', profile: 'station', learn: 0.25, ramp: 180, blurb: 'plays too many hands and calls a lot; his river bets are mostly value' },
  nit: { name: 'Nit', profile: 'nit', learn: 0.35, ramp: 140, blurb: 'tight and scared; folds to pressure; big bets are the nuts' },
  maniac: { name: 'Maniac', profile: 'maniac', learn: 0.3, ramp: 160, blurb: 'raises and bluffs relentlessly' },
  reg: { name: 'Reg', profile: 'reg', learn: 0.5, ramp: 90, blurb: 'solid, sensible ranges; c-bets a lot and gives up when called' },
  shark: { name: 'Shark', profile: 'gto', learn: 0.7, ramp: 60, blurb: 'tight-aggressive, adjusts to you quickly' },
  pro: { name: 'Pro', profile: 'gto', learn: 1, ramp: 30, blurb: 'a strong regular: disciplined ranges, reads you fast and exploits it' },
};
export const ARCHETYPES = Object.fromEntries(Object.entries(ARCH).map(([k, a]) => [k, { ...a, pre: PREFLOP[k] }]));

/**
 * Table difficulty: which kinds of players fill the seats.
 *   easy    only fish (whales, stations, nits, maniacs, and blends of them)
 *   medium  one strong player (a shark or a pro) and one reg; the rest fish
 *   hard    three strong players (mostly pros) and one reg; the rest fish
 */
export const LEVELS = {
  easy: { name: 'Easy', blurb: 'All fish: whales, stations, nits and the odd maniac. Learn to take their money.', strong: 0, regs: 0 },
  medium: { name: 'Medium', blurb: 'One shark or pro and one solid reg among the fish. Pick your spots.', strong: 1, regs: 1 },
  hard: { name: 'Hard', blurb: 'Three strong players who read you fast, one reg, and whoever is left over.', strong: 3, regs: 1 },
};
const FISH = { station: 0.35, whale: 0.25, nit: 0.25, maniac: 0.15 };

/** Seat tiers for a table of `n` (you included): 'strong' | 'reg' | 'fish', shuffled. */
export function tableTiers(level, n, rand = Math.random) {
  const L = LEVELS[level] || LEVELS.medium;
  const opp = n - 1;
  const strong = Math.min(L.strong, Math.max(0, opp - 1));
  const regs = Math.min(L.regs, opp - strong);
  const tiers = [...Array(strong).fill('strong'), ...Array(regs).fill('reg'), ...Array(opp - strong - regs).fill('fish')];
  for (let i = tiers.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [tiers[i], tiers[j]] = [tiers[j], tiers[i]]; }
  return tiers;
}
/** A live $1/$2 pool. */
const POOL = { station: 0.28, whale: 0.14, nit: 0.2, reg: 0.2, maniac: 0.06, shark: 0.12 };
const NAMES = ['Mike', 'Tony', 'Sal', 'Dave', 'Rick', 'Linda', 'Joe', 'Frank', 'Vinny', 'Steve', 'Carl', 'Rosa', 'Eddie', 'Bobby', 'Gus', 'Nate', 'Maria', 'Jin', 'Omar', 'Pete', 'Hank', 'Dee', 'Marco', 'Lou'];

function pick(rand, weights) {
  let x = rand() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { x -= w; if (x <= 0) return k; }
  return Object.keys(weights)[0];
}

/**
 * A random player of a tier: fish (a fish style, often blended with another), reg (a reg, sometimes
 * with a fishy streak), or strong (a pro or a shark, sometimes a blend of the two).
 * With no tier: anyone from the general live pool.
 */
export function randomPlayer(rand = Math.random, used = new Set(), tier = null) {
  const pool = tier === 'fish' ? FISH : tier === 'reg' ? { reg: 1 } : tier === 'strong' ? { pro: 0.6, shark: 0.4 } : POOL;
  const main = pick(rand, pool);
  const mix = { [main]: 1 };
  const blendPool = tier === 'fish' ? FISH : tier === 'reg' ? { nit: 0.4, station: 0.4, shark: 0.2 } : tier === 'strong' ? { pro: 0.5, shark: 0.5 } : POOL;
  if (rand() < (tier === 'reg' ? 0.35 : 0.5)) {
    const options = Object.fromEntries(Object.entries(blendPool).filter(([k]) => k !== main));
    if (Object.keys(options).length) {
      const second = pick(rand, options);
      const w = 0.2 + rand() * 0.25;
      mix[main] = 1 - w;
      mix[second] = w;
    }
  }
  let name;
  do { name = NAMES[Math.floor(rand() * NAMES.length)]; } while (used.has(name) && used.size < NAMES.length);
  used.add(name);
  const learn = Object.entries(mix).reduce((a, [k, w]) => a + w * ARCHETYPES[k].learn, 0);
  const ramp = Object.entries(mix).reduce((a, [k, w]) => a + w * (ARCHETYPES[k].ramp ?? 120), 0);
  return { name, mix, learn, ramp, tier: tier ?? (main === 'pro' || main === 'shark' ? 'strong' : main === 'reg' ? 'reg' : 'fish'), seen: 0 };
}

/** "Station / whale" style label. */
export function styleLabel(p) {
  const parts = Object.entries(p.mix).sort((a, b) => b[1] - a[1]);
  return parts.map(([k]) => ARCHETYPES[k].name).join(' / ');
}

// ------------------------------------------------------------------ what they know about you

/** Your stats as the table sees them. */
export function newHeroStats() {
  return { hands: 0, vpip: 0, pfr: 0, bets: 0, calls: 0, bluffsShown: 0, valueShown: 0 };
}

/** How far a player has adjusted to you (0…1): his learning rate × how much he has seen. */
export const adjustment = (p, stats) => p.learn * Math.min(1, stats.hands / (p.ramp ?? 120));

// ------------------------------------------------------------------ strategies

const raisesBefore = (s) => s.log.filter(e => e.street === 0 && (e.type === 'raise' || (e.type === 'allin' && !e.callAllIn))).length;

/** His last preflop action and what he faced when he took it (null if he hasn't acted). */
function lastPreflop(s, seat) {
  let raises = 0, limpers = 0, last = null;
  for (const e of s.log) {
    if (e.street !== 0) continue;
    const aggr = e.type === 'raise' || (e.type === 'allin' && !e.callAllIn);
    const call = e.type === 'call' || (e.type === 'allin' && e.callAllIn);
    if (e.seat === seat) last = { aggr, call, raises, limpers };
    if (aggr) raises++;
    else if (call && raises === 0) limpers++;
  }
  return last;
}

/**
 * The hands his preflop play so far is consistent with, as [low, high] top shares: he raised
 * first in → [0, open]; he limped → (open, open + limp]; and so on.
 */
function rangeSoFar(a, pos, last) {
  const bb = pos === 'BB';
  if (!last) return [0, bb ? a.bb[1] : a.vs1[1]]; // hasn't acted: what he'd have called with
  if (last.raises === 0) {
    if (last.aggr) return [0, bb ? a.bbIso : last.limpers ? a.behind[0] : a.open[pos] ?? a.open.BTN];
    const lo = last.limpers ? a.behind[0] : a.open[pos] ?? a.open.BTN;
    return [lo, Math.min(1, lo + (last.limpers ? a.behind[1] : a.openLimp[pos] ?? a.openLimp.BTN))];
  }
  if (last.raises === 1) return [0, (bb ? a.bb : a.vs1)[last.aggr ? 0 : 1]];
  return [0, (last.aggr ? a.vs2[0] : a.vs2[1]) * 0.1];
}

/** Preflop: P(raise), P(call/limp/check), P(fold) for every combo, for one archetype. */
function preflopArch(arch, s, seat, ctx) {
  const a = arch.pre;
  const L = legal(s);
  const raises = raisesBefore(s);
  const owe = L.callAmount;
  const pos = posOf(s, seat);
  const limpers = s.log.filter(e => e.street === 0 && e.type === 'call').length;
  const last = lastPreflop(s, seat);
  let lvl = raises;
  if (owe >= 25) lvl = Math.max(lvl, 3);
  let rT, cT;
  if (lvl === 0) {
    if (pos === 'BB') {
      rT = limpers ? a.bbIso : 0;
      cT = 1; // free check
    } else if (!limpers) {
      // adjusting to you: steal more when you're a tight blind
      const m = ctx.heroInBlinds && ctx.heroTight ? 1 + 0.6 * ctx.adj : 1;
      rT = Math.min(1, (a.open[pos] ?? a.open.BTN) * m);
      cT = Math.min(1, rT + (a.openLimp[pos] ?? a.openLimp.BTN));
    } else {
      rT = a.behind[0];
      cT = Math.min(1, rT + a.behind[1]);
    }
  } else {
    // against an aggressive raiser (you), continue wider as they learn
    const widen = ctx.vsHero && ctx.heroAggro ? 1 + 0.5 * ctx.adj : 1;
    if (lvl === 1 && last?.call) {
      // limped, now raised: re-raise / continue with the top of his limping range
      const [lo, hi] = rangeSoFar(a, pos, last);
      rT = lo + a.vsIso[0] * (hi - lo);
      cT = lo + Math.min(1, a.vsIso[1] * widen) * (hi - lo);
    } else if (lvl === 1) {
      const [r, c] = pos === 'BB' ? a.bb : a.vs1;
      const shrink = owe >= 10 ? 0.6 : 1;
      rT = r * shrink * widen;
      cT = c * shrink * widen;
    } else {
      // re-raised: the top shares of the range he came in with
      const [, hi] = rangeSoFar(a, pos, last);
      const [r, c] = lvl === 2 ? a.vs2 : a.vs3;
      rT = r * hi;
      cT = Math.min(1, c * widen) * hi;
    }
  }
  const R = new Float64Array(N), C = new Float64Array(N), F = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = PCT_OF[i];
    let raise = p <= rT ? 1 : 0;
    let cont = !raise && p <= cT ? 1 : 0;
    if (a.noise) {
      // recreational randomness: a slice of the folds limp/call, a smaller slice raise
      const f0 = 1 - raise - cont;
      raise += f0 * a.noise * 0.4;
      cont += f0 * a.noise;
    }
    R[i] = raise; C[i] = cont; F[i] = Math.max(0, 1 - raise - cont);
  }
  return { R, C, F };
}

/** Postflop mix for one archetype and hand class: an abstract {check, small, big, allin} or {fold, call, raise, allin}. */
function postflopArch(a, s, seat, cls, ctx) {
  const L = legal(s);
  const street = ['preflop', 'flop', 'turn', 'river'][s.street];
  const c = street === 'river' && cls === 'draw' ? 'air' : cls;
  let fraction = 0, base;
  if (L.facing) {
    // a bet bigger than his stack: only what he can call counts (the rest goes back)
    const excess = Math.max(0, Math.max(...s.streetBet) - s.streetBet[seat] - L.callAmount);
    fraction = L.callAmount / Math.max(0.01, pot(s) - L.callAmount - excess);
    base = { ...BASE_FACING[sizeBucket(fraction)][c] };
  }
  const role = L.facing ? null : streetRole(s, seat);
  if (!L.facing) base = { ...BASE_OPEN[role][c] };
  let mix = applyProfile(a.profile, base, { street, facing: L.facing, fraction, cls: c, handType: null, role });
  // multiway: bluff less, give up weak hands more
  const opps = live(s).length - 1;
  if (opps >= 2) {
    mix = applyProfile('__none', mix, {});
    if (!L.facing && (c === 'air' || c === 'draw' || c === 'weak')) scaleKeys(mix, ['small', 'big', 'allin'], 0.5);
    if (L.facing && (c === 'air' || c === 'weak')) scaleKeys(mix, ['fold'], 1.3);
  }
  // adjusting to you: call your bets down if you bluff, fold more if you never do
  if (L.facing && ctx.vsHero && ctx.adj > 0) {
    if (ctx.heroBluffy) scaleKeys(mix, ['fold'], 1 - 0.5 * ctx.adj);
    else if (ctx.heroHonest) scaleKeys(mix, ['fold'], 1 + 0.3 * ctx.adj);
  }
  return mix;
}

/** Multiply the mass on `keys` (capped at 1) and renormalise the rest. */
function scaleKeys(mix, keys, m) {
  const cur = keys.reduce((t, k) => t + (mix[k] || 0), 0);
  if (cur <= 0) return;
  const nw = Math.min(1, cur * m);
  const rest = 1 - cur;
  for (const k of Object.keys(mix)) {
    if (keys.includes(k)) mix[k] = (mix[k] || 0) * (nw / cur);
    else mix[k] = rest > 1e-12 ? mix[k] * ((1 - nw) / rest) : 0;
  }
}

/** Keyed menu for the ring state (fold/call/raise/allin or check/small/big/allin). */
export function keyedMenu(s) {
  const m = menu(s);
  const L = legal(s);
  const bets = m.filter(o => o.type === 'bet');
  return m.map(o => {
    let key = o.type;
    if (s.street === 0) key = o.type === 'raise' || o.type === 'allin' ? 'raise' : o.type === 'fold' ? 'fold' : 'call';
    else if (o.type === 'bet') key = bets.indexOf(o) === 0 ? 'small' : 'big';
    else if (!L.facing && o.type === 'check') key = 'check';
    return { ...o, key };
  });
}

/** Context about you for a decision by `seat` (who is facing whom, how much they've adjusted). */
export function context(s, seat, player, heroSeat, stats) {
  const adj = adjustment(player, stats);
  const lastAggr = [...s.log].reverse().find(e => e.type === 'raise' || e.type === 'bet' || (e.type === 'allin' && !e.callAllIn));
  const heroPos = posOf(s, heroSeat);
  const n = Math.max(1, stats.hands);
  return {
    adj,
    vsHero: !!lastAggr && lastAggr.seat === heroSeat,
    heroInBlinds: heroPos === 'SB' || heroPos === 'BB',
    heroTight: stats.hands >= 15 && stats.vpip / n < 0.18,
    heroAggro: stats.hands >= 15 && stats.pfr / n > 0.28,
    heroBluffy: stats.bluffsShown >= 2 && stats.bluffsShown >= 0.4 * (stats.bluffsShown + stats.valueShown),
    heroHonest: stats.valueShown >= 3 && stats.bluffsShown === 0,
  };
}

/**
 * Strategy of `player` (in `seat`, to act) for every combo: { opts, P } over the menu.
 */
export function playerPolicyAll(player, s, seat, ctx) {
  const opts = keyedMenu(s);
  const P = opts.map(() => new Float64Array(N));
  const byKey = (k) => opts.map((o, j) => (o.key === k ? j : -1)).filter(j => j >= 0);
  const L = legal(s);
  for (const [arch, w] of Object.entries(player.mix)) {
    const a = ARCHETYPES[arch];
    if (s.street === 0) {
      const { R, C, F } = preflopArch(a, s, seat, ctx);
      // one raise size: the first raise option (the all-in only if it's the only one). A short
      // stack (≤35bb) facing a raise, or ≤15bb first in, raises all-in: re-raise shoves, not 3-bets
      const eff = s.stacks[seat] + s.streetBet[seat];
      const shoveOnly = (eff <= 35 && raisesBefore(s) >= 1) || eff <= 15;
      const aOpt = opts.findIndex(o => o.type === 'allin');
      const rOpt = shoveOnly && aOpt >= 0 ? aOpt : opts.findIndex(o => o.type === 'raise') >= 0 ? opts.findIndex(o => o.type === 'raise') : aOpt;
      const cOpt = opts.findIndex(o => o.type === 'call' || o.type === 'check');
      const fOpt = opts.findIndex(o => o.type === 'fold');
      for (let i = 0; i < N; i++) {
        let r = R[i], c = C[i], f = F[i];
        if (rOpt < 0) { c += r; r = 0; }
        if (fOpt < 0) { c += f; f = 0; }
        if (rOpt >= 0) P[rOpt][i] += w * r;
        if (cOpt >= 0) P[cOpt][i] += w * c;
        if (fOpt >= 0) P[fOpt][i] += w * f;
      }
      continue;
    }
    const cls = classesOn(board(s));
    const byCls = CLASSES.map(c => postflopArch(a, s, seat, c, ctx));
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const mix = byCls[ci];
      // map abstract keys onto the menu, falling through missing sizes
      const dist = {};
      if (L.facing) {
        let pr = mix.raise || 0, pa = mix.allin || 0, pc = mix.call || 0;
        if (!byKey('raise').length) { pa += pr; pr = 0; }
        if (!byKey('allin').length) { pc += pa; pa = 0; }
        Object.assign(dist, { fold: mix.fold || 0, call: pc, raise: pr, allin: pa });
      } else {
        let ps = mix.small || 0, pb = mix.big || 0, pa = mix.allin || 0;
        if (!byKey('big').length) { pa += pb; pb = 0; }
        if (!byKey('small').length) { if (byKey('big').length) pb += ps; else pa += ps; ps = 0; }
        if (!byKey('allin').length) { ps += pa; pa = 0; if (!byKey('small').length) { pb += ps; ps = 0; } }
        Object.assign(dist, { check: mix.check || 0, small: ps, big: pb, allin: pa });
      }
      const tot = Object.values(dist).reduce((x, y) => x + y, 0) || 1;
      for (const [k, p] of Object.entries(dist)) {
        const js = byKey(k);
        if (!js.length || p <= 0) continue;
        for (let i = 0; i < N; i++) if (cls[i] === ci) P[js[0]][i] += (w * p) / tot;
      }
    }
  }
  return { opts, P };
}

/** Probability of a logged action under a vectorised policy (by type and amount). */
export function probOfAction(pol, entry) {
  const t = entry.type === 'allin' && entry.callAllIn ? 'call' : entry.type;
  let j = pol.opts.findIndex(o => o.type === t && (o.to == null || entry.to == null || Math.abs(o.to - entry.to) < 0.011));
  if (j < 0 && (t === 'bet' || t === 'raise' || t === 'allin')) {
    let best = -1, d = Infinity;
    pol.opts.forEach((o, k) => { if (['bet', 'raise', 'allin'].includes(o.type)) { const dd = Math.abs((o.to ?? 0) - (entry.to ?? 0)); if (dd < d) { d = dd; best = k; } } });
    j = best;
  }
  if (j < 0 && t === 'call') j = pol.opts.findIndex(o => o.type === 'call' || o.type === 'check');
  return j < 0 ? new Float64Array(N) : pol.P[j];
}

export { handType, ALL_COMBOS };
