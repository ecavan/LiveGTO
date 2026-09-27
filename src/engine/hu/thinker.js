/**
 * Thinking bots: they play every hand by expected value against a *read* of your range, and
 * they update that read as you play.
 *
 * 1. Who are you? The bot keeps a belief π over player types it knows (reg, station, nit,
 *    maniac, whale, and "random": anything goes). Each type is a full strategy (policy.js).
 * 2. What do you have? Joint posterior over (type, hand) from everything you did this hand:
 *        w_t(h) ∝ π_t · Π_actions P_t(action | h)
 *    Your range is Σ_t w_t(h). At the end of the hand π_t ← Σ_h w_t(h), or, if you showed
 *    down, ∝ w_t(your hand). Shove 3-high twice and "random" takes over: he calls you down.
 * 3. What is each option worth, for every hand he could hold? One street ahead, with your
 *    responses predicted by the same type mixture:
 *        call    ρ·eq·(P+C) − C
 *        bet x   F·P + (1−F)·(ρ·eq_c·(P+x+y) − x)      F = your fold share, eq_c vs your calls
 *        check   ends street: ρ·eq·P;  else your bet mix, then his best reply (call or fold)
 *    ρ = equity realisation (1 on the river).
 * 4. Then a quantal response, p(a) ∝ exp(EV_a / (τ·pot)): nearly pure for a strong bot,
 *    noisier for a weaker one. Every combo's policy is computed at once, so the coach can
 *    read *his* range exactly the same way.
 */
import { ALL_COMBOS, handType } from './hand.js';
import { act, pot, legal, board, BTN } from './game.js';
import { N, equityVsRange } from './equity.js';
import { profilePolicyAll, randomPolicyAll, keyedMenu, probOf, HT, classesOn, stateKey } from './policy.js';
import { preflopDistKey } from './bots.js';

export const HERO_TYPES = ['reg', 'tag', 'station', 'nit', 'maniac', 'whale', 'random'];
export const PRIOR = { reg: 0.3, tag: 0.15, station: 0.18, nit: 0.1, maniac: 0.1, whale: 0.09, random: 0.08 };
const MAX_RANDOM = 0.4; // 'random' fits anything a little: never let it take over the read

/** Fresh belief about the opponent. */
export function newModel(prior = PRIOR) {
  return { pi: { ...prior }, hands: 0, showdowns: 0 };
}

const polMemo = new Map();
function typePolicy(t, s) {
  const k = t + '#' + stateKey(s);
  let v = polMemo.get(k);
  if (!v) {
    v = t === 'random' ? randomPolicyAll(s) : profilePolicyAll(t, s, s.toAct);
    polMemo.set(k, v);
    if (polMemo.size > 400) polMemo.delete(polMemo.keys().next().value);
  }
  return v;
}

/**
 * Replay the hand to the bot's belief at state `s`: per type, weights over the opponent's
 * combos (unnormalised joint posterior). `oppSeat` is the player being read.
 */
export function readOpponent(model, s, oppSeat, replayFn) {
  const w = {};
  for (const t of HERO_TYPES) w[t] = new Float64Array(N).fill(model.pi[t] ?? 0);
  for (const { before, entry } of replayFn(s)) {
    if (entry.seat !== oppSeat) continue;
    let tot = 0;
    for (const t of HERO_TYPES) {
      if (!(model.pi[t] > 0)) continue;
      const p = probOf(typePolicy(t, before), entry);
      const wt = w[t];
      for (let i = 0; i < N; i++) { wt[i] *= p[i]; tot += wt[i]; }
    }
    if (tot > 0) for (const t of HERO_TYPES) { const wt = w[t]; for (let i = 0; i < N; i++) wt[i] /= tot; }
  }
  // the board blocks
  const bd = board(s);
  if (bd.length) {
    const dead = new Set(bd);
    for (const t of HERO_TYPES) ALL_COMBOS.forEach(([a, b], i) => { if (dead.has(a) || dead.has(b)) w[t][i] = 0; });
  }
  return w;
}

const sumArr = (a) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; };

/** Opponent's response to a node, as combo weights per abstract response. */
function responses(w, s2) {
  const out = new Map(); // option index -> { opt, W }
  const pols = {};
  for (const t of HERO_TYPES) if (sumArr(w[t]) > 0) pols[t] = typePolicy(t, s2);
  const opts = keyedMenu(s2);
  opts.forEach((o, k) => {
    const W = new Float64Array(N);
    for (const t of Object.keys(pols)) {
      const p = probOf(pols[t], o);
      const wt = w[t];
      for (let i = 0; i < N; i++) W[i] += wt[i] * p[i];
    }
    out.set(k, { opt: o, W });
  });
  return out;
}

/**
 * The thinking bot's policy for every combo at node `s` (bot to act).
 * `cfg` = { tau, realise: [flop, turn] for IP/OOP }. Returns { opts, P, ev }.
 */
export function thinkerPolicyAll(cfg, model, s, replayFn, selfPolicy = null) {
  const me = s.toAct;
  const opp = 1 - me;
  const L = legal(s);
  const P0 = pot(s);
  const bd = board(s);
  // Deep preflop, a 100bb shove is never part of a sane strategy (it only "works" against an
  // opponent model that folds too much). Keep all-ins for short stacks or big pots.
  // Postflop the same: shove only when it is at most ~2.5× the pot (a natural all-in), not
  // as a 20× overbet.
  const opts = keyedMenu(s).filter(o => {
    if (o.type !== 'allin') return true;
    if (s.street === 0) return !(L.maxTo > 25 && L.maxTo > 3 * (s.streetBet[opp] + P0));
    return o.to - s.streetBet[me] <= 2.5 * P0 + 1e-9;
  });

  // preflop: the Reg chart (unless cfg.preflopEV), except against big bets, where equity decides
  if (s.street === 0 && !cfg.preflopEV && !(L.facing && L.callAmount >= 10)) {
    return preflopChart(s, me);
  }

  const w = readOpponent(model, s, opp, replayFn);
  const W = new Float64Array(N);
  for (const t of HERO_TYPES) { const wt = w[t]; for (let i = 0; i < N; i++) W[i] += wt[i]; }
  const Wtot = sumArr(W);
  if (!(Wtot > 0)) return preflopChartOrUniform(s, me, opts);
  const ip = me === BTN;
  const rho = s.street === 3 ? 1 : s.street === 0 ? (ip ? 0.95 : 0.8) : (cfg.realise?.[ip ? 0 : 1] ?? (ip ? 0.97 : 0.9));
  const eqCache = new Map();
  const eqVs = (Wsub, tag) => {
    if (!eqCache.has(tag)) eqCache.set(tag, equityVsRange(Wsub, bd, { perTurn: s.street === 0 ? 4 : 3 }));
    return eqCache.get(tag);
  };
  const eqAll = eqVs(W, 'all');

  const ev = opts.map(() => new Float64Array(N));
  const info = opts.map(() => ({})); // per option: fold share, equity-when-called array (for commentary)
  opts.forEach((o, k) => {
    const E = ev[k];
    if (o.type === 'fold') return; // 0
    if (o.type === 'call' || o.type === 'check') {
      // passive: we put in c now; the street may end, or he may still act (our check OOP,
      // a limp, the BB's option)
      const c = o.type === 'call' ? L.callAmount : 0;
      const s2 = act(s, { type: o.type });
      const P1 = P0 + c;
      if (s2.done || s2.street !== s.street) {
        const r = s2.done ? 1 : rho; // called all-in: equity is realised exactly
        for (let i = 0; i < N; i++) E[i] = r * nz(eqAll[i]) * P1 - c;
        return;
      }
      const R = responses(w, s2);
      for (const [kk, { opt, W: Wk }] of R) {
        const m = sumArr(Wk) / Wtot;
        if (m < 1e-6) continue;
        const eqk = eqVs(Wk, 'x' + k + '_' + kk);
        if (opt.type === 'check' || opt.type === 'call' || opt.type === 'fold') {
          for (let i = 0; i < N; i++) E[i] += m * (rho * nz(eqk[i]) * P1 - c);
        } else {
          const a = opt.to - s2.streetBet[opp]; // what he adds
          const d = Math.min(opt.to - s2.streetBet[me], s2.stacks[me]); // what we add to call
          const r = d >= s2.stacks[me] - 1e-9 ? 1 : rho;
          for (let i = 0; i < N; i++) E[i] += m * Math.max(-c, r * nz(eqk[i]) * (P1 + a + d) - c - d);
        }
      }
      return;
    }
    // bet / raise / all-in
    const s2 = act(s, { type: o.type, to: o.to });
    const x = o.to - s.streetBet[me];
    if (s2.done) { // e.g. all-in that is called automatically (never happens), treat as call-down
      for (let i = 0; i < N; i++) E[i] = nz(eqAll[i]) * (P0 + x) - x;
      return;
    }
    const y = Math.min(s2.stacks[opp], o.to - s2.streetBet[opp]);
    const R = responses(w, s2);
    const Wc = new Float64Array(N);
    for (const [, { opt, W: Wk }] of R) if (opt.type !== 'fold') for (let i = 0; i < N; i++) Wc[i] += Wk[i];
    const cont = sumArr(Wc) / Wtot;
    const F = 1 - cont;
    const r2 = s.street === 3 || s2.stacks[me] <= 1e-9 ? 1 : rho;
    const eqc = cont > 1e-6 ? eqVs(Wc, 'c' + k) : null;
    info[k] = { fold: F, eqc };
    for (let i = 0; i < N; i++) E[i] = F * P0 + (cont > 1e-6 ? cont * (r2 * nz(eqc[i]) * (P0 + x + y) - x) : 0);
  });

  // quantal response
  const tau = Math.max(0.05, cfg.tau * P0);
  const P = opts.map(() => new Float64Array(N));
  const blocked = bd.length ? classesOn(bd) : null;
  for (let i = 0; i < N; i++) {
    if (blocked && blocked[i] < 0) continue;
    let mx = -Infinity;
    for (let k = 0; k < opts.length; k++) mx = Math.max(mx, ev[k][i]);
    let z = 0;
    for (let k = 0; k < opts.length; k++) { const e = Math.exp((ev[k][i] - mx) / tau); P[k][i] = e; z += e; }
    for (let k = 0; k < opts.length; k++) P[k][i] /= z;
  }

  // Defence floor against overbets and shoves: keep at least the top MDF share of our own range
  // (by equity), so an any-two-cards shove never prints just because the read says he's honest.
  const B = L.facing ? L.callAmount : 0;
  const Pb = P0 - B;
  if (selfPolicy && B >= 1.5 * Pb) {
    const ws = new Float64Array(N).fill(1);
    for (const { before, entry } of replayFn(s)) {
      if (entry.seat !== me) continue;
      const p = probOf(selfPolicy(before), entry);
      for (let i = 0; i < N; i++) ws[i] *= p[i];
    }
    if (blocked) for (let i = 0; i < N; i++) if (blocked[i] < 0) ws[i] = 0;
    const tot = sumArr(ws);
    const kFold = opts.findIndex(o => o.type === 'fold');
    const kCall = opts.findIndex(o => o.type === 'call');
    if (tot > 0 && kFold >= 0 && kCall >= 0) {
      const mdf = Pb / (Pb + B);
      const order = [...Array(N).keys()].filter(i => ws[i] > 0).sort((a, b) => nz(eqAll[b]) - nz(eqAll[a]));
      let acc = 0;
      for (const i of order) {
        if (acc >= mdf * tot) break;
        acc += ws[i];
        P[kCall][i] += P[kFold][i];
        P[kFold][i] = 0;
      }
    }
  }
  return { opts, P, ev, eq: eqAll, info };
}

const nz = (x) => (Number.isNaN(x) ? 0 : x);

function preflopChart(s, me) {
  const keys = [...new Set(HT)];
  const byKey = new Map(keys.map(k => [k, preflopDistKey('reg', s, me, k)]));
  const opts = [];
  const P = [];
  for (let i = 0; i < N; i++) {
    for (const o of byKey.get(HT[i])) {
      let k = opts.findIndex(x => x.type === o.type && (x.to ?? -1) === (o.to ?? -1));
      if (k < 0) { k = opts.length; opts.push({ type: o.type, to: o.to, label: o.label, key: o.key }); P.push(new Float64Array(N)); }
      P[k][i] += o.p;
    }
  }
  return { opts, P };
}

function preflopChartOrUniform(s, me, opts) {
  if (s.street === 0) return preflopChart(s, me);
  const P = opts.map(() => new Float64Array(N).fill(1 / opts.length));
  return { opts, P };
}

/**
 * After a hand: update π from what the opponent did (and showed).
 * `adaptive` false keeps the prior (a bot that never learns).
 */
export function learn(model, s, oppSeat, replayFn, { adaptive = true, forget = 0.03, rate = 0.5 } = {}) {
  model.hands++;
  if (!adaptive) return model;
  const w = readOpponent(model, s, oppSeat, replayFn);
  const post = {};
  let tot = 0;
  const shown = s.result?.showdown;
  let heroIdx = -1;
  if (shown) {
    const [a, b] = s.holes[oppSeat];
    heroIdx = ALL_COMBOS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
    model.showdowns++;
  }
  for (const t of HERO_TYPES) {
    // tempered likelihood (^rate): one hand is weak evidence, the types are only approximations,
    // and a slow learner (low rate) needs many hands to change its mind
    const pt = model.pi[t] || 0;
    const like = pt > 0 ? (shown ? w[t][heroIdx] : sumArr(w[t])) / pt : 0; // w_t carries π_t
    post[t] = pt * Math.pow(like, rate);
    tot += post[t];
  }
  if (!(tot > 0)) return model;
  for (const t of HERO_TYPES) model.pi[t] = (1 - forget) * (post[t] / tot) + forget * PRIOR[t];
  if (model.pi.random > MAX_RANDOM) {
    const extra = model.pi.random - MAX_RANDOM;
    model.pi.random = MAX_RANDOM;
    const rest = HERO_TYPES.filter(t => t !== 'random');
    const rs = rest.reduce((a, t) => a + model.pi[t], 0);
    for (const t of rest) model.pi[t] += extra * (rs > 0 ? model.pi[t] / rs : 1 / rest.length);
  }
  return model;
}

/** Most likely type and its probability, for display ("He has you pegged as: Maniac 64%"). */
export function topRead(model) {
  let best = 'reg';
  for (const t of HERO_TYPES) if (model.pi[t] > model.pi[best]) best = t;
  return { type: best, p: model.pi[best] };
}

export { handType };
