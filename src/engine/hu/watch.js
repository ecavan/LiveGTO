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
    stats: [newStats(), newStats()], // per bot (0 = player 1)
  };
}

const newStats = () => ({ hands: 0, vpip: 0, pfr: 0, cbetOpp: 0, cbet: 0, facedBet: 0, foldedToBet: 0, riverBets: 0, riverBluffs: 0, riverCalls: 0, riverCallsLost: 0, sdNet: 0, nonSdNet: 0 });

/**
 * Tally one finished hand into both bots' stats. Every card is known in Watch, so a river bet is
 * a bluff when the bettor held air, a weak pair or a missed draw, whether or not it was called.
 */
export function tally(m, s) {
  const pOf = (seat) => (seat === m.seatOfA ? 0 : 1);
  const aggr = (e) => e.type === 'bet' || e.type === 'raise' || (e.type === 'allin' && !e.callAllIn);
  const pre = s.log.filter(e => e.street === 0);
  const lastPre = [...pre].reverse().find(aggr);
  for (const seat of [0, 1]) {
    const st = m.stats[pOf(seat)];
    st.hands++;
    const mine = pre.filter(e => e.seat === seat);
    if (mine.some(e => e.type === 'call' || aggr(e))) st.vpip++;
    if (mine.some(aggr)) st.pfr++;
    const net = s.result.net[seat];
    if (s.result.showdown) st.sdNet += net; else st.nonSdNet += net;
  }
  // c-bet: the preflop raiser's first flop action when nobody has bet yet
  if (lastPre) {
    const flop = s.log.filter(e => e.street === 1);
    const first = flop.find(e => e.seat === lastPre.seat);
    const before = first ? flop.slice(0, flop.indexOf(first)) : [];
    if (first && !before.some(aggr)) {
      const st = m.stats[pOf(lastPre.seat)];
      st.cbetOpp++;
      if (aggr(first)) st.cbet++;
    }
  }
  // facing bets after the flop, and river bets / calls
  for (let k = 0; k < s.log.length; k++) {
    const e = s.log[k];
    if (e.street === 0) continue;
    const prev = s.log[k - 1];
    const st = m.stats[pOf(e.seat)];
    if (prev && prev.street === e.street && prev.seat !== e.seat && aggr(prev)) {
      st.facedBet++;
      if (e.type === 'fold') st.foldedToBet++;
      if (e.street === 3 && (e.type === 'call' || (e.type === 'allin' && e.callAllIn))) {
        st.riverCalls++;
        if (s.result.showdown && s.result.net[e.seat] < 0) st.riverCallsLost++;
      }
    }
    if (e.street === 3 && aggr(e)) {
      st.riverBets++;
      const cls = classify(s.holes[e.seat], s.runout);
      if (cls === 'air' || cls === 'weak' || cls === 'draw') st.riverBluffs++;
    }
  }
}

const r0 = (x) => Math.round(x * 10) / 10;
const share = (a, b) => (b ? a / b : null);

/** Per-bot numbers and one sentence on how the winner is winning. */
export function matchSummary(m) {
  const names = m.agents.map(a => a.name);
  const rows = m.stats.map(st => ({
    vpip: share(st.vpip, st.hands), pfr: share(st.pfr, st.hands), cbet: share(st.cbet, st.cbetOpp),
    foldToBet: share(st.foldedToBet, st.facedBet), riverBluff: share(st.riverBluffs, st.riverBets),
    riverCallLost: share(st.riverCallsLost, st.riverCalls), sdNet: r0(st.sdNet), nonSdNet: r0(st.nonSdNet),
    riverBets: st.riverBets, riverCalls: st.riverCalls,
    n: { vpip: st.hands, pfr: st.hands, cbet: st.cbetOpp, foldToBet: st.facedBet, riverBluff: st.riverBets, riverCallLost: st.riverCalls },
  }));
  let story = null;
  const n = m.hands.length;
  if (n >= 8 && Math.abs(m.net) >= 3) {
    const w = m.net > 0 ? 0 : 1, l = 1 - w;
    const W = rows[w], L = rows[l];
    const pc = (x) => `${Math.round(100 * x)}%`;
    const bits = [];
    if (W.nonSdNet >= W.sdNet) {
      bits.push(`${names[w]} is winning without showdowns (${W.nonSdNet >= 0 ? '+' : ''}${W.nonSdNet}bb)`);
      if (L.foldToBet != null) bits.push(`${names[l]} folds to ${pc(L.foldToBet)} of bets after the flop`);
    } else {
      bits.push(`${names[w]} is winning at showdown (${W.sdNet >= 0 ? '+' : ''}${W.sdNet}bb)`);
      if (L.riverCallLost != null && L.riverCalls >= 2) bits.push(`${names[l]} pays off: ${pc(L.riverCallLost)} of his river calls lose`);
      else if (L.riverBluff != null && L.riverBets >= 2) bits.push(`${names[l]} bluffs too much: ${pc(L.riverBluff)} of his river bets are bluffs`);
    }
    if (W.riverBluff != null && W.riverBets >= 3) bits.push(`${names[w]}'s river bets are ${pc(W.riverBluff)} bluffs`);
    story = bits.join('; ') + '.';
  }
  return { names, rows, story, hands: n };
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
  tally(m, s);
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
