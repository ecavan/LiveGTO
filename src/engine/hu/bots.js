/**
 * Bots for Play and Simulate: a solid baseline ("Reg") bent by the same villain profiles the
 * solver uses for puzzles (solver/profiles/*.toml → profiles.json), with the same rule semantics
 * as ps-solve::profile (frequency scaling, `set` targets, facing sizes, hand classes).
 *
 * Every decision is a known probability distribution over actions. That matters: the range
 * tracker (range.js) uses the very same functions to work out what the bot can have.
 */
import PROFILES from './profiles.json';
import { PREFLOP_RANK } from './preflopRank.js';
import { classify, handType } from './hand.js';
import { menu, legal, board, pot, BTN, BB } from './game.js';

export const BOT_TYPES = {
  reg: { name: 'Reg', profile: 'gto', desc: 'A solid regular: sensible ranges, balanced-ish betting, folds when beat.' },
  station: { name: 'Station', profile: 'station' },
  nit: { name: 'Nit', profile: 'nit' },
  maniac: { name: 'Maniac', profile: 'maniac' },
  whale: { name: 'Whale', profile: 'whale' },
  tag: { name: 'TAG', profile: 'tag', modelOnly: true },
};
for (const [k, b] of Object.entries(BOT_TYPES)) {
  if (!b.desc) b.desc = PROFILES[b.profile].description.replace(/\s+/g, ' ').trim();
  b.notes = (PROFILES[b.profile].rules || []).map(r => r.note).filter(Boolean);
  b.id = k;
}

// ------------------------------------------------------------------ preflop

/** Share of all combos at or above each hand (0 = best). */
const PCT = Object.fromEntries(PREFLOP_RANK.map(([h, , cum]) => [h, cum]));

/**
 * Preflop by "level" = raises faced so far from the bot's seat:
 * 0 BTN first in · 1 BB vs open (or limp) · 2 BTN vs 3-bet/iso · 3 BB vs 4-bet · 4 vs 5-bet.
 * raise[k] / cont[k]: top share of hands that raise / continue (cumulative).
 */
const PRE = {
  reg: { raise: [0.42, 0.1, 0.04, 0.025, 0.02], cont: [0.42, 0.55, 0.26, 0.065, 0.04], open: 2.5, noise: 0 },
  nit: { raise: [0.18, 0.03, 0.02, 0.02, 0.015], cont: [0.18, 0.22, 0.09, 0.03, 0.025], open: 2.5, noise: 0 },
  station: { raise: [0.06, 0.02, 0.015, 0.015, 0.015], cont: [0.5, 0.72, 0.45, 0.12, 0.08], open: 3.5, noise: 0 },
  maniac: { raise: [0.75, 0.3, 0.15, 0.1, 0.06], cont: [0.75, 0.7, 0.5, 0.2, 0.12], open: 3.5, noise: 0.05 },
  whale: { raise: [0.1, 0.05, 0.03, 0.025, 0.02], cont: [0.6, 0.78, 0.6, 0.25, 0.15], open: 3.5, noise: 0.08 },
  tag: { raise: [0.4, 0.12, 0.05, 0.03, 0.02], cont: [0.4, 0.45, 0.2, 0.06, 0.04], open: 2.5, noise: 0 },
};

export function preflopLevel(s, seat) {
  const raises = s.log.filter(e => e.street === 0 && (e.type === 'raise' || e.type === 'allin')).length;
  return seat === BTN ? (raises === 0 ? 0 : 2 * Math.ceil(raises / 2)) : 1 + 2 * Math.floor(raises / 2);
}

/** P(raise), P(continue passively), P(fold) for a hand at this preflop node. */
export function preflopProbs(botId, s, seat, key) {
  const P = PRE[botId];
  let lvl = Math.min(4, preflopLevel(s, seat));
  // size matters: a big bet is answered like a 4-bet (even a station doesn't call 100bb with 72%)
  const owe = s.streetBet[1 - seat] - s.streetBet[seat];
  if (owe >= 25) lvl = Math.max(lvl, seat === BTN ? 4 : 3);
  const p = PCT[key];
  const shrink = owe >= 10 && owe < 25 && lvl <= 2 ? 0.6 : 1; // a 10bb+ open or 3-bet: tighter
  let raise = p <= P.raise[lvl] * shrink ? 1 : 0;
  let cont = !raise && p <= P.cont[lvl] * shrink ? 1 : 0;
  if (P.noise) {
    // recreational randomness: a slice of any hand limps/calls or raises
    raise = raise + (1 - raise) * P.noise * 0.4;
    cont = cont + (1 - raise - cont) * P.noise;
  }
  return { raise, cont, fold: Math.max(0, 1 - raise - cont) };
}

function preflopDist(botId, s, seat) {
  return preflopDistKey(botId, s, seat, handType(s.holes[seat]));
}

/** Preflop action distribution for hand type `key` ("AKs") at node `s`, as menu options with keys. */
export function preflopDistKey(botId, s, seat, key) {
  const { raise, cont, fold } = preflopProbs(botId, s, seat, key);
  const m = menu(s);
  const L = legal(s);
  const out = [];
  const raiseOpts = m.filter(x => x.type === 'raise' || x.type === 'allin');
  if (raiseOpts.length && raise > 0) {
    const lvl = preflopLevel(s, seat);
    let pick;
    if (lvl >= 3) pick = raiseOpts.find(x => x.type === 'allin');
    else if (lvl === 0) pick = raiseOpts.reduce((a, b) => (Math.abs(b.to - PRE[botId].open) < Math.abs(a.to - PRE[botId].open) ? b : a));
    else pick = raiseOpts.find(x => x.type === 'raise') || raiseOpts[0];
    out.push({ ...pick, key: 'raise', p: raise });
  }
  const passive = m.find(x => x.type === (L.facing ? 'call' : 'check'));
  const foldOpt = m.find(x => x.type === 'fold');
  const leftover = raiseOpts.length ? 0 : raise;
  if (passive) out.push({ ...passive, key: 'call', p: cont + leftover + (foldOpt ? 0 : fold) });
  if (foldOpt) out.push({ ...foldOpt, key: 'fold', p: fold });
  return normalise(out);
}

// ------------------------------------------------------------------ postflop

const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** Baseline "Reg" frequencies by hand class. Not facing a bet: check / small / big / allin. */
export const BASE_OPEN = {
  monster: { check: 0.25, small: 0.25, big: 0.45, allin: 0.05 },
  strong: { check: 0.35, small: 0.35, big: 0.28, allin: 0.02 },
  medium: { check: 0.65, small: 0.3, big: 0.05, allin: 0 },
  weak: { check: 0.85, small: 0.12, big: 0.03, allin: 0 },
  draw: { check: 0.5, small: 0.2, big: 0.3, allin: 0 },
  air: { check: 0.72, small: 0.13, big: 0.15, allin: 0 },
};
/** Facing a bet, by size faced: fold / call / raise / allin. */
export const BASE_FACING = {
  // defends roughly the minimum-defence frequency: ~75% vs a third-pot bet, ~57% vs 75% pot
  small: {
    monster: { fold: 0, call: 0.6, raise: 0.3, allin: 0.1 },
    strong: { fold: 0.02, call: 0.83, raise: 0.15, allin: 0 },
    medium: { fold: 0.12, call: 0.85, raise: 0.03, allin: 0 },
    weak: { fold: 0.4, call: 0.6, raise: 0, allin: 0 },
    draw: { fold: 0.15, call: 0.7, raise: 0.15, allin: 0 },
    air: { fold: 0.7, call: 0.15, raise: 0.15, allin: 0 },
  },
  large: {
    monster: { fold: 0, call: 0.65, raise: 0.25, allin: 0.1 },
    strong: { fold: 0.06, call: 0.84, raise: 0.1, allin: 0 },
    medium: { fold: 0.3, call: 0.7, raise: 0, allin: 0 },
    weak: { fold: 0.6, call: 0.4, raise: 0, allin: 0 },
    draw: { fold: 0.35, call: 0.55, raise: 0.1, allin: 0 },
    air: { fold: 0.85, call: 0.05, raise: 0.1, allin: 0 },
  },
  overbet: {
    monster: { fold: 0, call: 0.75, raise: 0, allin: 0.25 },
    strong: { fold: 0.2, call: 0.75, raise: 0, allin: 0.05 },
    medium: { fold: 0.6, call: 0.4, raise: 0, allin: 0 },
    weak: { fold: 0.85, call: 0.15, raise: 0, allin: 0 },
    draw: { fold: 0.6, call: 0.4, raise: 0, allin: 0 },
    air: { fold: 0.95, call: 0, raise: 0, allin: 0.05 },
  },
};

export const sizeBucket = (f) => (f < 0.5 ? 'small' : f <= 1.05 ? 'large' : 'overbet');

function keysOf(k, facing) {
  if (!facing) {
    return {
      check: ['check', 'passive'],
      small: ['bet', 'bet_small', 'aggressive'],
      big: ['bet', 'bet_large', 'aggressive'],
      allin: ['allin', 'bet', 'bet_large', 'aggressive'],
    }[k];
  }
  return { fold: ['fold'], call: ['call', 'passive'], raise: ['raise', 'aggressive'], allin: ['allin', 'raise', 'aggressive'] }[k];
}

/** The profile's version of a hand's baseline mix: same maths as ps-solve::profile::apply_hand. */
export function applyProfile(profileId, dist, ctx) {
  const rules = PROFILES[profileId]?.rules || [];
  const keys = Object.keys(dist);
  const p = keys.map(k => dist[k]);
  const tags = keys.map(k => keysOf(k, ctx.facing));
  for (const r of rules) {
    if (r.streets && !r.streets.includes(ctx.street)) continue;
    if ((r.facing === 'none' && ctx.facing) || (r.facing === 'bet' && !ctx.facing)) continue;
    if (r.facing_size && (!ctx.facing || !r.facing_size.includes(sizeBucket(ctx.fraction)))) continue;
    if (r.hands && !r.hands.includes(ctx.cls)) continue;
    if (r.hand_types && !r.hand_types.includes(ctx.handType)) continue;
    for (const [key, m] of Object.entries(r.scale || {})) {
      const inS = tags.map(t => t.includes(key));
      if (!inS.some(Boolean) || inS.every(Boolean)) continue;
      const cur = p.reduce((a, x, i) => a + (inS[i] ? x : 0), 0);
      if (cur <= 0) continue;
      const nw = Math.min(1, cur * m);
      const rest = 1 - cur;
      const nOut = inS.filter(x => !x).length;
      for (let i = 0; i < p.length; i++) {
        if (inS[i]) p[i] = (p[i] * nw) / cur;
        else p[i] = rest > 1e-12 ? (p[i] * (1 - nw)) / rest : (1 - nw) / nOut;
      }
    }
    if (r.set && Object.keys(r.set).length) {
      const target = new Array(p.length).fill(0);
      for (const [key, mass] of Object.entries(r.set)) {
        const idx = tags.map((t, i) => (t.includes(key) ? i : -1)).filter(i => i >= 0);
        if (!idx.length) continue;
        const tot = idx.reduce((a, i) => a + p[i], 0);
        for (const i of idx) target[i] += mass * (tot > 0 ? p[i] / tot : 1 / idx.length);
      }
      const t = target.reduce((a, b) => a + b, 0);
      if (t > 0) for (let i = 0; i < p.length; i++) p[i] = target[i] / t; // intensity 1
    }
  }
  return Object.fromEntries(keys.map((k, i) => [k, p[i]]));
}

/** Abstract mix for a hand class at a postflop node (before mapping to the engine's menu). */
export function postflopMix(profileId, s, seat, cls, hType) {
  const L = legal(s);
  const street = STREETS[s.street];
  const c = street === 'river' && cls === 'draw' ? 'air' : cls;
  let base;
  let fraction = 0;
  if (L.facing) {
    const owe = L.callAmount;
    // a bet bigger than his stack: only what he can call counts (the rest goes back)
    const excess = Math.max(0, s.streetBet[1 - s.toAct] - s.streetBet[s.toAct] - owe);
    fraction = owe / Math.max(0.01, pot(s) - owe - excess);
    base = { ...BASE_FACING[sizeBucket(fraction)][c] };
  } else {
    base = { ...BASE_OPEN[c] };
  }
  return applyProfile(profileId, base, { street, facing: L.facing, fraction, cls: c, handType: hType });
}

/** Map an abstract mix onto the concrete menu (missing sizes fall through to the nearest one). */
export function toMenu(mix, s) {
  const m = menu(s);
  const L = legal(s);
  const find = (t) => m.filter(x => x.type === t);
  const out = [];
  if (L.facing) {
    const fold = find('fold')[0], call = find('call')[0], raise = find('raise')[0], allin = find('allin')[0];
    let pr = mix.raise, pa = mix.allin, pc = mix.call;
    if (!raise) { pa += pr; pr = 0; }
    if (!allin) { pc += pa; pa = 0; }
    if (fold) out.push({ ...fold, key: 'fold', p: mix.fold });
    if (call) out.push({ ...call, key: 'call', p: pc });
    if (raise) out.push({ ...raise, key: 'raise', p: pr });
    if (allin) out.push({ ...allin, key: 'allin', p: pa });
  } else {
    const check = find('check')[0], bets = find('bet'), allin = find('allin')[0];
    let ps = mix.small, pb = mix.big, pa = mix.allin;
    const small = bets[0], big = bets[1];
    if (!big) { pa += pb; pb = 0; }
    if (!small) { (big ? (pb += ps) : (pa += ps)); ps = 0; }
    if (!allin) { ps += pa; pa = 0; }
    if (check) out.push({ ...check, key: 'check', p: mix.check });
    if (small) out.push({ ...small, key: 'small', p: ps });
    if (big) out.push({ ...big, key: 'big', p: pb });
    if (allin) out.push({ ...allin, key: 'allin', p: pa });
  }
  return normalise(out);
}

function normalise(opts) {
  const t = opts.reduce((a, o) => a + Math.max(0, o.p), 0);
  return opts.filter(o => o.p > 1e-9).map(o => ({ ...o, p: o.p / t }));
}

/** The bot's full action distribution at the current node for its real hand. */
export function policy(botId, s, seat = s.toAct) {
  if (s.street === 0) return preflopDist(botId, s, seat);
  const cls = classify(s.holes[seat], board(s));
  return toMenu(postflopMix(BOT_TYPES[botId].profile, s, seat, cls, handType(s.holes[seat])), s);
}

export function chooseAction(botId, s, rand = Math.random) {
  const dist = policy(botId, s);
  let x = rand();
  for (const o of dist) {
    x -= o.p;
    if (x <= 0) return o;
  }
  return dist[dist.length - 1];
}

/**
 * Likelihood of the bot having taken abstract action `key` with a hand of class `cls` / type
 * `hType` at node `s` (the state *before* its action). Used by the range tracker.
 */
export function likelihood(botId, s, seat, key, cls, hType) {
  if (s.street === 0) {
    const pr = preflopProbs(botId, s, seat, hType);
    return key === 'raise' || key === 'allin' ? pr.raise : key === 'fold' ? pr.fold : pr.cont;
  }
  const mix = postflopMix(BOT_TYPES[botId].profile, s, seat, cls, hType);
  const merged = toMenu(mix, s);
  return merged.find(o => o.key === key)?.p ?? 0;
}
