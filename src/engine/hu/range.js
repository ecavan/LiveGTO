/**
 * What can the bot have? Exact Bayesian reading of its range from the hand so far.
 *
 *   w(h) ∝ Π over the bot's actions  P(action | h, node)
 *
 * The bot really does play by `policy`, so these are its true posterior range, not a guess.
 * Then equity of your hand against that range, and one-street-ahead EVs for the coach.
 */
import { ALL_COMBOS, classify, handType, evaluate, CLASSES } from './hand.js';
import { newHand, act, menu, board, pot } from './game.js';
import { likelihood } from './bots.js';

/** Reconstruct the state before each logged action. */
export function replay(s) {
  let st = newHand({ stacks: s.start, holes: s.holes, board: s.runout });
  const steps = [];
  for (const e of s.log) {
    steps.push({ before: st, entry: e });
    st = act(st, e.type === 'fold' || e.type === 'check' || e.type === 'call' ? { type: e.type } : { type: e.type === 'allin' ? 'allin' : 'raise', to: e.to });
  }
  return steps;
}

/** Abstract key of a logged action at node `before` (matches bots.js keys). */
function keyOf(before, e) {
  if (before.street === 0) return e.type === 'raise' || e.type === 'allin' ? 'raise' : e.type === 'fold' ? 'fold' : 'call';
  if (e.type === 'fold' || e.type === 'check' || e.type === 'call' || e.type === 'allin') return e.type;
  if (e.type === 'raise') return 'raise';
  const bets = menu(before).filter(m => m.type === 'bet');
  const i = bets.findIndex(m => Math.abs(m.to - e.to) < 0.011);
  return i === 0 ? 'small' : i === 1 ? 'big' : 'allin';
}

/**
 * Villain's range as weights over ALL_COMBOS (0 for combos blocked by `known` cards).
 * `s` is the current state; `villain` his seat; `botId` his type.
 */
export function villainRange(s, villain, botId) {
  const known = new Set([...s.holes[1 - villain], ...board(s)]);
  const w = new Float64Array(ALL_COMBOS.length);
  const types = ALL_COMBOS.map(handType);
  ALL_COMBOS.forEach(([a, b], i) => { w[i] = known.has(a) || known.has(b) ? 0 : 1; });
  for (const { before, entry } of replay(s)) {
    if (entry.seat !== villain) continue;
    const key = keyOf(before, entry);
    const bd = board(before);
    const clsCache = new Map();
    for (let i = 0; i < w.length; i++) {
      if (w[i] === 0) continue;
      const combo = ALL_COMBOS[i];
      if (bd.includes(combo[0]) || bd.includes(combo[1])) { w[i] = 0; continue; }
      let cls = null;
      if (before.street > 0) {
        cls = clsCache.get(i) ?? classify(combo, bd);
        clsCache.set(i, cls);
      }
      w[i] *= likelihood(botId, before, villain, key, cls, types[i]);
    }
  }
  return w;
}

/** Share of the range in each hand class on the current board. */
export function rangeByClass(w, bd) {
  const out = Object.fromEntries(CLASSES.map(c => [c, 0]));
  let t = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0) continue;
    out[bd.length === 5 && classify(ALL_COMBOS[i], bd) === 'draw' ? 'air' : classify(ALL_COMBOS[i], bd)] += w[i];
    t += w[i];
  }
  for (const k of CLASSES) out[k] = t ? out[k] / t : 0;
  return out;
}

/**
 * Hero equity against each combo of the range (Float64Array, NaN where weight 0), and overall.
 * River: exact. Flop/turn: `samples` shared random runouts.
 */
export function equities(hero, w, bd, rand = Math.random, samples = 120) {
  const eq = new Float64Array(w.length).fill(NaN);
  const dead = new Set([...hero, ...bd]);
  const need = 5 - bd.length;
  const runouts = [];
  if (need === 0) runouts.push([]);
  else {
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
    for (let k = 0; k < samples; k++) {
      const r = [];
      while (r.length < need) {
        const c = deck[Math.floor(rand() * deck.length)];
        if (!r.includes(c)) r.push(c);
      }
      runouts.push(r);
    }
  }
  const heroVals = runouts.map(r => evaluate([...hero, ...bd, ...r]));
  let num = 0, den = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0) continue;
    const [a, b] = ALL_COMBOS[i];
    let win = 0, n = 0;
    for (let k = 0; k < runouts.length; k++) {
      const r = runouts[k];
      if (r.includes(a) || r.includes(b)) continue;
      const v = evaluate([a, b, ...bd, ...r]);
      win += heroVals[k] > v ? 1 : heroVals[k] === v ? 0.5 : 0;
      n++;
    }
    if (n === 0) continue;
    eq[i] = win / n;
    num += w[i] * eq[i];
    den += w[i];
  }
  return { perCombo: eq, overall: den ? num / den : 0 };
}

export { pot };
