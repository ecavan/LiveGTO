/**
 * A Play session: hands against one agent, every hero decision graded by the coach.
 *
 * Per decision we keep what the review needs (cards, board, pot, the options and their EVs).
 * Per hand: the result, the EV the hero gave up, and all-in luck:
 *   luck = actual result − (equity when the money went in × pot − what the hero put in)
 * so a lucky 3-high shove that got called and hit shows up as luck, not skill.
 *
 * Rating: EV lost per 100 hands → a performance rating (ratingFromLoss, calibrated against the
 * bot ladder by scripts/calibrate.mjs).
 */
import { newHand, act, board, pot, BTN, BB } from './game.js';
import { createAgent, choose, handEnded, eloOf } from './agents.js';
import { coach } from './coach.js';
import { evaluate, cardStr } from './hand.js';
import CAL from './calibration.json';

export const HAND_STACK = 100;

export function createSession({ botId = 'reg', length = 0, coachMode = 'decision', model = null, stack = HAND_STACK } = {}) {
  const agent = createAgent(botId);
  if (model) agent.model = { ...agent.model, ...model, pi: { ...agent.model.pi, ...model.pi } }; // every bot remembers you
  return {
    botId,
    agent,
    stack, // bb each, every hand
    length, // 0 = endless
    coachMode,
    handNo: 0,
    hands: [], // finished hands
    s: null, // current hand state
    hero: BTN,
    decisions: [], // decisions in the current hand
    pending: null, // coach result for the decision on screen
    startedAt: Date.now(),
  };
}

export function startHand(sess, rand = Math.random) {
  sess.hero = sess.handNo % 2 === 0 ? BTN : BB;
  sess.s = newHand({ stacks: [sess.stack ?? HAND_STACK, sess.stack ?? HAND_STACK], rand });
  sess.decisions = [];
  sess.allin = null;
  sess.pending = null;
  sess.handNo += 1;
  return sess.s;
}

export const heroToAct = (sess) => sess.s && !sess.s.done && sess.s.toAct === sess.hero;

const nodeKey = (sess) => `${sess.handNo}:${sess.s.log.length}`;

/** The coach result for the current decision if it is already computed, else null. */
export function coachReady(sess) {
  return heroToAct(sess) && sess.pending?.key === nodeKey(sess) ? sess.pending.k : null;
}

/** Coach result for the hero's current decision (cached per node). */
export function coachNow(sess) {
  if (!heroToAct(sess)) return null;
  const key = nodeKey(sess);
  if (sess.pending?.key !== key) sess.pending = { key, k: coach(sess.s, sess.hero, sess.agent) };
  return sess.pending.k;
}

/** Hero takes option index `idx` of the coach's options. Returns the graded decision. */
export function heroAct(sess, idx) {
  const k = coachNow(sess);
  const s = sess.s;
  const opt = k.options[idx];
  if (!opt) throw new Error(`no option ${idx}`);
  const best = k.options[k.best];
  let loss;
  if (!k.preflop || k.evGraded) loss = Math.max(0, best.ev - opt.ev);
  else if (k.fine.includes(idx)) loss = 0;
  else {
    // off the chart: the EV the chart play was worth over this one (model), at least a small cost
    const ref = Math.max(...k.options.filter((o, i) => k.fine.includes(i) && o.ev != null).map(o => o.ev), 0);
    loss = Math.max(k.nominal ?? 0.25, opt.ev != null ? ref - opt.ev : 0);
  }
  loss = Math.round(loss * 100) / 100;
  const verdict = idx === k.best ? 'best' : k.fine.includes(idx) ? 'fine'
    : (loss >= 10 || loss >= 0.25 * pot(s)) ? 'blunder' : 'mistake';
  const d = {
    at: s.log.length,
    street: s.street,
    board: board(s),
    hole: s.holes[sess.hero],
    pot: pot(s),
    toCall: Math.max(0, s.streetBet[1 - sess.hero] - s.streetBet[sess.hero]),
    options: k.options.map(o => ({ type: o.type, to: o.to, label: o.label, ev: o.ev, info: o.info })),
    best: k.best,
    fine: k.fine,
    chosen: idx,
    loss,
    verdict,
    equity: k.equity ?? null,
    need: k.need ?? null,
    range: k.range ?? null,
    preflop: !!k.preflop && !k.evGraded,
    chart: k.chart,
    notes: k.notes,
  };
  sess.decisions.push(d);
  noteAllIn(sess, act(s, opt));
  return d;
}

export function botAct(sess, rand = Math.random) {
  const a = choose(sess.agent, sess.s, rand);
  noteAllIn(sess, act(sess.s, a));
  return a;
}

/** Track the moment both players are all-in before the river, for all-in luck. */
function noteAllIn(sess, s2) {
  const was = sess.s;
  sess.s = s2;
  if (sess.allin || !s2.done || !s2.result.showdown) return;
  // street at which the last money went in
  const last = s2.log[s2.log.length - 1];
  const street = last?.street ?? was.street;
  if (street >= 3) return;
  const bd = s2.runout.slice(0, [0, 3, 4, 5][street]);
  sess.allin = { street, board: bd, equity: equityExact(s2.holes[sess.hero], s2.holes[1 - sess.hero], bd) };
}

/** Hero's equity vs one known hand (enumerated to the river; sampled from preflop). */
export function equityExact(h, v, bd, samples = 3000) {
  const dead = new Set([...h, ...v, ...bd]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
  const need = 5 - bd.length;
  let win = 0, n = 0;
  const score = (run) => {
    const b = [...bd, ...run];
    const x = evaluate([...h, ...b]), y = evaluate([...v, ...b]);
    win += x > y ? 1 : x === y ? 0.5 : 0;
    n++;
  };
  if (need === 1) for (const a of deck) score([a]);
  else if (need === 2) for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) score([deck[i], deck[j]]);
  else {
    let seed = h[0] * 7919 + v[0] * 104729 + 17;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < samples; k++) {
      const pick = new Set();
      while (pick.size < need) pick.add(deck[Math.floor(rnd() * deck.length)]);
      score([...pick]);
    }
  }
  return n ? win / n : 0;
}

/** Close the hand: result, EV lost, luck. Lets the bot learn. */
export function endHand(sess) {
  const s = sess.s;
  handEnded(sess.agent, s, 1 - sess.hero);
  const net = s.result.net[sess.hero];
  let luck = 0;
  if (sess.allin) {
    const invested = s.invested[sess.hero];
    const expected = sess.allin.equity * s.result.pot - invested;
    luck = net - expected;
  }
  const evLost = sess.decisions.reduce((a, d) => a + d.loss, 0);
  const h = {
    no: sess.handNo,
    hero: sess.hero,
    holes: s.holes.map(x => x.map(cardStr)),
    runout: s.runout.map(cardStr),
    board: board(s).map(cardStr),
    showdown: s.result.showdown,
    log: s.log,
    net,
    luck: Math.round(luck * 100) / 100,
    allinEq: sess.allin?.equity ?? null,
    evLost: Math.round(evLost * 100) / 100,
    decisions: sess.decisions,
    pot: s.result.pot,
  };
  sess.hands.push(h);
  return h;
}

export const sessionOver = (sess) => sess.length > 0 && sess.hands.length >= sess.length;

/** Summary numbers for the session so far. */
export function summary(sess) {
  const H = sess.hands;
  const n = H.length;
  const net = H.reduce((a, h) => a + h.net, 0);
  const luck = H.reduce((a, h) => a + h.luck, 0);
  const evLost = H.reduce((a, h) => a + h.evLost, 0);
  const all = H.flatMap(h => h.decisions);
  const post = all.filter(d => !d.preflop);
  const pre = all.filter(d => d.preflop);
  const good = all.filter(d => d.verdict === 'best' || d.verdict === 'fine').length;
  const lossPer100 = n ? (100 * evLost) / n : 0;
  return {
    hands: n,
    net: round2(net),
    luck: round2(luck),
    adjusted: round2(net - luck),
    evLost: round2(evLost),
    lossPer100: round2(lossPer100),
    bbPer100: n ? round2((100 * net) / n) : 0,
    decisions: all.length,
    accuracy: all.length ? good / all.length : 0,
    postAcc: post.length ? post.filter(d => d.verdict === 'best' || d.verdict === 'fine').length / post.length : 0,
    preAcc: pre.length ? pre.filter(d => d.verdict !== 'mistake' && d.verdict !== 'blunder').length / pre.length : 0,
    blunders: all.filter(d => d.verdict === 'blunder').length,
    mistakes: all.filter(d => d.verdict === 'mistake').length,
    rating: n >= 5 ? ratingFromLoss(lossPer100) : null,
    botElo: eloOf(sess.botId),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Performance rating from EV lost per 100 hands:  R = a − b·log2(1 + L / L0).
 * a, b, L0 come from calibration.json (fitted so the bots' own play maps to their ladder Elo).
 */
export function ratingFromLoss(L) {
  const { a = 2200, b = 330, L0 = 8 } = CAL.fit || {};
  return Math.round(Math.max(400, Math.min(2800, a - b * Math.log2(1 + Math.max(0, L) / L0))));
}
