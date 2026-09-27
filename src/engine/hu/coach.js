/**
 * The coach: for the hero's decision, what is each option worth against *this* bot?
 *
 * EV is measured from now: chips you get back from the pot minus chips you still put in
 * (folding = 0). Against the bot's exact range (range.js):
 *   call      Σ w·[eq·(P + C)] − C
 *   bet A     Σ w·[pf·P + pc·(eq·(P + A + A′) − A)]      (pf/pc: the bot's fold/continue mix)
 *   check     IP, street over: Σ w·eq·P;  OOP: the bot's betting mix, then your best reply
 * P = pot now, C = to call, A′ = what the bot adds to call. Equity after this street is treated
 * as realised (so flop/turn numbers are one-street-ahead estimates; river is exact vs the bot,
 * except that a bot raise is treated as a call).
 * Preflop uses the Reg chart plus the steal maths against this bot's folding range.
 */
import { ALL_COMBOS, classify, handType, CLASSES } from './hand.js';
import { menu, legal, act, board, pot, BTN, BB } from './game.js';
import { villainRange, equities, rangeByClass, replay } from './range.js';
import { preflopProbs, BOT_TYPES } from './bots.js';
import { likelihood } from './bots.js';
import { PREFLOP_RANK } from './preflopRank.js';
import { alpha, requiredEquity } from '../potmath.js';

const round2 = (x) => Math.round(x * 100) / 100;

function sumW(w) {
  let t = 0;
  for (let i = 0; i < w.length; i++) t += w[i];
  return t;
}

/** Bot's response mix at node `s2` (bot to act) for each combo: {key: Float64Array}. */
function responses(botId, s2, seat, w, keys, clsOf, types) {
  const out = Object.fromEntries(keys.map(k => [k, new Float64Array(w.length)]));
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0) continue;
    for (const k of keys) out[k][i] = likelihood(botId, s2, seat, k, clsOf(i), types[i]);
  }
  return out;
}

export function coach(s, hero, botId, rand = Math.random) {
  if (s.street === 0) return preflopCoach(s, hero, botId);
  const villain = 1 - hero;
  const bd = board(s);
  const w = villainRange(s, villain, botId);
  const W = sumW(w);
  const { perCombo: eq, overall } = equities(s.holes[hero], w, bd, rand);
  const types = ALL_COMBOS.map(handType);
  const clsCache = new Map();
  const clsOf = (i) => {
    if (!clsCache.has(i)) clsCache.set(i, classify(ALL_COMBOS[i], bd));
    return clsCache.get(i);
  };
  const P = pot(s);
  const L = legal(s);
  const e = (i) => (Number.isNaN(eq[i]) ? 0 : eq[i]);

  const options = menu(s).map(m => {
    let ev = 0;
    if (m.type === 'fold') ev = 0;
    else if (m.type === 'call') {
      const C = L.callAmount;
      for (let i = 0; i < w.length; i++) if (w[i] > 0) ev += w[i] * (e(i) * (P + C) - C);
      ev /= W;
    } else if (m.type === 'check') {
      const s2 = act(s, m);
      if (s2.done || s2.street !== s.street) {
        for (let i = 0; i < w.length; i++) if (w[i] > 0) ev += w[i] * e(i) * P;
        ev /= W;
      } else {
        // OOP check: the bot checks back or bets; we then call or fold, whichever is better vs his betting range
        const betOpts = menu(s2).filter(x => x.type !== 'check');
        const keys = ['check', 'small', 'big', 'allin'];
        const r = responses(botId, s2, villain, w, keys, clsOf, types);
        for (let i = 0; i < w.length; i++) if (w[i] > 0) ev += w[i] * r.check[i] * e(i) * P;
        const sizes = { small: betOpts.find(x => x.type === 'bet'), big: betOpts.filter(x => x.type === 'bet')[1], allin: betOpts.find(x => x.type === 'allin') };
        for (const k of ['small', 'big', 'allin']) {
          const opt = sizes[k];
          if (!opt) continue;
          const b = opt.to;
          let callEv = 0;
          for (let i = 0; i < w.length; i++) if (w[i] > 0 && r[k][i] > 0) callEv += w[i] * r[k][i] * (e(i) * (P + 2 * b) - b);
          ev += Math.max(0, callEv); // fold gets 0
        }
        ev /= W;
      }
    } else {
      // bet / raise / all-in
      const A = round2(m.to - s.streetBet[hero]);
      const s2 = act(s, m);
      if (s2.done) {
        for (let i = 0; i < w.length; i++) if (w[i] > 0) ev += w[i] * (e(i) * (P + A) - A);
        ev /= W;
      } else {
        const add = round2(s2.streetBet[hero] - s2.streetBet[villain]);
        const r = responses(botId, s2, villain, w, ['fold', 'call', 'raise', 'allin'], clsOf, types);
        for (let i = 0; i < w.length; i++) {
          if (w[i] <= 0) continue;
          const pf = r.fold[i];
          const pc = 1 - pf; // call, or raise treated as a call
          ev += w[i] * (pf * P + pc * (e(i) * (P + A + add) - A));
        }
        ev /= W;
      }
    }
    return { ...m, ev: round2(ev) };
  });

  const best = options.reduce((a, b, i) => (b.ev > options[a].ev ? i : a), 0);
  const tol = Math.max(0.1, 0.02 * P);
  const fine = options.map((o, i) => (options[best].ev - o.ev <= tol ? i : -1)).filter(i => i >= 0);
  return {
    street: s.street,
    exact: s.street === 3,
    equity: overall,
    need: L.facing ? requiredEquity(P, L.callAmount) : null,
    range: rangeByClass(w, bd),
    combos: Math.round(W * 10) / 10,
    options,
    best,
    fine,
    tol,
  };
}

// ------------------------------------------------------------------ preflop

const PCT = Object.fromEntries(PREFLOP_RANK.map(([h, , cum]) => [h, cum]));
const COMBOS = (k) => (k.length === 2 ? 6 : k.endsWith('s') ? 4 : 12);

/**
 * Share of the bot's *current* range that folds to a raise at node `s2`. Each combo is weighted
 * by how likely the bot was to take its earlier preflop actions with it (a limper's range, not
 * all hands), and combos holding the hero's cards are removed.
 */
function botFoldShare(botId, s2, seat, heroHole) {
  const prior = replay(s2).filter(({ before, entry }) => entry.seat === seat && before.street === 0);
  const dead = new Set(heroHole);
  const cache = new Map();
  let fold = 0, tot = 0;
  for (const combo of ALL_COMBOS) {
    if (dead.has(combo[0]) || dead.has(combo[1])) continue;
    const key = handType(combo);
    if (!cache.has(key)) {
      let w = 1;
      for (const { before, entry } of prior) {
        const k = entry.type === 'raise' || entry.type === 'allin' ? 'raise' : entry.type === 'fold' ? 'fold' : 'call';
        w *= likelihood(botId, before, seat, k, null, key);
      }
      cache.set(key, [w, w ? preflopProbs(botId, s2, seat, key).fold : 0]);
    }
    const [w, f] = cache.get(key);
    fold += w * f;
    tot += w;
  }
  return tot > 1e-9 ? fold / tot : null; // null: he never takes this line
}

function preflopCoach(s, hero, botId) {
  const key = handType(s.holes[hero]);
  const reg = preflopProbs('reg', s, hero, key);
  const m = menu(s);
  const L = legal(s);
  const passive = L.facing ? 'call' : 'check';
  const kind = (o) => (o.type === 'raise' || o.type === 'allin' ? 'raise' : o.type === 'fold' ? 'fold' : passive);
  // the chart never folds when checking is free
  const chart = reg.raise >= 0.5 ? 'raise' : reg.fold >= 0.5 && L.facing ? 'fold' : passive;
  const notes = [];
  const fine = new Set(m.map((o, i) => (kind(o) === chart ? i : -1)).filter(i => i >= 0));
  // steal maths: does this bot fold often enough that any raise profits?
  const raiseOpt = m.find(o => o.type === 'raise');
  if (raiseOpt) {
    const s2 = act(s, raiseOpt);
    if (!s2.done) {
      const f = botFoldShare(botId, s2, 1 - hero, s.holes[hero]);
      if (f != null) {
        const risk = round2(raiseOpt.to - s.streetBet[hero]);
        const need = alpha(pot(s), risk);
        const whose = s.log.some(e => e.seat === 1 - hero) ? 'of the range he has shown' : 'of his hands';
        notes.push(`${BOT_TYPES[botId].name} folds ${Math.round(100 * f)}% ${whose} to a raise to ${raiseOpt.to}bb; a pure bluff needs ${Math.round(100 * need)}%.`);
        if (f > need + 0.05 && chart !== 'raise') {
          m.forEach((o, i) => { if (o === raiseOpt) fine.add(i); });
          notes.push('So raising any two cards profits here: the exploit.');
        }
      }
    }
  }
  notes.push(`${key} is in the top ${Math.round(100 * PCT[key])}% of hands.`);
  const best = m.findIndex(o => kind(o) === chart && (o.type !== 'allin' || chart !== 'raise' || !m.some(x => x.type === 'raise')));
  return {
    street: 0,
    preflop: true,
    chart,
    options: m.map(o => ({ ...o, ev: null })),
    best: best >= 0 ? best : 0,
    fine: [...fine],
    notes,
    facing: L.facing,
  };
}

export { CLASSES };
