/**
 * The coach: for the hero's decision, what is each option worth against *this* bot?
 *
 * EV is measured from now: chips you get back from the pot minus chips you still put in
 * (folding = 0). Against the bot's exact range (range.js):
 *   call      Σ w·[eq·(P + C)] − C
 *   bet A     Σ w·[pf·P + pc·(eq·(P + A + A′) − A)]      (pf/pc: the bot's fold/continue mix)
 *   check     IP, street over: Σ w·eq·P;  OOP: the bot's betting mix, then your best reply
 * P = pot now, C = to call, A′ = what the bot adds to call. Equity after this street is treated
 * as realised (so flop/turn numbers are one-street-ahead estimates; river is exact vs the bot,
 * except that a bot raise is treated as a call).
 * Preflop uses the Reg chart plus the steal maths against this bot's folding range.
 */
import { ALL_COMBOS, classify, handType, CLASSES } from './hand.js';
import { menu, legal, act, board, pot, replay, BTN, BB } from './game.js';
import { villainRange, equities, rangeByClass } from './range.js';
import { preflopProbs } from './bots.js';
import { policyAll, actionProb } from './agents.js';
import { probOf } from './policy.js';
import { equityVsRange } from './equity.js';
import { readOpponent } from './thinker.js';
import { PREFLOP_RANK } from './preflopRank.js';
import { alpha, requiredEquity } from '../potmath.js';

const round2 = (x) => Math.round(x * 100) / 100;

function sumW(w) {
  let t = 0;
  for (let i = 0; i < w.length; i++) t += w[i];
  return t;
}

/**
 * EV of each of the hero's options against `agent` (see agents.js), and the best one.
 * `agent` may also be a profile id string ('station').
 */
export function coach(s, hero, agentOrId) {
  const agent = typeof agentOrId === 'string' ? { id: agentOrId, kind: 'profile' } : agentOrId;
  if (s.street === 0) return preflopCoach(s, hero, agent);
  const villain = 1 - hero;
  const bd = board(s);
  const w = villainRange(s, villain, agent);
  const W = sumW(w);
  const { perCombo: eq, overall } = equities(s.holes[hero], w, bd);
  const P = pot(s);
  const L = legal(s);
  const e = (i) => (Number.isNaN(eq[i]) ? 0 : eq[i]);
  const avg = (f) => {
    let t = 0;
    for (let i = 0; i < w.length; i++) if (w[i] > 0) t += w[i] * f(i);
    return W > 0 ? t / W : 0;
  };

  const options = menu(s).map(m => {
    let ev = 0;
    const info = {};
    if (m.type === 'fold') ev = 0;
    else if (m.type === 'call') {
      const C = L.callAmount;
      ev = avg(i => e(i) * (P + C) - C);
      info.eq = overall;
      info.need = requiredEquity(P, C);
    } else if (m.type === 'check') {
      const s2 = act(s, m);
      if (s2.done || s2.street !== s.street) {
        ev = avg(i => e(i) * P);
      } else {
        // we check, he checks back or bets; we then call or fold, whichever is better
        const pol = policyAll(agent, s2);
        info.botBets = 0;
        pol.opts.forEach((o, k) => {
          const p = pol.P[k];
          if (o.type !== 'check') info.botBets += avg(i => p[i]);
          if (o.type === 'check') {
            ev += avg(i => p[i] * e(i) * P);
          } else {
            const b = Math.min(o.to, s.stacks[hero]);
            ev += Math.max(0, avg(i => p[i] * (e(i) * (P + 2 * b) - b)));
          }
        });
      }
    } else {
      // bet / raise / all-in: he folds, or continues (a re-raise is treated as a call)
      const A = round2(m.to - s.streetBet[hero]);
      const s2 = act(s, m);
      if (s2.done) {
        ev = avg(i => e(i) * (P + A) - A);
      } else {
        const add = round2(Math.min(s2.stacks[villain], m.to - s2.streetBet[villain]));
        const pf = probOf(policyAll(agent, s2), { type: 'fold' });
        ev = avg(i => pf[i] * P + (1 - pf[i]) * (e(i) * (P + A + add) - A));
        info.fold = avg(i => pf[i]);
        const cw = avg(i => 1 - pf[i]);
        info.eqCalled = cw > 1e-9 ? avg(i => (1 - pf[i]) * e(i)) / cw : null;
        info.risk = A;
        info.breakEven = A / (P + A); // a pure bluff needs this much fold equity
      }
    }
    return { ...m, ev: round2(ev), info };
  });

  const best = options.reduce((a, b, i) => (b.ev > options[a].ev ? i : a), 0);
  const tol = Math.max(0.1, 0.02 * P);
  const fine = options.map((o, i) => (options[best].ev - o.ev <= tol ? i : -1)).filter(i => i >= 0);
  return {
    street: s.street,
    exact: s.street === 3,
    equity: overall,
    need: L.facing ? requiredEquity(P, L.callAmount) : null,
    range: rangeByClass(w, bd),
    weights: w,
    combos: Math.round(W * 10) / 10,
    options,
    best,
    fine,
    tol,
  };
}

// ------------------------------------------------------------------ preflop

const PCT = Object.fromEntries(PREFLOP_RANK.map(([h, , cum]) => [h, cum]));
const COMBOS = (k) => (k.length === 2 ? 6 : k.endsWith('s') ? 4 : 12);

/**
 * Share of the bot's *current* range that folds to our raise: his range from his earlier
 * actions (a limper's range, not all hands), minus combos holding our cards.
 */
function botFoldShare(agent, s2, seat) {
  const w = villainRange(s2, seat, agent);
  const W = sumW(w);
  if (!(W > 1e-9)) return null; // he never takes this line
  const pf = probOf(policyAll(agent, s2), { type: 'fold' });
  let f = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > 0) f += w[i] * pf[i];
  return f / W;
}

function preflopCoach(s, hero, agent) {
  const villain = 1 - hero;
  const key = handType(s.holes[hero]);
  const reg = preflopProbs('reg', s, hero, key);
  const m = menu(s);
  const L = legal(s);
  const P = pot(s);
  const passive = L.facing ? 'call' : 'check';
  const hasRaise = m.some(o => o.type === 'raise');
  // an all-in only counts as "the raise" when it is the only raise left
  const kind = (o) => (o.type === 'raise' || (o.type === 'allin' && !hasRaise) ? 'raise' : o.type === 'allin' ? 'shove' : o.type === 'fold' ? 'fold' : passive);
  // the chart never folds when checking is free
  const chart = reg.raise >= 0.5 ? 'raise' : reg.fold >= 0.5 && L.facing ? 'fold' : passive;
  const notes = [];
  const fine = new Set(m.map((o, i) => (kind(o) === chart ? i : -1)).filter(i => i >= 0));

  // EVs against his range and strategy. Exact where the hand ends now (shoving, calling a shove);
  // otherwise one street ahead with equity realisation ρ (in position 0.95, out of position 0.8),
  // the same model the thinking bots use. Used to size preflop mistakes, not to replace the chart.
  const facingAllIn = L.facing && s.stacks[villain] <= 1e-9;
  const options = m.map(o => ({ ...o, ev: null, info: {} }));
  const w = villainRange(s, villain, agent);
  const W = sumW(w);
  if (W > 1e-9) {
    const { perCombo: eq, overall } = equities(s.holes[hero], w, []);
    const e = (i) => (Number.isNaN(eq[i]) ? 0 : eq[i]);
    const avg = (f) => { let x = 0; for (let i = 0; i < w.length; i++) if (w[i] > 0) x += w[i] * f(i); return x / W; };
    const rho = hero === BTN ? 0.95 : 0.8;
    options.forEach(o => {
      if (o.type === 'fold') { o.ev = 0; return; }
      if (o.type === 'call' || o.type === 'check') {
        const C = o.type === 'call' ? L.callAmount : 0;
        const s2 = act(s, o);
        if (s2.done) { o.ev = round2(avg(i => e(i) * (P + C) - C)); o.info = { eq: overall, need: requiredEquity(P, C) }; return; }
        if (s2.street !== s.street) { o.ev = round2(avg(i => rho * e(i) * (P + C) - C)); o.info = { eq: overall, need: C ? requiredEquity(P, C) : null }; return; }
        // he still acts (after a limp): checks, or raises and we choose fold or call
        const pol = policyAll(agent, s2);
        let ev = 0;
        pol.opts.forEach((b, k) => {
          const p = pol.P[k];
          if (b.type === 'check' || b.type === 'call' || b.type === 'fold') ev += avg(i => p[i] * (rho * e(i) * (P + C) - C));
          else {
            const a = b.to - s2.streetBet[villain];
            const d = Math.min(b.to - s2.streetBet[hero], s2.stacks[hero]);
            const callV = avg(i => p[i] * (rho * e(i) * (P + C + a + d) - C - d));
            ev += Math.max(avg(i => p[i] * -C), callV);
          }
        });
        o.ev = round2(ev);
        return;
      }
      // raise / all-in
      const A = round2(o.to - s.streetBet[hero]);
      const s2 = act(s, o);
      if (s2.done) { o.ev = round2(avg(i => e(i) * (P + A) - A)); return; }
      const add = round2(Math.min(s2.stacks[villain], o.to - s2.streetBet[villain]));
      const pf = probOf(policyAll(agent, s2), { type: 'fold' });
      const r = o.type === 'allin' ? 1 : rho;
      o.ev = round2(avg(i => pf[i] * P + (1 - pf[i]) * (r * e(i) * (P + A + add) - A)));
      const fold = avg(i => pf[i]);
      const cw = 1 - fold;
      o.info = { fold, eqCalled: cw > 1e-9 ? avg(i => (1 - pf[i]) * e(i)) / cw : null, risk: A, breakEven: A / (P + A) };
    });
    if (facingAllIn) notes.push(`Calling needs ${Math.round(100 * requiredEquity(P, L.callAmount))}% equity; you have ${Math.round(100 * overall)}% against his shoving range.`);
  }

  // steal maths: does this bot fold often enough that any raise profits?
  const raiseOpt = m.find(o => o.type === 'raise');
  if (raiseOpt && !facingAllIn) {
    const s2 = act(s, raiseOpt);
    if (!s2.done) {
      const f = botFoldShare(agent, s2, villain);
      if (f != null) {
        const risk = round2(raiseOpt.to - s.streetBet[hero]);
        const need = alpha(P, risk);
        const whose = s.log.some(x => x.seat === villain) ? 'of the range he has shown' : 'of his hands';
        notes.push(`${agent.name ?? 'He'} folds ${Math.round(100 * f)}% ${whose} to a raise to ${raiseOpt.to}bb; a pure bluff needs ${Math.round(100 * need)}%.`);
        if (f > need + 0.05 && chart !== 'raise') {
          m.forEach((o, i) => { if (o === raiseOpt) fine.add(i); });
          notes.push('So raising any two cards profits here: the exploit.');
        }
      }
    }
  }
  const shove = options.find(o => o.type === 'allin' && o.ev != null);
  if (shove && !facingAllIn) notes.push(`Shoving ${shove.to}bb: he folds ${Math.round(100 * (shove.info.fold ?? 0))}%, and it is worth ${shove.ev >= 0 ? '+' : ''}${shove.ev}bb.`);
  notes.push(`${key} is in the top ${Math.round(100 * PCT[key])}% of hands.`);

  if (facingAllIn) {
    // a pure EV decision: fold or call
    const best = options.reduce((a, o, i) => (o.ev != null && o.ev > (options[a].ev ?? -Infinity) ? i : a), 0);
    const tol = Math.max(0.1, 0.02 * P);
    return {
      street: 0, preflop: true, evGraded: true, chart: options[best].type, options, best,
      fine: options.map((o, i) => (o.ev != null && options[best].ev - o.ev <= tol ? i : -1)).filter(i => i >= 0),
      notes, facing: true, tol,
    };
  }
  const best = m.findIndex(o => kind(o) === chart);
  return {
    street: 0,
    preflop: true,
    chart,
    options,
    best: best >= 0 ? best : 0,
    fine: [...fine],
    notes,
    facing: L.facing,
    // an off-chart choice costs what the EV model says the chart play was worth over it, at least this
    nominal: round2(Math.max(0.25, 0.15 * P)),
  };
}

export { CLASSES };

// ------------------------------------------------------------------ your whole range

/**
 * The best action for every hand in the hero's range at this node (postflop): "think in
 * ranges". The hero's range is the bot's read of you (thinking bots) or what a solid regular
 * would have on this line (profile bots). Returns { weights, best: Int8Array (option index per
 * combo, −1 if not in range), options, inRange (is your actual hand in that range?) }.
 */
export function rangeView(s, hero, agentOrId) {
  const agent = typeof agentOrId === 'string' ? { id: agentOrId, kind: 'profile' } : agentOrId;
  if (s.street === 0) return null;
  const villain = 1 - hero;
  const bd = board(s);
  const w = villainRange(s, villain, agent);
  const W = sumW(w);
  if (!(W > 0)) return null;
  // the hero's range: the thinking bot's read, else a Reg's range on this line
  let hr;
  if (agent.kind === 'thinker') {
    const read = readOpponent(agent.model, s, hero, replay);
    hr = new Float64Array(w.length);
    for (const t of Object.keys(read)) for (let i = 0; i < hr.length; i++) hr[i] += read[t][i];
  } else {
    // (not villainRange: that would remove his hole cards from your range and leak them)
    hr = new Float64Array(w.length).fill(1);
    const reg = { id: 'reg', kind: 'profile' };
    for (const { before, entry } of replay(s)) {
      if (entry.seat !== hero) continue;
      const p = actionProb(reg, before, entry);
      for (let i = 0; i < hr.length; i++) hr[i] *= p[i];
    }
  }
  const dead = new Set(bd);
  for (let i = 0; i < hr.length; i++) { const [a, b] = ALL_COMBOS[i]; if (dead.has(a) || dead.has(b)) hr[i] = 0; }
  const P = pot(s);
  const L = legal(s);
  const eqAll = equityVsRange(w, bd);
  const opts = menu(s);
  const EV = opts.map(() => new Float64Array(w.length));
  const tot = (arr) => { let x = 0; for (let i = 0; i < arr.length; i++) x += arr[i]; return x; };
  opts.forEach((m, k) => {
    const E = EV[k];
    if (m.type === 'fold') return;
    if (m.type === 'call') { const C = L.callAmount; for (let i = 0; i < E.length; i++) E[i] = nz(eqAll[i]) * (P + C) - C; return; }
    const s2 = act(s, m);
    if (m.type === 'check') {
      if (s2.done || s2.street !== s.street) { for (let i = 0; i < E.length; i++) E[i] = nz(eqAll[i]) * P; return; }
      const pol = policyAll(agent, s2);
      pol.opts.forEach((o, j) => {
        const wk = new Float64Array(w.length);
        for (let i = 0; i < w.length; i++) wk[i] = w[i] * pol.P[j][i];
        const mk = tot(wk) / W;
        if (mk < 1e-6) return;
        const eqk = equityVsRange(wk, bd);
        if (o.type === 'check') for (let i = 0; i < E.length; i++) E[i] += mk * nz(eqk[i]) * P;
        else {
          const b = Math.min(o.to, s.stacks[hero]);
          for (let i = 0; i < E.length; i++) E[i] += mk * Math.max(0, nz(eqk[i]) * (P + 2 * b) - b);
        }
      });
      return;
    }
    const A = m.to - s.streetBet[hero];
    if (s2.done) { for (let i = 0; i < E.length; i++) E[i] = nz(eqAll[i]) * (P + A) - A; return; }
    const add = Math.min(s2.stacks[villain], m.to - s2.streetBet[villain]);
    const pf = probOf(policyAll(agent, s2), { type: 'fold' });
    const wc = new Float64Array(w.length);
    for (let i = 0; i < w.length; i++) wc[i] = w[i] * (1 - pf[i]);
    const cont = tot(wc) / W;
    const eqc = cont > 1e-6 ? equityVsRange(wc, bd) : null;
    for (let i = 0; i < E.length; i++) E[i] = (1 - cont) * P + (cont > 1e-6 ? cont * (nz(eqc[i]) * (P + A + add) - A) : 0);
  });
  // best play per hand; within 2% of the pot, prefer the simpler (earlier, less aggressive) option
  const tol = Math.max(0.1, 0.02 * P);
  const best = new Int8Array(w.length).fill(-1);
  for (let i = 0; i < w.length; i++) {
    if (!(hr[i] > 0)) continue;
    let mx = -Infinity;
    for (let k = 0; k < opts.length; k++) mx = Math.max(mx, EV[k][i]);
    let b = 0;
    while (b < opts.length - 1 && EV[b][i] < mx - tol) b++;
    best[i] = b;
  }
  const [h1, h2] = s.holes[hero];
  const me = ALL_COMBOS.findIndex(([a, b]) => (a === h1 && b === h2) || (a === h2 && b === h1));
  let nz0 = 0;
  for (let i = 0; i < hr.length; i++) if (hr[i] > 0) nz0++;
  const mean = tot(hr) / Math.max(1, nz0);
  return { weights: hr, best, options: opts.map(o => ({ type: o.type, to: o.to, label: o.label })), inRange: hr[me] >= 0.05 * mean, me };
}

const nz = (x) => (Number.isNaN(x) ? 0 : x);
