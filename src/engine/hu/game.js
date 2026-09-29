/**
 * Heads-up no-limit hold'em engine: BTN vs BB, the SB has folded (0.5bb dead in the pot).
 * That is the most common live spot and the same one the puzzle library solves.
 *
 * Rules implemented (and tested in test/hu.test.js):
 *  - BB posts 1bb; 0.5bb dead from the SB; BTN acts first preflop, BB first after the flop.
 *  - BB option after a limp; min-raise = the size of the last full raise (≥ 1bb).
 *  - All-in for less doesn't reopen the betting; uncalled chips go back to the bettor.
 *  - When someone is all-in and called, the board runs out.
 *  - Split pots split everything, dead money included.
 * Amounts are in bb. Seats: 0 = BTN, 1 = BB.
 */
import { evaluate } from './hand.js';

export const BTN = 0;
export const BB = 1;
export const DEAD = 0.5;
const EPS = 1e-9;

/** Seeded RNG (mulberry32) so hands are reproducible in tests. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(rand) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Deal a new hand. `stacks` = [btn, bb] effective stacks in bb (default 100 each).
 * Pass `holes`/`deck` to fix cards (tests).
 */
export function newHand({ stacks = [100, 100], rand = Math.random, holes = null, board = null } = {}) {
  const deck = shuffled(rand);
  const used = new Set([...(holes ? holes.flat() : []), ...(board || [])]);
  const rest = deck.filter(c => !used.has(c));
  const h = holes || [[rest.pop(), rest.pop()], [rest.pop(), rest.pop()]];
  const runout = board ? [...board] : [];
  while (runout.length < 5) runout.push(rest.pop());
  const bbPost = Math.min(1, stacks[BB]);
  return {
    start: [...stacks],
    stacks: [stacks[BTN], stacks[BB] - bbPost],
    streetBet: [0, bbPost],
    invested: [0, bbPost],
    dead: DEAD,
    holes: h,
    runout,
    street: 0, // 0 preflop, 1 flop, 2 turn, 3 river
    toAct: BTN,
    lastRaise: 1, // size of the last full raise (min-raise increment)
    reopened: [true, true], // may this seat raise when it next acts?
    acted: [false, false],
    folded: -1,
    done: false,
    log: [], // [{ seat, street, type, to, amount, pot }]
    result: null,
  };
}

export const board = (s) => s.runout.slice(0, [0, 3, 4, 5][s.street]);
export const pot = (s) => round2(s.dead + s.invested[0] + s.invested[1]);
export const toCall = (s, seat = s.toAct) => round2(Math.max(0, s.streetBet[1 - seat] - s.streetBet[seat]));

/**
 * What the player to act may do. Raise targets are the player's total street bet ("raise to").
 * { fold, check, call, callAmount, canRaise, minTo, maxTo }
 */
export function legal(s) {
  if (s.done) return null;
  const me = s.toAct;
  const owe = toCall(s, me);
  const maxTo = round2(s.streetBet[me] + s.stacks[me]);
  const cur = s.streetBet[1 - me];
  const opponentCanAct = s.stacks[1 - me] > EPS;
  const minTo = round2(Math.min(maxTo, cur + Math.max(s.lastRaise, 1)));
  const canRaise = s.reopened[me] && opponentCanAct && maxTo > cur + EPS;
  return {
    fold: owe > EPS,
    check: owe <= EPS,
    call: owe > EPS,
    callAmount: round2(Math.min(owe, s.stacks[me])),
    canRaise,
    minTo,
    maxTo,
    facing: owe > EPS,
  };
}

/**
 * Human-sized action menu: fold / check / call, bets of 33% and 75% pot, raise 3×, all-in.
 * Each entry: { type, to, label } where `to` is the street total after the action.
 */
export function menu(s) {
  const L = legal(s);
  if (!L) return [];
  const me = s.toAct;
  const out = [];
  if (L.fold) out.push({ type: 'fold', label: 'Fold' });
  if (L.check) out.push({ type: 'check', label: 'Check' });
  if (L.call) out.push({ type: 'call', to: round2(s.streetBet[me] + L.callAmount), label: `Call ${L.callAmount}` });
  if (L.canRaise) {
    const opts = [];
    const p = pot(s);
    if (s.street === 0) {
      // preflop: open 2.5bb / 3bb, 3-bet ≈ 3.5× in position, 4× out of position
      if (s.streetBet[1 - me] <= 1 + EPS) opts.push(2.5, 3.5);
      else opts.push(s.streetBet[1 - me] * (me === BTN ? 3 : 3.5));
    } else if (!L.facing) {
      opts.push(round2(s.streetBet[me] + p / 3), round2(s.streetBet[me] + 0.75 * p));
    } else {
      opts.push(round2(3 * s.streetBet[1 - me]));
    }
    for (let to of opts) {
      to = round2(Math.max(to, L.minTo));
      if (to >= L.maxTo * 0.85 - EPS) continue; // leaving a sliver behind: just go all-in
      const verb = L.facing || s.street === 0 ? 'Raise to' : 'Bet';
      const pctLabel = s.street > 0 && !L.facing ? ` (${Math.round((100 * (to - s.streetBet[me])) / p)}%)` : '';
      if (!out.some(o => o.to === to)) out.push({ type: L.facing || s.street === 0 ? 'raise' : 'bet', to, label: `${verb} ${to}${pctLabel}` });
    }
    out.push({ type: 'allin', to: L.maxTo, label: `All-in ${L.maxTo}` });
  }
  return out;
}

/** Apply an action { type: 'fold'|'check'|'call'|'bet'|'raise'|'allin', to? }. Returns the new state. */
export function act(state, action) {
  const s = structuredClone(state);
  if (s.done) throw new Error('hand is over');
  const me = s.toAct;
  const L = legal(s);
  const potBefore = pot(s);
  const entry = { seat: me, street: s.street, type: action.type, pot: potBefore };

  if (action.type === 'fold') {
    if (!L.fold) throw new Error('cannot fold');
    s.folded = me;
    s.log.push(entry);
    return settle(s, 1 - me);
  }
  if (action.type === 'check') {
    if (!L.check) throw new Error('cannot check');
    s.acted[me] = true;
    s.log.push(entry);
    return advance(s);
  }
  if (action.type === 'call') {
    if (!L.call) throw new Error('nothing to call');
    put(s, me, L.callAmount);
    s.acted[me] = true;
    s.log.push({ ...entry, amount: L.callAmount, to: s.streetBet[me] });
    return advance(s);
  }
  // bet / raise / all-in: a new street total `to`
  let to = action.type === 'allin' ? L.maxTo : round2(action.to);
  if (!L.canRaise) throw new Error('cannot raise');
  to = Math.min(to, L.maxTo);
  if (to < L.minTo - EPS && to < L.maxTo - EPS) throw new Error(`raise to ${to} below minimum ${L.minTo}`);
  const cur = s.streetBet[1 - me];
  const prev = s.streetBet[me];
  const increment = round2(to - cur);
  const full = increment >= s.lastRaise - EPS;
  put(s, me, round2(to - prev));
  if (full) {
    s.lastRaise = Math.max(increment, 1);
    s.reopened[1 - me] = true;
  } else {
    s.reopened[1 - me] = false; // all-in for less: opponent may only call or fold
  }
  s.reopened[me] = false;
  s.acted[me] = true;
  s.acted[1 - me] = false;
  const allIn = s.stacks[me] <= EPS;
  const type = allIn ? 'allin' : cur <= EPS && s.street > 0 ? 'bet' : 'raise';
  s.log.push({ ...entry, type, to: s.streetBet[me], amount: round2(s.streetBet[me] - prev) });
  s.toAct = 1 - me;
  return s;
}

function put(s, seat, amount) {
  const a = Math.min(amount, s.stacks[seat]);
  s.stacks[seat] = round2(s.stacks[seat] - a);
  s.streetBet[seat] = round2(s.streetBet[seat] + a);
  s.invested[seat] = round2(s.invested[seat] + a);
}

/**
 * After a check or call: the street ends once bets are matched (or the caller is all-in for less)
 * and the other player has already acted on this street. Otherwise the other player acts
 * (e.g. the BB's option after a limp, or the second check).
 */
function advance(s) {
  const me = s.toAct;
  const other = 1 - me;
  const matched = Math.abs(s.streetBet[0] - s.streetBet[1]) <= EPS;
  const shortAllIn = s.stacks[me] <= EPS && s.streetBet[me] < s.streetBet[other] - EPS;
  if (!((matched || shortAllIn) && s.acted[other])) {
    s.toAct = other;
    return s;
  }
  refundUncalled(s);
  if (s.stacks[0] <= EPS || s.stacks[1] <= EPS || s.street === 3) {
    s.street = 3;
    return showdown(s);
  }
  s.street += 1;
  s.streetBet = [0, 0];
  s.acted = [false, false];
  s.reopened = [true, true];
  s.lastRaise = 1;
  s.toAct = BB; // BB is first to act after the flop
  return s;
}

function refundUncalled(s) {
  const diff = round2(s.streetBet[0] - s.streetBet[1]);
  if (Math.abs(diff) <= EPS) return;
  const over = diff > 0 ? 0 : 1;
  const back = Math.abs(diff);
  s.stacks[over] = round2(s.stacks[over] + back);
  s.streetBet[over] = round2(s.streetBet[over] - back);
  s.invested[over] = round2(s.invested[over] - back);
}

function showdown(s) {
  const b = s.runout;
  const v0 = evaluate([...s.holes[0], ...b]);
  const v1 = evaluate([...s.holes[1], ...b]);
  s.showdown = true;
  if (v0 === v1) return settle(s, -1);
  return settle(s, v0 > v1 ? 0 : 1);
}

/** Award the pot to `winner` (-1 = split) and compute each seat's net result in bb. */
function settle(s, winner) {
  refundUncalled(s);
  const total = pot(s);
  const won = winner === -1 ? [total / 2, total / 2] : winner === 0 ? [total, 0] : [0, total];
  s.stacks = [round2(s.stacks[0] + won[0]), round2(s.stacks[1] + won[1])];
  s.done = true;
  s.result = {
    winner,
    pot: total,
    net: [round2(s.stacks[0] - s.start[0]), round2(s.stacks[1] - s.start[1])],
    showdown: !!s.showdown,
  };
  s.toAct = -1;
  return s;
}

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

