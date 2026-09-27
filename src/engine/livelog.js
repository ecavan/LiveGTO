/**
 * Log a hand you played for real, then let the coach grade it.
 *
 * The hand is modelled 6-handed (players who fold preflop don't change anything). You enter your
 * seat, cards, stacks in dollars, and the action as it happened; the board as it comes. Each
 * opponent who plays gets a type (Station, Nit, … or Unknown = a typical live player): his range is
 * read from his actions through that type's strategy, exactly as at the Play table, and each of your
 * decisions is priced against those ranges, your real bet sizes included. The grades stay hidden
 * until the hand is done.
 *
 * Villains' cards you never saw are placeholders: never shown, never used by the coach.
 */
import { newHand, act, legal, board, pot, posOf, positions, round2 } from './ring/game.js';
import { ringCoach } from './ring/coach.js';
import { gradeDecision } from './ring/session.js';
import { newHeroStats, ARCHETYPES } from './ring/players.js';
import { packDecision } from './history.js';

export const HERO = 0;
export const N = 6;

export const VILLAIN_TYPES = {
  unknown: { name: 'Unknown', blurb: 'a typical $1/$2 player', mix: { station: 0.3, whale: 0.12, nit: 0.2, reg: 0.25, maniac: 0.05, shark: 0.08 } },
  station: { name: 'Station', mix: { station: 1 } },
  whale: { name: 'Whale', mix: { whale: 1 } },
  nit: { name: 'Nit', mix: { nit: 1 } },
  maniac: { name: 'Maniac', mix: { maniac: 1 } },
  reg: { name: 'Reg', mix: { reg: 1 } },
  pro: { name: 'Pro / shark', mix: { pro: 0.5, shark: 0.5 } },
};
for (const [k, v] of Object.entries(VILLAIN_TYPES)) if (!v.blurb) v.blurb = ARCHETYPES[Object.keys(v.mix)[0]].blurb;

export const STAKES = { '1/2': 2, '1/3': 3, '2/5': 5, '5/10': 10 };

/** Button seat that puts you (seat 0) in position `pos` at a 6-handed table. */
export function btnFor(pos) {
  const i = positions(N).indexOf(pos); // distance from the button
  return (N - i) % N;
}

/**
 * A new log: { stakes, pos, hole: [id, id], stack$, others$ }.
 * Placeholder hole cards for the others come from the cards nobody has named.
 */
export function createLog({ stakes = '1/2', pos = 'CO', hole, stack = 200, others = null }) {
  const bb = STAKES[stakes] || 2;
  const toBB = (d) => round2(d / bb);
  return {
    stakes, bb, pos, btn: btnFor(pos), hole: [...hole],
    start: Array.from({ length: N }, (_, i) => (i === HERO ? toBB(stack) : toBB(others ?? stack))),
    types: Array(N).fill('unknown'),
    boardCards: [], // named so far
    shown: {}, // seat → [id, id] if he showed
    actions: [], // { type, to? } in order
    createdAt: Date.now(),
  };
}

function placeholders(L) {
  const used = new Set([...L.hole, ...L.boardCards, ...Object.values(L.shown).flat()]);
  const free = [];
  for (let c = 51; c >= 0; c--) if (!used.has(c)) free.push(c);
  const holes = Array.from({ length: N }, (_, i) => (i === HERO ? L.hole : L.shown[i] ?? [free.pop(), free.pop()]));
  const runout = [...L.boardCards];
  while (runout.length < 5) runout.push(free.pop());
  return { holes, runout };
}

/** Rebuild the engine state from the log. */
export function stateOf(L) {
  const { holes, runout } = placeholders(L);
  let s = newHand({ n: N, btn: L.btn, stacks: L.start, holes, board: runout });
  for (const a of L.actions) s = act(s, a);
  return s;
}

/** How many board cards the current street needs that haven't been named. */
export function boardNeeded(L, s = stateOf(L)) {
  const need = [0, 3, 4, 5][s.done ? (s.result?.showdown ? 3 : s.street) : s.street];
  return Math.max(0, need - L.boardCards.length);
}

/** Record an action for the player to act. Amounts `to` are in bb, clamped to what's legal. */
export function logAction(L, a) {
  const s = stateOf(L);
  const lg = legal(s);
  if (!lg) throw new Error('hand is over');
  let x = { type: a.type };
  if (a.type === 'check' && !lg.check) x = { type: 'call' };
  if (a.type === 'call' && !lg.call) x = { type: 'check' };
  if (['bet', 'raise', 'allin'].includes(a.type)) {
    if (!lg.canRaise) x = { type: lg.call ? 'call' : 'check' };
    else {
      const to = a.type === 'allin' ? lg.maxTo : round2(Math.min(lg.maxTo, Math.max(lg.minTo, a.to)));
      x = to >= lg.maxTo - 1e-9 ? { type: 'allin' } : { type: 'raise', to };
    }
  }
  act(s, x); // throws if illegal
  L.actions.push(x);
  return x;
}

/** Everyone before you folds (preflop): fold every seat to act until it's you or someone has acted. */
export function foldToHero(L) {
  let s = stateOf(L);
  while (!s.done && s.toAct !== HERO && s.street === 0) {
    L.actions.push({ type: 'fold' });
    s = act(s, { type: 'fold' });
  }
}

export const undo = (L) => { L.actions.pop(); const s = stateOf(L); L.boardCards = L.boardCards.slice(0, Math.max(0, Math.min(L.boardCards.length, [0, 3, 4, 5][s.street] || 0))); };

/** The table the coach sees: each seat's type as a player. */
function tableOf(L) {
  return { players: L.types.map((t, i) => (i === HERO ? null : { name: `Seat ${i}`, mix: VILLAIN_TYPES[t]?.mix ?? VILLAIN_TYPES.unknown.mix, learn: 0, ramp: 120 })) };
}

/**
 * Grade every one of your decisions: the coach at each node where you acted, your real action
 * priced alongside the menu's options.
 */
export function gradeLog(L) {
  const { holes, runout } = placeholders(L);
  let s = newHand({ n: N, btn: L.btn, stacks: L.start, holes, board: runout });
  const table = tableOf(L);
  const stats = newHeroStats();
  const out = [];
  for (const a of L.actions) {
    if (s.toAct === HERO && !s.done) {
      const extra = ['fold', 'check', 'call'].includes(a.type) ? null : { type: a.type, to: a.type === 'allin' ? legal(s).maxTo : a.to };
      const k = ringCoach(s, HERO, table, stats, extra);
      let idx = k.options.findIndex(o => o.type === a.type && (a.to == null || Math.abs((o.to ?? -1) - a.to) < 0.011));
      if (idx < 0 && a.type === 'allin') idx = k.options.findIndex(o => o.type === 'allin');
      if (idx < 0 && a.type === 'raise') idx = k.options.findIndex(o => (o.type === 'raise' || o.type === 'bet') && Math.abs(o.to - a.to) < 0.011);
      if (idx >= 0) out.push(gradeDecision(s, k, idx, HERO));
    }
    s = act(s, a);
  }
  return { decisions: out, s };
}

/** A graded log → a stored hand for Review (grouped per day as "Your live hands"). */
export function toHistory(L, graded) {
  const { s, decisions } = graded;
  const { holes, runout } = placeholders(L);
  const day = new Date(L.createdAt); day.setHours(0, 0, 0, 0);
  const hidden = holes.map((_, i) => i).filter(i => i !== HERO && !L.shown[i]);
  const known = !s.done || !s.result.showdown || s.folded.every((f, i) => f || i === HERO || !hidden.includes(i));
  const log = s.log.map(e => ({ seat: e.seat, street: e.street, type: e.type, ...(e.to != null ? { to: e.to } : {}), ...(e.amount != null ? { amount: e.amount } : {}), ...(e.callAllIn ? { callAllIn: true } : {}) }));
  return {
    id: `live-${L.createdAt.toString(36)}`, sid: day.getTime(), at: L.createdAt, kind: 'table', live: true, no: 0,
    n: N, btn: L.btn, hero: HERO, names: L.types.map((t, i) => (i === HERO ? 'You' : posOf(s, i))),
    styles: L.types.map((t, i) => (i === HERO ? '' : VILLAIN_TYPES[t].name)),
    start: [...L.start], holes, runout, log, hidden, stakes: L.stakes,
    net: s.done && known ? round2(s.result.net[HERO]) : null,
    evLost: round2(decisions.reduce((a, d) => a + d.loss, 0)), luck: 0, pot: round2(pot(s)), showdown: !!s.result?.showdown,
    level: 'live', decisions: decisions.map(packDecision),
  };
}

export { posOf, board, pot, legal, positions };
