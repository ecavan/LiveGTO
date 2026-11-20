/**
 * The next card, worked out: after your best play here (and his call or check), the coach's play
 * with your exact hand on every card that can come. Each card is a fresh coach() call on the real
 * next-street state (the pot as it will be, his range narrowed by what he just did), so it knows
 * the price and the board, where the bucket table only knows the kind of hand.
 *
 * Returns the same shape the solver library carries on a puzzle:
 *   { via: 'call'|'check'|null, vb: null, first: 'hero'|'villain', src: 'coach',
 *     acts: [[label, cards ("AhKd…" or "*" for the largest group), 1, count]] }
 * or null when there is no next card to plan for (river, a fold, an all-in, a hand that ends).
 * `nextPlayHU` is the whole job at once (generation); `nextPlayJob` yields between cards so a
 * page stays responsive (about 0.1 s a card).
 */
import { act, board } from './game.js';
import { coach } from './coach.js';
import { cardStr } from './hand.js';

const short = (o) => {
  if (o.type === 'check' || o.type === 'fold' || o.type === 'call') return o.type[0].toUpperCase() + o.type.slice(1);
  if (o.type === 'allin') return 'All-in';
  const pct = /\((\d+)%\)/.exec(o.label || '');
  return `${o.type === 'raise' ? 'Raise' : 'Bet'}${pct ? ` ${pct[1]}%` : ''}`;
};

/** The state on the next street after `option` (and his call / check back), with how we got there. */
function advance(s, hero, option) {
  if (!option || s.street < 1 || s.street >= 3 || option.type === 'fold' || option.type === 'allin') return null;
  let t, via = null;
  try {
    t = act(s, option.type === 'check' || option.type === 'call' ? { type: option.type } : { type: option.type, to: option.to });
    if (!t.done && t.street === s.street) { // he still has to answer on this street
      via = option.type === 'check' ? 'check' : 'call';
      t = act(t, { type: via });
    }
  } catch { return null; }
  if (t.done || t.street !== s.street + 1) return null;
  return { t, via };
}

function* cards(s, hero, option, agent, level) {
  const adv = advance(s, hero, option);
  if (!adv) return null;
  const { t, via } = adv;
  const idx = t.street + 1; // runout index of the card just dealt: the turn is 3, the river 4
  const used = new Set([...t.holes[hero], ...board(s)]);
  const first = t.toAct === hero ? 'hero' : 'villain';
  const groups = new Map();
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const u = structuredClone(t);
    const at = u.runout.indexOf(c);
    if (at >= 0 && at !== idx) u.runout[at] = u.runout[idx]; // keep the runout a set of distinct cards
    u.runout[idx] = c;
    // you don't know his cards, so every unseen card is a card that can come: when this one is in
    // his hand, give him another (the coach prices his range, not his hand)
    const hi = u.holes[1 - hero].indexOf(c);
    if (hi >= 0) { let x = 0; while (x === c || u.runout.includes(x) || u.holes[0].includes(x) || u.holes[1].includes(x)) x++; u.holes[1 - hero][hi] = x; }
    let v = u;
    try { if (first === 'villain') v = act(u, { type: 'check' }); } catch { continue; }
    if (v.done || v.toAct !== hero) continue;
    let k;
    try { k = coach(v, hero, agent, { level }); } catch { continue; }
    const label = short(k.options[k.best]);
    const g = groups.get(label) || []; g.push(c); groups.set(label, g);
    yield null;
  }
  const list = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!list.length) return null;
  return {
    via, vb: null, first, src: 'coach',
    acts: list.map(([label, cs], i) => [label, i === 0 && list.length > 1 ? '*' : cs.map(cardStr).join(''), 1, cs.length]),
  };
}

export function nextPlayHU(s, hero, option, agent, level = 1) {
  const it = cards(s, hero, option, agent, level);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** The same, a few cards at a time: resolves with the result. `alive()` false abandons it. */
export function nextPlayJob(s, hero, option, agent, level = 1, alive = () => true) {
  const it = cards(s, hero, option, agent, level);
  return new Promise((resolve) => {
    const step = () => {
      if (!alive()) return resolve(null);
      const until = performance.now() + 40;
      for (;;) { const r = it.next(); if (r.done) return resolve(r.value); if (performance.now() > until) break; }
      setTimeout(step, 0);
    };
    step();
  });
}
