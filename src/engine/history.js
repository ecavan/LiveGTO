/**
 * Hand history: every hand you play (heads-up or at the live table) is kept on this device, with
 * the coach's grade for each of your decisions, so you can replay it move by move later
 * (game review) and so leaks show up across sessions.
 *
 * A stored hand is compact and self-contained:
 *   { id, sid, at, kind: 'hu'|'table', no, n, btn, hero, names, styles, start, holes, runout, log,
 *     net, evLost, luck, pot, showdown, opp, level, decisions: [...] }
 * Cards are ids (0..51). Seats are the engine's seats. `decisions[i].at` is the log index of the
 * action the decision became, so a replay can attach the grade to the right move.
 */
import * as HU from './hu/game.js';
import * as RING from './ring/game.js';
import { loadRaw, save } from '../store.js';

export const HISTORY_KEY = 'livegto.hands.v1';
export const MAX_HANDS = 400;

const r2 = (x) => (x == null ? x : Math.round(x * 100) / 100);
const r3 = (x) => (x == null ? x : Math.round(x * 1000) / 1000);

function packInfo(info) {
  if (!info) return undefined;
  const o = {};
  for (const [k, v] of Object.entries(info)) if (typeof v === 'number') o[k] = r3(v);
  return o;
}

export function packDecision(d) {
  const out = {
    at: d.at, street: d.street, board: [...d.board], hole: [...d.hole], pot: r2(d.pot), toCall: r2(d.toCall),
    options: d.options.map(o => ({ type: o.type, to: o.to, label: o.label, ev: r2(o.ev), info: packInfo(o.info) })),
    best: d.best, fine: [...(d.fine || [])], chosen: d.chosen, loss: r2(d.loss), verdict: d.verdict,
    equity: r3(d.equity), need: r3(d.need), preflop: !!d.preflop,
  };
  if (d.range) out.range = Object.fromEntries(Object.entries(d.range).map(([k, v]) => [k, r3(v)]));
  if (d.chart) out.chart = d.chart;
  if (d.notes?.length) out.notes = d.notes;
  if (d.opponents) out.opponents = d.opponents;
  return out;
}

const packLog = (log) => log.map(e => {
  const o = { seat: e.seat, street: e.street, type: e.type };
  if (e.to != null) o.to = e.to;
  if (e.amount != null) o.amount = e.amount;
  if (e.callAllIn) o.callAllIn = true;
  return o;
});

/** A finished heads-up hand (from the hu session) → stored hand. */
export function packHU(sess, h, oppName) {
  const s = sess.s;
  return {
    id: `${sess.startedAt.toString(36)}-${h.no}`, sid: sess.startedAt, at: Date.now(), kind: 'hu', no: h.no,
    n: 2, btn: HU.BTN, hero: sess.hero,
    names: sess.hero === HU.BTN ? ['You', oppName] : [oppName, 'You'],
    start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout], log: packLog(s.log),
    net: r2(h.net), evLost: r2(h.evLost), luck: r2(h.luck), pot: r2(h.pot), showdown: !!h.showdown,
    opp: sess.botId, decisions: h.decisions.map(packDecision),
  };
}

/** A finished live-table hand (from the ring session) → stored hand. */
export function packTable(t, h, styleOf) {
  const s = t.s;
  return {
    id: `${t.startedAt.toString(36)}-${h.no}`, sid: t.startedAt, at: Date.now(), kind: 'table', no: h.no,
    n: s.n, btn: s.btn, hero: 0,
    names: t.players.map((p, i) => (i === 0 ? 'You' : p.name)),
    styles: t.players.map((p, i) => (i === 0 ? '' : styleOf(p))),
    start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout], log: packLog(s.log),
    net: r2(h.net), evLost: r2(h.evLost), luck: 0, pot: r2(h.pot), showdown: !!h.showdown,
    level: t.level, decisions: h.decisions.map(packDecision),
  };
}

// ------------------------------------------------------------------ replay

const toAction = (e) => (e.type === 'fold' || e.type === 'check' || e.type === 'call' ? { type: e.type }
  : e.type === 'allin' ? (e.callAllIn ? { type: 'call' } : { type: 'allin' }) : { type: 'raise', to: e.to });

/** Engine states: states[0] before the first action, states[k] after k actions. */
export function statesOf(h) {
  const G = h.kind === 'hu' ? HU : RING;
  let st = h.kind === 'hu'
    ? HU.newHand({ stacks: h.start, holes: h.holes, board: h.runout })
    : RING.newHand({ n: h.n, btn: h.btn, stacks: h.start, holes: h.holes, board: h.runout });
  const out = [st];
  for (const e of h.log) {
    let a = toAction(e);
    if (h.kind === 'hu' && e.type === 'allin' && e.callAllIn) a = { type: 'call' };
    try { st = G.act(st, a); } catch { break; }
    out.push(st);
  }
  return out;
}

/** A uniform view of either engine's state, for drawing. */
export function viewOf(h, s) {
  const n = h.kind === 'hu' ? 2 : s.n;
  const folded = h.kind === 'hu' ? [0, 1].map(i => s.folded === i) : s.folded;
  const bd = s.done ? s.runout.slice(0, s.result?.showdown ? 5 : [0, 3, 4, 5][s.street]) : s.runout.slice(0, [0, 3, 4, 5][s.street]);
  const potNow = h.kind === 'hu' ? HU.pot(s) : RING.pot(s);
  const streetSum = s.streetBet.reduce((a, b) => a + b, 0);
  return {
    n, btn: h.kind === 'hu' ? HU.BTN : s.btn, stacks: s.stacks, streetBet: s.streetBet, folded, board: bd,
    pot: s.done ? potNow : r2(potNow - streetSum), toAct: s.done ? -1 : s.toAct, done: s.done, street: s.street,
    result: s.result,
  };
}

export const posName = (h, seat) => (h.kind === 'hu' ? (seat === HU.BTN ? 'BTN' : 'BB') : RING.positions(h.n)[(seat - h.btn + h.n) % h.n]);

/** Decision attached to log index k (the hero's k-th action), or null. */
export const decisionAt = (h, k) => h.decisions.find(d => d.at === k) || null;

// ------------------------------------------------------------------ grades

/** Chess-style class of a decision: best · good · inaccuracy · mistake · blunder. */
export function grade(d) {
  if (d.verdict === 'best') return 'best';
  if (d.verdict === 'fine') return 'good';
  if (d.verdict === 'blunder') return 'blunder';
  return d.loss < 1 && d.loss < 0.1 * Math.max(1, d.pot) ? 'inaccuracy' : 'mistake';
}
export const GRADES = {
  best: { label: 'Best', glyph: '★', tone: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500/40' },
  good: { label: 'Good', glyph: '✓', tone: 'text-sky-300', bg: 'bg-sky-500/15 border-sky-500/40' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', tone: 'text-yellow-300', bg: 'bg-yellow-500/15 border-yellow-500/40' },
  mistake: { label: 'Mistake', glyph: '?', tone: 'text-orange-300', bg: 'bg-orange-500/15 border-orange-500/40' },
  blunder: { label: 'Blunder', glyph: '??', tone: 'text-rose-300', bg: 'bg-rose-500/15 border-rose-500/40' },
};

/**
 * Accuracy, chess-style: 100 for a best move, falling with the EV given up relative to the pot.
 * A 1bb slip in a 40bb pot barely dents it; a pot-sized blunder zeroes that move.
 */
export function moveAccuracy(d) {
  if (d.verdict === 'best' || d.verdict === 'fine') return 100;
  const rel = d.loss / Math.max(2, d.pot);
  return Math.max(0, Math.round(100 * Math.exp(-4 * rel) - 10));
}

export function accuracyOf(hands) {
  const ds = hands.flatMap(h => h.decisions);
  if (!ds.length) return null;
  return Math.round(ds.reduce((a, d) => a + moveAccuracy(d), 0) / ds.length);
}

export function gradeCounts(hands) {
  const c = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  for (const h of hands) for (const d of h.decisions) c[grade(d)]++;
  return c;
}

// ------------------------------------------------------------------ storage

export function loadHands() {
  const v = loadRaw(HISTORY_KEY, null);
  return Array.isArray(v?.hands) ? v.hands : [];
}

export function addHand(hand) {
  let hands = loadHands();
  hands.push(hand);
  if (hands.length > MAX_HANDS) hands = hands.slice(-MAX_HANDS);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ hands }));
  } catch {
    save(HISTORY_KEY, { hands: hands.slice(-Math.floor(MAX_HANDS / 2)) }); // storage full: keep the newer half
  }
}

export const getHand = (id) => loadHands().find(h => h.id === id) || null;

export function clearHands() {
  save(HISTORY_KEY, { hands: [] });
}

/** Sessions, newest first: { sid, kind, opp, level, hands: [...] } */
export function sessionsOf(hands = loadHands()) {
  const by = new Map();
  for (const h of hands) {
    if (!by.has(h.sid)) by.set(h.sid, { sid: h.sid, kind: h.kind, opp: h.opp, level: h.level, n: h.n, hands: [] });
    by.get(h.sid).hands.push(h);
  }
  return [...by.values()].sort((a, b) => b.sid - a.sid);
}

// ------------------------------------------------------------------ leaks

/**
 * What kind of leak a graded decision is (null when it wasn't one). The kinds are the ones a live
 * player can act on: too loose / tight preflop, overfolding, calling too much, missed value, bad
 * bluffs, passive calls where a raise wins, sizing.
 */
export function leakOf(d) {
  if (d.verdict === 'best' || d.verdict === 'fine' || !(d.loss > 0.01)) return null;
  const c = d.options[d.chosen], b = d.options[d.best];
  const aggr = (o) => o.type === 'bet' || o.type === 'raise' || o.type === 'allin';
  if (d.street === 0) {
    if (c.type === 'fold') return 'pre-tight';
    if (b.type === 'fold') return 'pre-loose';
    if (c.type === 'call' && aggr(b)) return 'pre-passive';
    if (aggr(c) && b.type === 'call') return 'pre-overaggro';
    return 'pre-sizing';
  }
  const facing = d.toCall > 0.001;
  if (facing) {
    if (c.type === 'fold') return 'overfold';
    if (c.type === 'call' && b.type === 'fold') return 'overcall';
    if (c.type === 'call' && aggr(b)) return 'missed-raise';
    if (aggr(c) && b.type === 'fold') return 'bad-bluff';
    if (aggr(c) && b.type === 'call') return 'overraise';
    return 'sizing';
  }
  if (c.type === 'check' && aggr(b)) return (d.equity ?? 0) >= 0.5 ? 'missed-value' : 'missed-bluff';
  if (aggr(c) && b.type === 'check') return (d.equity ?? 0) >= 0.5 ? 'thin-value' : 'bad-bluff';
  return 'sizing';
}

export const LEAKS = {
  'pre-tight': { name: 'Folding too much preflop', fix: 'You folded hands that make money here. Widen up, most of all on the button and against limpers.' },
  'pre-loose': { name: 'Playing too many hands preflop', fix: 'You put money in with hands that lose. Tighten up out of position and against raises.' },
  'pre-passive': { name: 'Limping and flatting instead of raising', fix: 'You called where raising wins more. Raise to isolate the weak players and take the initiative.' },
  'pre-overaggro': { name: 'Raising too much preflop', fix: 'Your raise got called or re-raised by better hands too often. Call, or fold, instead.' },
  'pre-sizing': { name: 'Preflop sizing', fix: 'Right idea, wrong size. Size up against players who call too much.' },
  overfold: { name: 'Folding to bets too often', fix: 'You folded with enough equity to call. Check the price: equity needed = call ÷ (pot after your call).' },
  overcall: { name: 'Calling too much', fix: 'You called without the equity. Against players who rarely bluff, a big bet is usually real.' },
  'missed-raise': { name: 'Calling when a raise wins more', fix: 'Your hand was strong enough to raise for value (or they fold enough to raise as a bluff).' },
  'missed-value': { name: 'Missing value bets', fix: 'You checked a hand that was ahead of their calling range. Bet: live players call too much.' },
  'missed-bluff': { name: 'Missing good bluffs', fix: 'They fold enough here that betting beats giving up. Pick on players who fold too much.' },
  'thin-value': { name: 'Betting too thin', fix: 'Your bet only got called by better. Check and take the showdown.' },
  'bad-bluff': { name: 'Bluffs that don\'t work', fix: 'You bluffed into players who don\'t fold. Bluff the nits, value-bet the stations.' },
  overraise: { name: 'Raising when calling was better', fix: 'Your raise folded out worse hands and got called by better. Just call.' },
  sizing: { name: 'Bet sizing', fix: 'Right action, wrong size. Bigger against stations, smaller as a bluff.' },
};

/**
 * Leak report over stored hands: for each leak, how often, what it costs (bb/100 hands), and the
 * worst example hands. Sorted by cost.
 */
export function leakReport(hands = loadHands()) {
  const n = hands.length;
  const by = {};
  let spots = 0;
  for (const h of hands) {
    for (const d of h.decisions) {
      spots++;
      const k = leakOf(d);
      if (!k) continue;
      const e = (by[k] ||= { key: k, ...LEAKS[k], count: 0, lost: 0, examples: [] });
      e.count++;
      e.lost += d.loss;
      e.examples.push({ id: h.id, at: d.at, loss: d.loss, hole: d.hole, board: d.board, street: d.street, label: d.options[d.chosen].label, best: d.options[d.best].label });
    }
  }
  const leaks = Object.values(by).map(e => ({
    ...e,
    lost: r2(e.lost),
    per100: n ? r2((100 * e.lost) / n) : 0,
    examples: e.examples.sort((a, b) => b.loss - a.loss).slice(0, 4),
  })).sort((a, b) => b.lost - a.lost);
  const total = leaks.reduce((a, e) => a + e.lost, 0);
  return { hands: n, spots, total: r2(total), per100: n ? r2((100 * total) / n) : 0, leaks };
}
