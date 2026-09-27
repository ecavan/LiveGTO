/**
 * Vectorised policies: for a node, the probability of each menu option for *every* one of the
 * 1326 combos at once. Range tracking, the coach and the thinking bots all work on whole ranges,
 * so they need the strategy as arrays, not one hand at a time.
 *
 * An option is a menu entry plus an abstract key:
 *   facing a bet: fold / call / raise / allin      not facing: check / small / big / allin
 *   preflop: fold / call (or check) / raise (the chosen raise size; all-in counts as raise)
 */
import { ALL_COMBOS, classify, handType, CLASSES } from './hand.js';
import { menu, legal, board } from './game.js';
import { BOT_TYPES, preflopDistKey, postflopMix, toMenu } from './bots.js';
import { N } from './equity.js';

// hand type of every combo, and the 169 distinct types
export const HT = ALL_COMBOS.map(handType);
const HT_KEYS = [...new Set(HT)];
const HT_ID = Int16Array.from(HT, k => HT_KEYS.indexOf(k));

const clsCache = new Map();
/** Class index (into CLASSES) of every combo on `bd`; −1 if the combo uses a board card. */
export function classesOn(bd) {
  const key = bd.join(',');
  if (clsCache.has(key)) return clsCache.get(key);
  const dead = new Set(bd);
  const out = new Int8Array(N);
  ALL_COMBOS.forEach((c, i) => {
    out[i] = dead.has(c[0]) || dead.has(c[1]) ? -1 : CLASSES.indexOf(classify(c, bd));
  });
  clsCache.set(key, out);
  if (clsCache.size > 16) clsCache.delete(clsCache.keys().next().value);
  return out;
}

/** The menu at `s` with abstract keys (see top). */
export function keyedMenu(s) {
  const m = menu(s);
  const L = legal(s);
  if (s.street === 0) {
    return m.map(o => ({ ...o, key: o.type === 'raise' || o.type === 'allin' ? 'raise' : o.type === 'fold' ? 'fold' : 'call' }));
  }
  const bets = m.filter(o => o.type === 'bet');
  return m.map(o => {
    let key = o.type;
    if (o.type === 'bet') key = bets.indexOf(o) === 0 ? 'small' : 'big';
    if (!L.facing && o.type === 'check') key = 'check';
    return { ...o, key };
  });
}

/** Index of the option matching a logged/taken action (by type and amount). */
export function matchOption(opts, action) {
  const t = action.type;
  let i = opts.findIndex(o => o.type === t && (o.to == null || action.to == null || Math.abs(o.to - action.to) < 0.011));
  if (i < 0 && (t === 'bet' || t === 'raise' || t === 'allin')) {
    // nearest aggressive option
    let best = -1, d = Infinity;
    opts.forEach((o, k) => {
      if (o.type === 'bet' || o.type === 'raise' || o.type === 'allin') {
        const dd = Math.abs((o.to ?? 0) - (action.to ?? 0));
        if (dd < d) { d = dd; best = k; }
      }
    });
    i = best;
  }
  return i;
}

/** Collect per-hand distributions (arrays of {type,to,key,p}) into { opts, P }. */
function assemble(distOfCombo) {
  const opts = [];
  const P = [];
  const slot = (o) => {
    let k = opts.findIndex(x => x.type === o.type && (x.to ?? -1) === (o.to ?? -1));
    if (k < 0) {
      k = opts.length;
      opts.push({ type: o.type, to: o.to, label: o.label, key: o.key });
      P.push(new Float64Array(N));
    }
    return k;
  };
  for (let i = 0; i < N; i++) {
    const d = distOfCombo(i);
    if (!d) continue;
    for (const o of d) if (o.p > 0) P[slot(o)][i] += o.p;
  }
  return { opts, P };
}

/** A profile bot's (or hero model type's) policy for every combo at node `s` (seat to act). */
export function profilePolicyAll(botId, s, seat = s.toAct) {
  if (s.street === 0) {
    const byKey = HT_KEYS.map(k => preflopDistKey(botId, s, seat, k));
    return assemble(i => byKey[HT_ID[i]]);
  }
  const bd = board(s);
  const cls = classesOn(bd);
  const profile = BOT_TYPES[botId].profile;
  const byCls = CLASSES.map(c => toMenu(postflopMix(profile, s, seat, c, null), s));
  return assemble(i => (cls[i] < 0 ? null : byCls[cls[i]]));
}

/** "Anything goes": uniform over the keyed menu (one option per key), for every combo. */
export function randomPolicyAll(s) {
  const opts = [];
  const seen = new Set();
  for (const o of keyedMenu(s)) {
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    opts.push(o);
  }
  const blocked = s.street === 0 ? null : classesOn(board(s));
  const P = opts.map(() => {
    const a = new Float64Array(N);
    for (let i = 0; i < N; i++) a[i] = blocked && blocked[i] < 0 ? 0 : 1 / opts.length;
    return a;
  });
  return { opts, P };
}

/** Probability array (per combo) of taking `action` under a vectorised policy. */
export function probOf(pol, action) {
  const i = matchOption(pol.opts, action);
  return i < 0 ? new Float64Array(N) : pol.P[i];
}

/** Public signature of a node (board, stacks, action history): policies depend on nothing else. */
export function stateKey(s) {
  return s.start.join(',') + '|' + board(s).join(',') + '|' + s.log.map(e => `${e.seat}${e.type}${e.to ?? ''}`).join(';');
}
