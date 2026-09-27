/**
 * No-limit hold'em for 2–6 players: blinds 0.5/1, button rotation, side pots.
 *
 * Rules: action goes clockwise; preflop UTG first and the BB has the option; postflop the first
 * active player after the button. A raise must be at least the last full raise; an all-in for
 * less than that does not reopen the betting for players who have already acted. Side pots are
 * built from what each player put in, so uncalled chips simply come back to their owner.
 * Heads-up (2 players) the button posts the small blind and acts first preflop.
 */
import { evaluate } from '../hu/hand.js';

const EPS = 1e-9;
export const round2 = (x) => Math.round(x * 100) / 100;

/** Position names by distance from the button, for n players. */
export function positions(n) {
  const names = { 2: ['BTN', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'CO'], 5: ['BTN', 'SB', 'BB', 'HJ', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] };
  return names[n];
}

function shuffled(rand) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/**
 * New hand. `n` players, button at seat `btn`, `stacks` (default 100bb each).
 * `holes`/`board` fix cards (tests).
 */
export function newHand({ n = 6, btn = 0, stacks = null, rand = Math.random, holes = null, board = null } = {}) {
  const deck = shuffled(rand);
  const used = new Set([...(holes ? holes.flat() : []), ...(board || [])]);
  const rest = deck.filter(c => !used.has(c));
  const h = holes || Array.from({ length: n }, () => [rest.pop(), rest.pop()]);
  const runout = board ? [...board] : [];
  while (runout.length < 5) runout.push(rest.pop());
  const st = stacks ? [...stacks] : new Array(n).fill(100);
  const s = {
    n, btn,
    start: [...st],
    stacks: [...st],
    streetBet: new Array(n).fill(0),
    invested: new Array(n).fill(0),
    folded: new Array(n).fill(false),
    holes: h,
    runout,
    street: 0,
    toAct: -1,
    lastRaise: 1,
    needs: new Array(n).fill(true), // must still act this round
    canRaise: new Array(n).fill(true), // may raise when next to act
    log: [],
    done: false,
    result: null,
  };
  const sb = n === 2 ? btn : (btn + 1) % n;
  const bb = n === 2 ? (btn + 1) % n : (btn + 2) % n;
  post(s, sb, 0.5);
  post(s, bb, 1);
  s.sb = sb;
  s.bb = bb;
  s.toAct = n === 2 ? btn : (bb + 1) % n;
  skipToActor(s);
  return s;
}

function post(s, seat, amt) {
  const a = Math.min(amt, s.stacks[seat]);
  s.stacks[seat] = round2(s.stacks[seat] - a);
  s.streetBet[seat] = round2(s.streetBet[seat] + a);
  s.invested[seat] = round2(s.invested[seat] + a);
}

export const board = (s) => s.runout.slice(0, [0, 3, 4, 5][s.street]);
export const pot = (s) => round2(s.invested.reduce((a, b) => a + b, 0));
export const live = (s) => s.holes.map((_, i) => i).filter(i => !s.folded[i]);
const canAct = (s, i) => !s.folded[i] && s.stacks[i] > EPS;
const maxBet = (s) => Math.max(...s.streetBet);
export const toCall = (s, seat = s.toAct) => round2(Math.max(0, maxBet(s) - s.streetBet[seat]));
/** Position name of a seat. */
export const posOf = (s, seat) => positions(s.n)[(seat - s.btn + s.n) % s.n];

export function legal(s) {
  if (s.done) return null;
  const me = s.toAct;
  const owe = toCall(s, me);
  const maxTo = round2(s.streetBet[me] + s.stacks[me]);
  const cur = maxBet(s);
  const others = live(s).filter(i => i !== me && s.stacks[i] > EPS);
  const minTo = round2(Math.min(maxTo, cur + Math.max(s.lastRaise, 1)));
  const canRaise = s.canRaise[me] && others.length > 0 && maxTo > cur + EPS;
  return { fold: owe > EPS, check: owe <= EPS, call: owe > EPS, callAmount: round2(Math.min(owe, s.stacks[me])), canRaise, minTo, maxTo, facing: owe > EPS };
}

/** Human-sized menu: fold / check / call, bet 33% / 75%, raise, all-in. */
export function menu(s) {
  const L = legal(s);
  if (!L) return [];
  const me = s.toAct;
  const out = [];
  if (L.fold) out.push({ type: 'fold', label: 'Fold' });
  if (L.check) out.push({ type: 'check', label: 'Check' });
  if (L.call) out.push({ type: 'call', to: round2(s.streetBet[me] + L.callAmount), label: `Call ${L.callAmount}` });
  if (L.canRaise) {
    const p = pot(s);
    const cur = maxBet(s);
    const opts = [];
    if (s.street === 0) {
      const raises = s.log.filter(e => e.street === 0 && (e.type === 'raise' || e.type === 'allin')).length;
      const limpers = s.log.filter(e => e.street === 0 && e.type === 'call').length;
      if (raises === 0) opts.push(3 + limpers, 4 + limpers); // open 3bb (+1 per limper), or bigger
      else opts.push(round2(cur * 3 + (raises === 1 ? limpers + s.log.filter(e => e.street === 0 && e.type === 'call' && e.to >= cur - EPS).length : 0)));
    } else if (!L.facing) {
      opts.push(round2(s.streetBet[me] + p / 3), round2(s.streetBet[me] + 0.75 * p));
    } else {
      opts.push(round2(3 * cur + (p - cur - s.streetBet[me] > 0 ? 0 : 0)));
    }
    for (let to of opts) {
      to = round2(Math.max(to, L.minTo));
      if (to >= L.maxTo - EPS) continue;
      const isBet = s.street > 0 && !L.facing;
      const label = isBet ? `Bet ${round2(to - s.streetBet[me])} (${Math.round((100 * (to - s.streetBet[me])) / p)}%)` : `Raise to ${to}`;
      if (!out.some(o => o.to === to)) out.push({ type: isBet ? 'bet' : 'raise', to, label });
    }
    out.push({ type: 'allin', to: L.maxTo, label: `All-in ${L.maxTo}` });
  }
  return out;
}

const clone = (s) => ({
  ...s,
  start: [...s.start], stacks: [...s.stacks], streetBet: [...s.streetBet], invested: [...s.invested],
  folded: [...s.folded], needs: [...s.needs], canRaise: [...s.canRaise], log: [...s.log],
  holes: s.holes, runout: s.runout,
});

/** Apply { type, to? } for the player to act. Returns a new state. */
export function act(state, action) {
  const s = clone(state);
  const me = s.toAct;
  const L = legal(s);
  if (!L) throw new Error('hand is over');
  const entry = { seat: me, street: s.street, pot: pot(s) };
  if (action.type === 'fold') {
    s.folded[me] = true;
    s.needs[me] = false;
    s.log.push({ ...entry, type: 'fold' });
    return next(s);
  }
  if (action.type === 'check') {
    if (!L.check) throw new Error('cannot check');
    s.needs[me] = false;
    s.canRaise[me] = false;
    s.log.push({ ...entry, type: 'check' });
    return next(s);
  }
  if (action.type === 'call') {
    if (!L.call) throw new Error('nothing to call');
    post(s, me, L.callAmount);
    s.needs[me] = false;
    s.canRaise[me] = false;
    s.log.push({ ...entry, type: s.stacks[me] <= EPS ? 'allin' : 'call', amount: L.callAmount, to: s.streetBet[me], callAllIn: s.stacks[me] <= EPS });
    return next(s);
  }
  if (!L.canRaise) throw new Error('cannot raise');
  let to = action.type === 'allin' ? L.maxTo : round2(Math.min(action.to, L.maxTo));
  if (to < L.minTo - EPS && to < L.maxTo - EPS) throw new Error(`raise to ${to} below minimum ${L.minTo}`);
  const cur = maxBet(s);
  const increment = round2(to - cur);
  const full = increment >= s.lastRaise - EPS;
  post(s, me, round2(to - s.streetBet[me]));
  s.needs[me] = false;
  s.canRaise[me] = false;
  for (const i of live(s)) {
    if (i === me || !canAct(s, i)) continue;
    s.needs[i] = true;
    if (full) s.canRaise[i] = true;
  }
  if (full) s.lastRaise = Math.max(increment, 1);
  const allIn = s.stacks[me] <= EPS;
  const type = allIn ? 'allin' : cur <= EPS && s.street > 0 ? 'bet' : 'raise';
  s.log.push({ ...entry, type, to: s.streetBet[me], amount: round2(to - (state.streetBet[me])) });
  return next(s);
}

/** Move to the next player who must act, the next street, or the end of the hand. */
function next(s) {
  const alive = live(s);
  if (alive.length === 1) return settle(s, [alive[0]]);
  for (let k = 1; k <= s.n; k++) {
    const i = (s.toAct + k) % s.n;
    if (s.needs[i] && canAct(s, i)) { s.toAct = i; return s; }
  }
  // betting round over
  const actors = alive.filter(i => canAct(s, i));
  if (s.street === 3 || actors.length <= 1) {
    // run it out if nobody can bet any more
    if (s.street < 3 && actors.length <= 1) { s.street = 3; return showdown(s); }
    if (s.street === 3) return showdown(s);
  }
  s.street += 1;
  s.streetBet = new Array(s.n).fill(0);
  s.lastRaise = 1;
  s.needs = s.holes.map((_, i) => canAct(s, i));
  s.canRaise = s.needs.map(Boolean);
  s.toAct = s.btn;
  for (let k = 1; k <= s.n; k++) {
    const i = (s.btn + k) % s.n;
    if (canAct(s, i)) { s.toAct = i; break; }
  }
  return s;
}

function skipToActor(s) {
  for (let k = 0; k < s.n; k++) {
    const i = (s.toAct + k) % s.n;
    if (canAct(s, i)) { s.toAct = i; return; }
  }
}

function showdown(s) {
  s.showdown = true;
  const vals = s.holes.map((h, i) => (s.folded[i] ? -1 : evaluate([...h, ...s.runout])));
  return settle(s, null, vals);
}

/** Pay the pots. `winners` (everyone else folded) or hand values for a showdown. */
function settle(s, winners, vals = null) {
  const won = new Array(s.n).fill(0);
  const levels = [...new Set(s.invested.filter(x => x > EPS))].sort((a, b) => a - b);
  let prev = 0;
  const pots = [];
  for (const lv of levels) {
    const layer = s.invested.reduce((a, inv) => a + Math.max(0, Math.min(inv, lv) - prev), 0);
    const eligible = s.holes.map((_, i) => i).filter(i => !s.folded[i] && s.invested[i] >= lv - EPS);
    prev = lv;
    if (layer <= EPS) continue;
    let who;
    if (winners) who = eligible.length ? eligible.filter(i => winners.includes(i)) : winners;
    else {
      const best = Math.max(...eligible.map(i => vals[i]));
      who = eligible.filter(i => vals[i] === best);
    }
    if (!who.length) who = winners || eligible;
    // split in whole cents; odd cents go to the first winners
    const cents = Math.round(layer * 100);
    const each = Math.floor(cents / who.length);
    who.forEach((i, k) => { won[i] += (each + (k < cents - each * who.length ? 1 : 0)) / 100; });
    pots.push({ amount: round2(layer), winners: who });
  }
  s.stacks = s.stacks.map((x, i) => round2(x + won[i]));
  s.done = true;
  s.toAct = -1;
  s.result = {
    pots,
    net: s.stacks.map((x, i) => round2(x - s.start[i])),
    showdown: !!s.showdown,
    winners: [...new Set(pots.flatMap(p => p.winners))],
  };
  return s;
}

/** States before each logged action. */
export function replay(s) {
  let st = newHand({ n: s.n, btn: s.btn, stacks: s.start, holes: s.holes, board: s.runout });
  const steps = [];
  for (const e of s.log) {
    steps.push({ before: st, entry: e });
    const a = e.type === 'fold' || e.type === 'check' || e.type === 'call' ? { type: e.type }
      : e.type === 'allin' ? (e.callAllIn ? { type: 'call' } : { type: 'allin' }) : { type: 'raise', to: e.to };
    st = act(st, a);
  }
  return steps;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
