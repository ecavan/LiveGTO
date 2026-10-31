/**
 * A Play session: hands against one agent, every hero decision graded by the coach.
 *
 * Per decision we keep what the review needs (cards, board, pot, the options and their EVs).
 * Per hand: the result, the EV the hero gave up, and all-in luck:
 *   luck = actual result − (equity when the money went in × pot − what the hero put in)
 * so a lucky 3-high shove that got called and hit shows up as luck, not skill.
 *
 * Rating (duplicate-corrected): after every hand the same deal is replayed with a clone of the bot
 * in your seat, against the bot. Your edge on the deal is your result minus the clone's, so the
 * cards cancel and what is left is how much better (or worse) you played the hand than the bot
 * would have. Over a session that is D bb/100, which goes onto the bot ladder's own scale:
 *     Elo = Elo(bot) ± 900·log10(1 + |D|/25)
 * so beating the Reg by 25bb/100 puts you one band above him. Folding every hand or shoving every
 * hand both lose to the clone by hundreds of bb/100, which is the point: the old rating (EV lost
 * per decision against the coach's model, ratingFromLoss) ranked fold-everything above the Pro.
 * The EV-lost number stays as decision quality; it no longer rates you.
 */
import { newHand, act, board, pot, BTN, BB, rng } from './game.js';
import { createAgent, choose, handEnded, eloOf } from './agents.js';
import { coach } from './coach.js';
import { evaluate, cardStr } from './hand.js';
import CAL from './calibration.json';
import { otherGrade } from '../level.js';

export const HAND_STACK = 100;

export function createSession({ botId = 'reg', length = 0, coachMode = 'decision', model = null, stack = HAND_STACK, level = 2 } = {}) {
  const agent = createAgent(botId);
  if (model) agent.model = { ...agent.model, ...model, pi: { ...agent.model.pi, ...model.pi } }; // every bot remembers you
  return {
    botId,
    agent,
    stack, // bb each, every hand
    length, // 0 = endless
    coachMode,
    level, // 1 baseline (graded as if he played solid: the Reg, not adjusting) · 2 exploit (his real range)
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
  // the bot's read of you as the hand starts: the clone plays with it, and the villain in the replay too
  sess.modelAtStart = structuredClone(sess.agent.model);
  return sess.s;
}

/**
 * Replay this hand's deal with a clone of the bot in the hero's seat and the bot (as it was when
 * the hand started) in its own seat. Returns the clone's net result from the hero's seat, or null
 * if the replay failed. Deterministic: the clone's dice come from the hand number.
 */
export function cloneReplay(sess) {
  const s0 = sess.s;
  if (!s0?.done) return null;
  try {
    const model = sess.modelAtStart ? structuredClone(sess.modelAtStart) : structuredClone(sess.agent.model);
    const clone = { ...sess.agent, model: structuredClone(model) };
    const villain = { ...sess.agent, model };
    const rand = rng(1013904223 + sess.handNo * 2654435761);
    let s = newHand({ stacks: s0.start, holes: s0.holes, board: s0.runout, rand });
    let guard = 0;
    while (!s.done && guard++ < 40) {
      const who = s.toAct === sess.hero ? clone : villain;
      s = act(s, choose(who, s, rand));
    }
    if (!s.done) return null;
    return { net: s.result.net[sess.hero], log: s.log, showdown: s.result.showdown };
  } catch { return null; }
}

export const heroToAct = (sess) => sess.s && !sess.s.done && sess.s.toAct === sess.hero;

const nodeKey = (sess) => `${sess.handNo}:${sess.s.log.length}`;

/** The coach result for the current decision if it is already computed, else null. */
export function coachReady(sess) {
  return heroToAct(sess) && sess.pending?.key === nodeKey(sess) ? sess.pending.k : null;
}

/**
 * Who the coach prices against: Level 2 the real bot; Level 1 a baseline Reg who doesn't adjust to
 * you (the solid play). Preflop is the chart at both levels, so it always uses the real bot.
 */
export const coachAgent = (sess, level, s) => (level === 1 && s.street > 0 ? 'reg' : sess.agent);

/** Coach result for the hero's current decision (cached per node). */
export function coachNow(sess) {
  if (!heroToAct(sess)) return null;
  const key = nodeKey(sess);
  if (sess.pending?.key !== key) sess.pending = { key, k: coach(sess.s, sess.hero, coachAgent(sess, sess.level, sess.s), { level: sess.level }) };
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
  if (k.losses) loss = k.losses[idx]; // postflop: the plan's verdict, sized by the model (solid.js)
  else if (!k.preflop || k.evGraded) loss = Math.max(0, best.ev - opt.ev);
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
    buckets: k.buckets ?? null,
    heroBucket: k.heroBucket ?? null,
    preflop: !!k.preflop && !k.evGraded,
    chart: k.chart,
    notes: k.notes,
    solid: k.solid ?? null,
    losses: k.losses ?? null,
  };
  if (s.street > 0) {
    const other = sess.level === 1 ? 2 : 1;
    d.other = otherGrade(coach(s, sess.hero, coachAgent(sess, other, s), { level: other }), idx, pot(s), other);
  }
  d.level = sess.level ?? 2;
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
  const clone = cloneReplay(sess);
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
    // duplicate: what the bot would have made from your seat with your cards, and your edge over it
    cloneNet: clone ? Math.round(clone.net * 100) / 100 : null,
    edge: clone ? Math.round((net - clone.net) * 100) / 100 : null,
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
  const dup = edgeStats(H.map(h => h.edge).filter(x => x != null));
  const elo = eloOf(sess.botId);
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
    ...blendedRating(dup, elo, lossPer100),
    edge: dup.d, // bb/100 over the bot on the same cards
    edgeSe: dup.se,
    edgeN: dup.n,
    edgeSum: dup.sum,
    edgeSq: dup.sq,
    legacyRating: n >= 5 ? ratingFromLoss(lossPer100) : null,
    level: sess.level ?? 2,
    botElo: elo,
  };
}

/** Mean edge in bb/100 with its standard error, from per-hand edges in bb. */
export function edgeStats(edges) {
  const n = edges.length;
  if (!n) return { n: 0, d: 0, se: null, sum: 0, sq: 0 };
  const sum = edges.reduce((a, x) => a + x, 0);
  const sq = edges.reduce((a, x) => a + x * x, 0);
  return edgeStatsFromSums(sum, sq, n);
}
export function edgeStatsFromSums(sum, sq, n) {
  if (!n) return { n: 0, d: 0, se: null, sum: 0, sq: 0 };
  const mean = sum / n;
  const v = n > 1 ? Math.max(0, (sq - n * mean * mean) / (n - 1)) : 0;
  return { n, d: round2(100 * mean), se: n > 1 ? round2(100 * Math.sqrt(v / n)) : null, sum, sq };
}

/**
 * Pool session rows ({ bot, edgeSum, edgeSq, edgeN }) into one rating: the edge over all hands
 * (newest first, up to `maxHands`) on a composite opponent whose Elo is the hands-weighted mean
 * of the bots faced. Returns { rating, se, hands, edge, edgeSe } or null under 5 hands.
 */
export function poolRating(rows, maxHands = 1000) {
  let n = 0, sum = 0, sq = 0, eloW = 0, lost = 0, lostN = 0;
  for (const r of rows) {
    if (!r.edgeN) continue;
    const take = Math.min(r.edgeN, maxHands - n);
    if (take <= 0) break;
    const f = take / r.edgeN;
    n += take; sum += r.edgeSum * f; sq += r.edgeSq * f; eloW += eloOf(r.bot) * take;
    if (r.evLost != null && r.hands) { lost += r.evLost * (take / r.edgeN); lostN += take; }
    if (n >= maxHands) break;
  }
  if (n < MIN_RATED) return null;
  const st = edgeStatsFromSums(sum, sq, n);
  const botElo = eloW / n;
  const b = blendedRating(st, botElo, lostN ? (100 * lost) / lostN : null);
  return { rating: b.rating, se: b.ratingSe, hands: n, edge: st.d, edgeSe: st.se, botElo: Math.round(botElo), prior: b.prior, weight: b.weight };
}

/** Hands before a rating is shown at all. */
export const MIN_RATED = 20;
/** Prior spread of a player's true edge over the bot: 75bb/100 (about 300 Elo on the ladder). */
const PRIOR_SD = 0.75; // bb per hand

/**
 * The rating is a Bayesian blend of two measurements of the same thing:
 *   the duplicate edge   D = your result minus the bot's on your cards, bb/100 — unbiased and
 *                        ungameable, but noisy (a hand's edge has a spread of ~15bb)
 *   the decision quality the EV lost per 100 hands by the coach's grades, turned into an edge
 *                        through the ladder (ratingFromLoss) — stable from the first hand, but it
 *                        is the model's opinion of your decisions, not a result
 * Decision quality is the prior mean; its weight is n0 = s²/σ_p² hands (s = the per-hand spread
 * of your edge, σ_p = PRIOR_SD), so the duplicate result takes over as hands accumulate:
 *   D* = (n·D + n0·D0) / (n + n0),   se* = 100 / sqrt(n/s² + 1/σ_p²)
 * With no decision data (old sessions) the prior is the bot himself (D0 = 0), and it never sits
 * above him: grades can prove you played worse than the bot, not better.
 */
export function blendedRating(dup, botElo, lossPer100) {
  if (!dup || dup.n < MIN_RATED) return { rating: null, ratingSe: null, prior: null, weight: null };
  // the prior never sits above the bot: the coach's grades can show you played worse than him
  // (mistakes are mistakes), not better (a tight, passive line avoids "mistakes" without winning)
  const d0 = lossPer100 != null ? Math.min(0, edgeFromRating(ratingFromLoss(lossPer100), botElo)) : 0;
  const mean = dup.sum / dup.n;
  const v = dup.n > 1 ? Math.max(4, (dup.sq - dup.n * mean * mean) / (dup.n - 1)) : 225;
  const n0 = Math.min(600, Math.max(20, v / (PRIOR_SD * PRIOR_SD)));
  const d = (dup.n * dup.d + n0 * d0) / (dup.n + n0);
  const se = 100 / Math.sqrt(dup.n / v + 1 / (PRIOR_SD * PRIOR_SD));
  return { rating: ratingFromEdge(d, botElo), ratingSe: ratingSeFromEdge(d, round2(se)), prior: Math.round(d0), weight: Math.round(n0) };
}

/** The ladder's squash, inverted: the edge (bb/100) a rating stands for against a bot. */
export function edgeFromRating(rating, botElo) {
  const gap = rating - botElo;
  return Math.sign(gap) * 25 * (10 ** (Math.abs(gap) / ELO_PER_25) - 1);
}

/** The ladder's squash: bb/100 against a bot → Elo relative to it (±900·log10(1 + |D|/25)). */
export const ELO_PER_25 = 900;
export function ratingFromEdge(d, botElo) {
  const r = botElo + Math.sign(d) * ELO_PER_25 * Math.log10(1 + Math.abs(d) / 25);
  return Math.round(Math.max(400, Math.min(2800, r)));
}
/** ± on the rating from ± on the edge (the squash's slope at D). */
export function ratingSeFromEdge(d, se) {
  if (se == null) return null;
  return Math.round((ELO_PER_25 / Math.LN10) * se / (25 + Math.abs(d)));
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
