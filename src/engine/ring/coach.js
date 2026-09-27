/**
 * The coach at a full table. For your decision: every opponent still in the hand has a range read
 * from his own strategy (Bayes, as heads-up), your equity against all of them together, and the
 * EV of each option one street ahead:
 *
 *   call    eq·(P + C) − C              check   eq·P
 *   bet x   Π_j F_j · P + (1 − Π_j F_j) · (eq_c · (P + x + Σ_j (1−F_j)·x_j) − x)
 *
 * F_j is opponent j's fold share (his range, his strategy), taken in turn order as if the players
 * before him called; eq_c is your equity against the hands that continue. Heads-up pots use the
 * exact range-vs-range engine; multiway pots a seeded Monte Carlo. Preflop is graded against The
 * Course charts, with these EVs sizing the mistake.
 */
import { act, legal, board, pot, live, posOf, replay, menu } from './game.js';
import { playerPolicyAll, probOfAction, context, keyedMenu } from './players.js';
import { ALL_COMBOS, handType, classify, CLASSES } from '../hu/hand.js';
import { N, CA, CB, comboIndex, equityVsRange, evalFast } from '../hu/equity.js';
import { RFI_RANGES, FACING_OPEN } from '../ranges.js';
import { requiredEquity } from '../potmath.js';
import { bestNatural } from '../hu/coach.js';

const round2 = (x) => Math.round(x * 100) / 100;
const sum = (a) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; };

/** Opponent `seat`'s range at state `s` (from his actions this hand). */
export function rangeOf(s, seat, table, heroSeat, stats) {
  const p = table.players[seat];
  const w = new Float64Array(N).fill(1);
  const dead = new Set([...s.holes[heroSeat], ...board(s)]);
  for (let i = 0; i < N; i++) if (dead.has(CA[i]) || dead.has(CB[i])) w[i] = 0;
  for (const { before, entry } of replay(s)) {
    if (entry.seat !== seat) continue;
    const pol = playerPolicyAll(p, before, seat, context(before, seat, p, heroSeat, stats));
    const pr = probOfAction(pol, entry);
    for (let i = 0; i < N; i++) if (w[i] > 0) w[i] *= pr[i];
  }
  return w;
}

/** Weighted sampler over combos. */
function sampler(w) {
  const cum = new Float64Array(N);
  let t = 0;
  for (let i = 0; i < N; i++) { t += w[i] > 0 ? w[i] : 0; cum[i] = t; }
  return (rand) => {
    if (t <= 0) return -1;
    const x = rand() * t;
    let lo = 0, hi = N - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Hero equity against several ranges at once (share of the pot won). */
export function equityMulti(hero, ranges, bd, samples = 1500) {
  if (!ranges.length) return 1;
  if (ranges.length === 1) {
    const h = comboIndex(hero[0], hero[1]);
    const ind = new Float64Array(N); ind[h] = 1;
    const vs = equityVsRange(ind, bd);
    let num = 0, den = 0;
    for (let i = 0; i < N; i++) if (ranges[0][i] > 0 && !Number.isNaN(vs[i])) { num += ranges[0][i] * (1 - vs[i]); den += ranges[0][i]; }
    return den ? num / den : 0.5;
  }
  const rand = seeded(hero[0] * 131 + hero[1] * 7 + bd.length * 1009 + 17);
  const draws = ranges.map(sampler);
  const cards = new Int32Array(7);
  let won = 0, n = 0;
  for (let k = 0; k < samples; k++) {
    const used = new Set([...hero, ...bd]);
    const hands = [];
    let ok = true;
    for (const d of draws) {
      let got = -1;
      for (let tries = 0; tries < 30; tries++) {
        const i = d(rand);
        if (i < 0) break;
        if (!used.has(CA[i]) && !used.has(CB[i])) { got = i; break; }
      }
      if (got < 0) { ok = false; break; }
      used.add(CA[got]); used.add(CB[got]);
      hands.push(got);
    }
    if (!ok) continue;
    const run = [...bd];
    while (run.length < 5) { const c = Math.floor(rand() * 52); if (!used.has(c)) { used.add(c); run.push(c); } }
    for (let j = 0; j < 5; j++) cards[j] = run[j];
    cards[5] = hero[0]; cards[6] = hero[1];
    const hv = evalFast(cards, 7);
    let best = -1, ties = 0;
    for (const i of hands) { cards[5] = CA[i]; cards[6] = CB[i]; const v = evalFast(cards, 7); if (v > best) { best = v; ties = 0; } if (v === best) ties++; }
    won += hv > best ? 1 : hv === best ? 1 / (ties + 1) : 0;
    n++;
  }
  return n ? won / n : 0.5;
}

/** Opponents in turn order after `s.toAct` who are still in and can act. */
function oppsInOrder(s, hero) {
  const out = [];
  for (let k = 1; k < s.n; k++) {
    const i = (hero + k) % s.n;
    if (!s.folded[i]) out.push(i);
  }
  return out;
}

/**
 * `extra`: an action the menu doesn't have (a logged live hand's real bet size) to price too.
 */
export function ringCoach(s, hero, table, stats, extra = null) {
  const bd = board(s);
  const opps = oppsInOrder(s, hero);
  const ranges = Object.fromEntries(opps.map(j => [j, rangeOf(s, j, table, hero, stats)]));
  const P = pot(s);
  const L = legal(s);
  const eq = equityMulti(s.holes[hero], opps.map(j => ranges[j]), bd);
  const base = menu(s);
  if (extra && !['fold', 'check', 'call'].includes(extra.type) && !base.some(o => o.to != null && Math.abs(o.to - extra.to) < 0.011)) {
    const Lx = legal(s);
    const to = round2(Math.min(Lx.maxTo, Math.max(Lx.minTo, extra.to)));
    const allin = to >= Lx.maxTo - 1e-9;
    const isBet = s.street > 0 && !Lx.facing;
    const opt = allin ? { type: 'allin', to, label: `All-in ${to}` }
      : { type: isBet ? 'bet' : 'raise', to, label: isBet ? `Bet ${round2(to - s.streetBet[hero])} (${Math.round((100 * (to - s.streetBet[hero])) / P)}%)` : `Raise to ${to}` };
    // your real size replaces a menu size it's close to (within 5%), else it's added in order
    const near = base.findIndex(o => o.type === opt.type && o.to != null && Math.abs(o.to - to) <= Math.max(0.25, 0.05 * o.to));
    if (near >= 0) base[near] = opt;
    else {
      const at = base.findIndex(o => (o.to ?? 0) > to && ['bet', 'raise', 'allin'].includes(o.type));
      base.splice(at < 0 ? base.length : at, 0, opt);
    }
  }
  const options = base.map(m => {
    const info = {};
    let ev = 0;
    if (m.type === 'fold') ev = 0;
    else if (m.type === 'check') ev = eq * P;
    else if (m.type === 'call') {
      // a bet bigger than your stack: the part you can't cover comes back to him
      const top = Math.max(...s.streetBet);
      const excess = Math.max(0, top - (s.streetBet[hero] + s.stacks[hero]));
      const C = L.callAmount, Pe = P - excess;
      ev = eq * (Pe + C) - C; info.eq = eq; info.need = requiredEquity(Pe, C);
    }
    else {
      const x = m.to - s.streetBet[hero];
      let st = act(s, m);
      let allFold = 1, added = 0;
      const cont = {};
      // everyone behind responds once, on this street (when the round closes, stop: the next
      // street's first player is not responding to this bet)
      for (let guard = 0; guard < s.n && !st.done && st.toAct !== hero && st.street === s.street; guard++) {
        const j = st.toAct;
        const pol = playerPolicyAll(table.players[j], st, j, context(st, j, table.players[j], hero, stats));
        const fk = pol.opts.findIndex(o => o.type === 'fold');
        const w = ranges[j] || rangeOf(st, j, table, hero, stats);
        const W = sum(w);
        const fold = fk >= 0 && W > 0 ? w.reduce((a, x2, i) => a + x2 * pol.P[fk][i], 0) / W : 0;
        allFold *= fold;
        const need = Math.min(st.stacks[j], Math.max(0, m.to - st.streetBet[j]));
        added += (1 - fold) * need;
        const cw = new Float64Array(N);
        for (let i = 0; i < N; i++) cw[i] = fk >= 0 ? w[i] * (1 - pol.P[fk][i]) : w[i];
        cont[j] = { w: cw, p: 1 - fold };
        st = act(st, { type: legal(st).call ? 'call' : 'check' }); // as if he continued
      }
      const callers = Object.values(cont).filter(c => c.p > 0.02).map(c => c.w);
      const eqc = callers.length ? equityMulti(s.holes[hero], callers, bd, 900) : eq;
      ev = allFold * P + (1 - allFold) * (eqc * (P + x + added / Math.max(1e-9, 1 - allFold)) - x);
      info.fold = allFold;
      info.eqCalled = eqc;
      info.breakEven = x / (P + x);
    }
    return { ...m, ev: round2(ev), info };
  });
  let best = bestNatural(options, s.streetBet[hero], P);
  const tol = Math.max(0.1, 0.02 * P);
  let fine = options.map((o, i) => (options[best].ev - o.ev <= tol ? i : -1)).filter(i => i >= 0);
  let chart = null;
  let preflop = false;
  const notes = [];
  if (s.street === 0) {
    const c = preflopChart(s, hero);
    if (c) {
      preflop = true;
      chart = c.action;
      notes.push(c.note);
      const kind = (o) => (o.type === 'raise' || (o.type === 'allin' && !options.some(x => x.type === 'raise')) ? 'raise' : o.type === 'fold' ? 'fold' : o.type === 'allin' ? 'shove' : 'call');
      fine = options.map((o, i) => (kind(o) === chart ? i : -1)).filter(i => i >= 0);
      best = fine[0] ?? best;
    }
  }
  const byClass = Object.fromEntries(CLASSES.map(k => [k, 0]));
  let tot = 0;
  if (bd.length) for (const j of opps) { const w = ranges[j]; for (let i = 0; i < N; i++) if (w[i] > 0) { byClass[classify(ALL_COMBOS[i], bd)] += w[i]; tot += w[i]; } }
  if (tot) for (const k of CLASSES) byClass[k] /= tot;
  return {
    street: s.street, options, best, fine, tol, equity: eq,
    need: L.facing ? requiredEquity(P, L.callAmount) : null,
    range: bd.length ? byClass : null,
    preflop, chart, notes, nominal: round2(Math.max(0.25, 0.15 * P)),
    opponents: opps.length,
  };
}

/** The Course chart for the hero's preflop spot, when there is one. */
export function preflopChart(s, hero) {
  const key = handType(s.holes[hero]);
  const pos = posOf(s, hero);
  const chartPos = pos === 'HJ' ? 'MP' : pos;
  const raises = s.log.filter(e => e.street === 0 && (e.type === 'raise' || (e.type === 'allin' && !e.callAllIn)));
  const limps = s.log.filter(e => e.street === 0 && e.type === 'call' && raises.length === 0);
  const L = legal(s);
  if (raises.length === 0) {
    const rfi = RFI_RANGES[chartPos] || (pos === 'BB' ? null : RFI_RANGES.BTN);
    if (!rfi) return { action: key && RFI_RANGES.CO.has(key) ? 'raise' : 'call', note: `In the big blind with limpers: raise your good hands, check the rest.` };
    if (limps.length) return rfi.has(key) ? { action: 'raise', note: `Isolate the limper${limps.length > 1 ? 's' : ''}: ${key} is in the ${pos} opening range.` } : { action: 'fold', note: `${key} isn't strong enough to isolate from ${pos}; don't overlimp.` };
    return rfi.has(key) ? { action: 'raise', note: `${key} is a raise first in from ${pos}.` } : { action: L.check ? 'call' : 'fold', note: `${key} is a fold first in from ${pos}: raise or fold, never limp.` };
  }
  if (raises.length === 1) {
    // a short stack's shove or an oversized raise isn't an "open": the price decides (EV)
    if (raises[0].type === 'allin' || raises[0].to >= 12) return null;
    const opener = posOf(s, raises[0].seat);
    const fo = FACING_OPEN[`${chartPos}|${opener === 'HJ' ? 'MP' : opener}`];
    if (!fo) return null;
    const a = fo.raise.has(key) ? 'raise' : fo.call.has(key) ? 'call' : 'fold';
    return { action: a, note: `${pos} vs a ${opener} open: ${key} is a ${a === 'raise' ? '3-bet' : a}.` };
  }
  return null; // 3-bets and beyond: graded by EV
}

export { keyedMenu };
