/**
 * What can the bot have? Exact Bayesian reading of its range from the hand so far.
 *
 *   w(h) ∝ Π over the bot's actions  P(action | h, node)
 *
 * The bot really does play by `policy`, so these are its true posterior range, not a guess.
 * Then equity of your hand against that range, and one-street-ahead EVs for the coach.
 */
import { ALL_COMBOS, classify, handType, evaluate, CLASSES } from './hand.js';
import { board, pot, replay } from './game.js';
import { actionProb } from './agents.js';
import { N, comboIndex, equityVsRange } from './equity.js';

/**
 * Villain's range as weights over ALL_COMBOS (0 for combos blocked by `known` cards).
 * `s` is the current state; `villain` his seat; `agent` the bot (agents.js) or a profile id.
 */
export function villainRange(s, villain, agent) {
  const known = new Set([...s.holes[1 - villain], ...board(s)]);
  const w = new Float64Array(ALL_COMBOS.length);
  ALL_COMBOS.forEach(([a, b], i) => { w[i] = known.has(a) || known.has(b) ? 0 : 1; });
  const ag = typeof agent === 'string' ? { id: agent, kind: 'profile' } : agent;
  for (const { before, entry } of replay(s)) {
    if (entry.seat !== villain) continue;
    const p = actionProb(ag, before, entry);
    for (let i = 0; i < w.length; i++) if (w[i] > 0) w[i] *= p[i];
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
 * Exact on the turn and river; flop uses a fixed, seeded set of runouts (equity.js).
 */
export function equities(hero, w, bd) {
  const h = comboIndex(hero[0], hero[1]);
  const ind = new Float64Array(N);
  ind[h] = 1;
  const vs = equityVsRange(ind, bd); // each villain combo's equity against our hand
  const eq = new Float64Array(N).fill(NaN);
  let num = 0, den = 0;
  for (let i = 0; i < N; i++) {
    if (!(w[i] > 0) || Number.isNaN(vs[i])) continue;
    eq[i] = 1 - vs[i];
    num += w[i] * eq[i];
    den += w[i];
  }
  return { perCombo: eq, overall: den ? num / den : 0 };
}

export { pot, replay };
