/**
 * Watch: two bots play heads-up with every card face up, and each decision is explained.
 *
 * For a thinking bot the explanation is its own maths: its read of the other player, its
 * equity against the range it puts him on (and against his actual hand, which it can't see),
 * the fold equity and EV of each option. For a profile bot: its hand class, how its style plays
 * that hand here, and how far it has shifted towards exploiting its opponent.
 */
import { newHand, act, board, pot, BTN, BB } from './game.js';
import { createAgent, policyAll, handEnded, adaptation, eloOf, AGENTS } from './agents.js';
import { keyedMenu, matchOption } from './policy.js';
import { topRead, HERO_TYPES } from './thinker.js';
import { comboIndex } from './equity.js';
import { classify, handType, cardStr } from './hand.js';
import { BOT_TYPES } from './bots.js';
import { equityExact } from './session.js';

export function createMatch(aId, bId) {
  return {
    ids: [aId, bId],
    agents: [createAgent(aId), createAgent(bId)],
    handNo: 0,
    seatOfA: BTN,
    s: null,
    net: 0, // bot A's result
    hands: [],
    feed: [], // explained decisions in the current hand
  };
}

export function startHand(m, rand = Math.random) {
  m.seatOfA = m.handNo % 2 === 0 ? BTN : BB;
  m.s = newHand({ rand });
  m.feed = [];
  m.handNo += 1;
  return m.s;
}

/** The agent sitting in `seat`. */
export const agentAt = (m, seat) => (seat === m.seatOfA ? m.agents[0] : m.agents[1]);

const TYPE_NAME = (t) => (t === 'random' ? 'Wild' : BOT_TYPES[t]?.name ?? t);

/** Explain and play the next action. Returns the explained decision. */
export function step(m, rand = Math.random) {
  const s = m.s;
  if (!s || s.done) return null;
  const seat = s.toAct;
  const ag = agentAt(m, seat);
  const opp = agentAt(m, 1 - seat);
  const hole = s.holes[seat];
  const i = comboIndex(hole[0], hole[1]);
  const pol = policyAll(ag, s);
  // sample its action exactly as choose() would
  let x = rand();
  let k = pol.opts.length - 1;
  for (let j = 0; j < pol.opts.length; j++) { x -= pol.P[j][i]; if (x <= 0) { k = j; break; } }
  const menu = keyedMenu(s);
  const chosen = menu[matchOption(menu, pol.opts[k])] ?? pol.opts[k];

  const bd = board(s);
  const probs = pol.opts.map((o, j) => ({ label: o.label, type: o.type, p: pol.P[j][i], ev: pol.ev ? pol.ev[j][i] : null, fold: pol.info?.[j]?.fold ?? null }))
    .filter(o => o.p >= 0.005 || o.ev != null);
  const d = {
    seat,
    who: ag.name,
    id: ag.id,
    kind: ag.kind,
    street: s.street,
    board: bd.map(cardStr),
    hole: hole.map(cardStr),
    pot: pot(s),
    toCall: Math.max(0, s.streetBet[1 - seat] - s.streetBet[seat]),
    action: chosen.label,
    type: chosen.type,
    probs,
    handType: handType(hole),
    cls: bd.length ? classify(hole, bd) : null,
    // what it believes about the other player, and how that compares with the truth
    read: readSummary(ag),
    eqRead: pol.eq ? pol.eq[i] : null,
    eqTrue: equityExact(hole, s.holes[1 - seat], bd, 800),
    adapt: adaptation(ag),
    notes: ag.kind === 'profile' ? (BOT_TYPES[ag.id]?.notes || []) : [],
    oppName: opp.name,
  };
  m.feed.push(d);
  m.s = act(s, chosen);
  if (m.s.done) finish(m);
  return d;
}

function readSummary(ag) {
  const pi = ag.model?.pi;
  if (!pi || (ag.model.hands ?? 0) < 1) return null;
  const top = HERO_TYPES.map(t => [t, pi[t] ?? 0]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.map(([t, p]) => ({ name: TYPE_NAME(t), p }));
}

function finish(m) {
  const s = m.s;
  handEnded(m.agents[0], s, m.seatOfA);
  handEnded(m.agents[1], s, 1 - m.seatOfA);
  const netA = s.result.net[m.seatOfA];
  m.net += netA;
  m.hands.push({ no: m.handNo, netA, pot: s.result.pot, showdown: s.result.showdown });
}

export function scoreboard(m) {
  const n = m.hands.length;
  return {
    hands: n,
    netA: Math.round(m.net * 10) / 10,
    bb100: n ? Math.round((100 * m.net) / n) : 0,
    eloA: eloOf(m.ids[0]),
    eloB: eloOf(m.ids[1]),
    readAofB: m.agents[0].model.hands >= 3 ? topRead(m.agents[0].model) : null,
    readBofA: m.agents[1].model.hands >= 3 ? topRead(m.agents[1].model) : null,
  };
}

export { AGENTS, TYPE_NAME };
