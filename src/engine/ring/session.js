/**
 * A live table session: you (seat 0) and up to five players drawn from a live pool, button
 * moving every hand. Stacks: everyone 100bb, all 200bb deep, or a live mix (short stacks of
 * 25–45bb next to 150–300bb deep ones); each player starts every hand with his own buy-in.
 * Players come and go now and then.
 * Every decision of yours is graded by the ring coach; the table learns your tendencies.
 */
import { newHand, act, board, pot, live, posOf, menu, legal } from './game.js';
import { randomPlayer, playerPolicyAll, context, newHeroStats, keyedMenu, tableTiers } from './players.js';
import { ringCoach } from './coach.js';
import { comboIndex } from '../hu/equity.js';
import { classify, cardStr } from '../hu/hand.js';

export const HERO = 0;

/** A buy-in in bb for a new player: 100, 200, or a live mix. */
export function depthFor(mode, rand = Math.random) {
  if (mode === 'deep') return 200;
  if (mode !== 'mixed') return 100;
  const x = rand();
  const r5 = (v) => Math.round(v / 5) * 5;
  if (x < 0.25) return r5(25 + rand() * 20); // the $50–$90 short stack
  if (x < 0.7) return r5(60 + rand() * 60);
  return r5(150 + rand() * 150); // the deep regular or the whale with a brick
}

export const heroDepth = (mode) => (mode === 'deep' ? 200 : 100);

export function createTable({ n = 6, coachMode = 'decision', level = 'medium', stacks = 'even', rand = Math.random } = {}) {
  const used = new Set();
  const tiers = tableTiers(level, n, rand);
  const players = [null, ...tiers.map(tier => randomPlayer(rand, used, tier))];
  for (const p of players) if (p) { p.hud = { hands: 0, vpip: 0, pfr: 0 }; p.depth = depthFor(stacks, rand); }
  return {
    n, coachMode, level, stacks, players, used,
    btn: Math.floor(rand() * n),
    handNo: 0,
    stats: newHeroStats(),
    hands: [],
    s: null,
    decisions: [],
    pending: null,
    arrivals: [], // "Vinny sat down" messages
    startedAt: Date.now(),
  };
}

export function startHand(t, rand = Math.random) {
  t.btn = (t.btn + 1) % t.n;
  t.arrivals = [];
  // now and then someone leaves and a new player sits down
  if (t.handNo > 0 && rand() < 0.04) {
    const seat = 1 + Math.floor(rand() * (t.n - 1));
    t.used.delete(t.players[seat].name);
    const p = randomPlayer(rand, t.used, t.players[seat].tier); // same kind of player: the difficulty holds
    p.hud = { hands: 0, vpip: 0, pfr: 0 };
    p.depth = depthFor(t.stacks, rand);
    t.arrivals.push(`${t.players[seat].name} left; ${p.name} sat down${t.stacks === 'mixed' ? ` with ${p.depth}bb` : ''}.`);
    t.players[seat] = p;
  }
  t.s = newHand({ n: t.n, btn: t.btn, stacks: t.players.map((p, i) => (i === HERO ? heroDepth(t.stacks) : p.depth ?? 100)), rand });
  t.snap = { ...t.stats };
  t.decisions = [];
  t.pending = null;
  t.handNo += 1;
  return t.s;
}

export const heroToAct = (t) => t.s && !t.s.done && t.s.toAct === HERO;
const nodeKey = (t) => `${t.handNo}:${t.s.log.length}`;
export const coachReady = (t) => (heroToAct(t) && t.pending?.key === nodeKey(t) ? t.pending.k : null);

export function coachNow(t) {
  if (!heroToAct(t)) return null;
  if (t.pending?.key !== nodeKey(t)) t.pending = { key: nodeKey(t), k: ringCoach(t.s, HERO, t, t.snap) };
  return t.pending.k;
}

export function heroAct(t, idx) {
  const k = coachNow(t);
  const s = t.s;
  const opt = k.options[idx];
  if (!opt) throw new Error(`no option ${idx}`);
  const best = k.options[k.best];
  let loss;
  if (!k.preflop) loss = Math.max(0, best.ev - opt.ev);
  else if (k.fine.includes(idx)) loss = 0;
  else {
    const ref = Math.max(...k.options.filter((o, i) => k.fine.includes(i)).map(o => o.ev), 0);
    loss = Math.max(k.nominal, ref - opt.ev);
  }
  loss = Math.round(loss * 100) / 100;
  const verdict = idx === k.best ? 'best' : k.fine.includes(idx) ? 'fine' : (loss >= 10 || loss >= 0.25 * pot(s)) ? 'blunder' : 'mistake';
  const d = {
    at: s.log.length, street: s.street, board: board(s), hole: s.holes[HERO], pot: pot(s),
    toCall: legal(s).callAmount, options: k.options.map(o => ({ type: o.type, to: o.to, label: o.label, ev: o.ev, info: o.info })),
    best: k.best, fine: k.fine, chosen: idx, loss, verdict, equity: k.equity, need: k.need, range: k.range,
    preflop: k.preflop, chart: k.chart, notes: k.notes, opponents: k.opponents,
  };
  t.decisions.push(d);
  track(t, s, HERO, opt);
  t.s = act(s, opt);
  return d;
}

/** The player to act (not you) acts. Returns what he did. */
export function botAct(t, rand = Math.random) {
  const s = t.s;
  const seat = s.toAct;
  const p = t.players[seat];
  const pol = playerPolicyAll(p, s, seat, context(s, seat, p, HERO, t.snap));
  const i = comboIndex(s.holes[seat][0], s.holes[seat][1]);
  let x = rand();
  let k = pol.opts.length - 1;
  for (let j = 0; j < pol.opts.length; j++) { x -= pol.P[j][i]; if (x <= 0) { k = j; break; } }
  const o = pol.opts[k];
  track(t, s, seat, o);
  t.s = act(s, o.type === 'fold' || o.type === 'check' || o.type === 'call' ? { type: o.type } : { type: o.type, to: o.to });
  return { seat, label: o.label, type: o.type };
}

/** Preflop HUD stats (VPIP / PFR), for every seat. */
function track(t, s, seat, o) {
  if (s.street !== 0) return;
  const first = !s.log.some(e => e.seat === seat && e.street === 0);
  if (!first) return;
  const vol = o.type === 'call' || o.type === 'raise' || o.type === 'allin';
  const raise = o.type === 'raise' || o.type === 'allin';
  if (seat === HERO) {
    t.stats.hands++;
    if (vol) t.stats.vpip++;
    if (raise) t.stats.pfr++;
  } else {
    const h = t.players[seat].hud;
    h.hands++;
    if (vol) h.vpip++;
    if (raise) h.pfr++;
  }
}

export function endHand(t) {
  const s = t.s;
  const net = s.result.net[HERO];
  // what the table learns from your showdowns: did your river aggression have it?
  if (s.result.showdown && !s.folded[HERO]) {
    const aggr = s.log.some(e => e.seat === HERO && e.street >= 2 && (e.type === 'bet' || e.type === 'raise' || (e.type === 'allin' && !e.callAllIn)));
    if (aggr) {
      const cls = classify(s.holes[HERO], s.runout);
      if (cls === 'air' || cls === 'weak' || cls === 'draw') t.stats.bluffsShown++;
      else t.stats.valueShown++;
    }
  }
  // a hand you saw through the preflop with your own money counts; hands you never got to act in don't
  if (!s.log.some(e => e.seat === HERO)) t.stats.hands++;
  const h = {
    no: t.handNo,
    pos: posOf(s, HERO),
    holes: s.holes.map(x => x.map(cardStr)),
    board: board(s).map(cardStr),
    runout: s.runout.map(cardStr),
    showdown: s.result.showdown,
    net,
    evLost: Math.round(t.decisions.reduce((a, d) => a + d.loss, 0) * 100) / 100,
    decisions: t.decisions,
    pot: pot(s),
    winners: s.result.winners,
  };
  t.hands.push(h);
  return h;
}

export function summary(t) {
  const H = t.hands;
  const n = H.length;
  const net = H.reduce((a, h) => a + h.net, 0);
  const evLost = H.reduce((a, h) => a + h.evLost, 0);
  const all = H.flatMap(h => h.decisions);
  const good = all.filter(d => d.verdict === 'best' || d.verdict === 'fine').length;
  return {
    hands: n,
    net: Math.round(net * 100) / 100,
    bbPer100: n ? Math.round((100 * net) / n) : 0,
    evLost: Math.round(evLost * 100) / 100,
    lossPer100: n ? Math.round((100 * evLost) / n) : 0,
    decisions: all.length,
    accuracy: all.length ? good / all.length : 0,
    vpip: t.stats.hands ? t.stats.vpip / t.stats.hands : 0,
    pfr: t.stats.hands ? t.stats.pfr / t.stats.hands : 0,
    blunders: all.filter(d => d.verdict === 'blunder').length,
    mistakes: all.filter(d => d.verdict === 'mistake').length,
  };
}

export { live, keyedMenu, menu, posOf };
