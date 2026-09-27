/**
 * Range-vs-range equity, fast enough to run inside a bot's decision.
 *
 * For a board we fix a set of runouts (all rivers on the turn; a seeded, stratified sample on
 * the flop; none on the river) and evaluate every one of the 1326 combos on each runout once.
 * Then the equity of *every* combo against a weighted range is one sorted sweep per runout:
 *
 *   eq(i) = Σ_runouts Σ_{j disjoint from i} w_j·[v_i > v_j] + ½·w_j·[v_i = v_j]
 *           ─────────────────────────────────────────────────────────────────
 *                        Σ_runouts Σ_{j disjoint from i} w_j
 *
 * "Disjoint" (card removal) costs nothing extra: running totals per card let us subtract the
 * combos that share a card with i. So a new range on the same board is ~1ms, not a Monte Carlo.
 * With every runout enumerated (turn, river) the result is exact.
 */
import { ALL_COMBOS, straightHigh } from './hand.js';

export const N = ALL_COMBOS.length; // 1326
export const CA = Int8Array.from(ALL_COMBOS, c => c[0]);
export const CB = Int8Array.from(ALL_COMBOS, c => c[1]);
const IDX = new Int16Array(52 * 52).fill(-1);
ALL_COMBOS.forEach(([a, b], i) => { IDX[a * 52 + b] = i; IDX[b * 52 + a] = i; });

/** Index of the combo holding cards a and b. */
export const comboIndex = (a, b) => IDX[a * 52 + b];

// ------------------------------------------------------------------ fast evaluator

const cnt = new Int8Array(13);
const sm = new Int32Array(4);

function pop(x) {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Same value as hand.js `evaluate` (tested), without allocating. `cards` is any array-like,
 * `n` how many of its first entries to use (5–7).
 */
export function evalFast(cards, n) {
  cnt.fill(0);
  sm[0] = sm[1] = sm[2] = sm[3] = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    cnt[c >> 2]++;
    sm[c & 3] |= 1 << (c >> 2);
  }
  let flush = -1;
  for (let s = 0; s < 4; s++) {
    if (pop(sm[s]) >= 5) {
      const h = straightHigh(sm[s]);
      if (h >= 0) return (8 << 20) | (h << 16);
      flush = sm[s];
    }
  }
  let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1, p3 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = cnt[r];
    if (k === 4) q = r;
    else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; else if (p3 < 0) p3 = r; }
  }
  // highest ranks present, skipping up to two ranks
  const top = (skipA, skipB, howMany) => {
    let v = 0, got = 0;
    for (let r = 12; r >= 0 && got < howMany; r--) {
      if (cnt[r] > 0 && r !== skipA && r !== skipB) { v = (v << 4) | r; got++; }
    }
    return v << (4 * (howMany - got));
  };
  if (q >= 0) return (7 << 20) | (q << 16) | (top(q, -1, 1) << 12);
  if (t1 >= 0) {
    const pr = Math.max(t2, p1);
    if (pr >= 0) return (6 << 20) | (t1 << 16) | (pr << 12);
  }
  if (flush >= 0) {
    let v = 0, got = 0;
    for (let r = 12; r >= 0 && got < 5; r--) if (flush & (1 << r)) { v = (v << 4) | r; got++; }
    return (5 << 20) | v;
  }
  const rm = sm[0] | sm[1] | sm[2] | sm[3];
  const sh = straightHigh(rm);
  if (sh >= 0) return (4 << 20) | (sh << 16);
  if (t1 >= 0) return (3 << 20) | (t1 << 16) | (top(t1, -1, 2) << 8);
  if (p2 >= 0) return (2 << 20) | (p1 << 16) | (p2 << 12) | (top(p1, p2, 1) << 8);
  if (p1 >= 0) return (1 << 20) | (p1 << 16) | (top(p1, -1, 3) << 4);
  return top(-1, -1, 5);
}

// ------------------------------------------------------------------ boards

/** Deterministic PRNG seeded from the board, so the bot and the coach see the same runouts. */
function seeded(board) {
  let a = 0x9e3779b9;
  for (const c of board) a = Math.imul(a ^ (c + 1), 0x85ebca6b) ^ (a >>> 13);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runouts to complete `board` to five cards. Flop: every turn card, each with `perTurn` rivers. */
function runoutsFor(board, perTurn) {
  const dead = new Set(board);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
  if (board.length === 5) return [[]];
  if (board.length < 3) {
    // preflop: a seeded sample of complete boards (perTurn × 100 of them)
    const rand = seeded(board.length ? board : [99]);
    const out = [];
    const need = 5 - board.length;
    for (let k = 0; k < perTurn * 100; k++) {
      const pick = new Set();
      while (pick.size < need) pick.add(deck[Math.floor(rand() * deck.length)]);
      out.push([...pick]);
    }
    return out;
  }
  if (board.length === 4) return deck.map(c => [c]);
  const rand = seeded(board);
  const out = [];
  for (const t of deck) {
    const rest = deck.filter(c => c !== t);
    // perTurn distinct rivers without replacement
    const picks = new Set();
    while (picks.size < Math.min(perTurn, rest.length)) picks.add(rest[Math.floor(rand() * rest.length)]);
    for (const r of picks) out.push([t, r]);
  }
  return out;
}

/**
 * Evaluate all combos on all runouts of `board`, once. Cached (a few boards) because a hand
 * asks for many equities on the same board.
 * Returns { board, R: runouts, vals: Int32Array[R·N] (−1 = combo blocked), order: Int16Array[R·N]
 *           (combo indices sorted by value; blocked combos first) }.
 */
const cache = new Map();
export function boardCtx(board, { perTurn = 3 } = {}) {
  const key = board.join(',') + '|' + perTurn;
  if (cache.has(key)) return cache.get(key);
  const runs = runoutsFor(board, perTurn);
  const R = runs.length;
  const vals = new Int32Array(R * N);
  const order = new Int16Array(R * N);
  const cards = new Int32Array(7);
  for (let i = 0; i < board.length; i++) cards[i] = board[i];
  const idx = Array.from({ length: N }, (_, i) => i);
  for (let r = 0; r < R; r++) {
    const run = runs[r];
    for (let k = 0; k < run.length; k++) cards[board.length + k] = run[k];
    const deadMask = new Uint8Array(52);
    for (let k = 0; k < 5; k++) deadMask[cards[k]] = 1;
    const base = r * N;
    for (let i = 0; i < N; i++) {
      const a = CA[i], b = CB[i];
      if (deadMask[a] || deadMask[b]) { vals[base + i] = -1; continue; }
      cards[5] = a; cards[6] = b;
      vals[base + i] = evalFast(cards, 7);
    }
    idx.sort((x, y) => vals[base + x] - vals[base + y]);
    for (let i = 0; i < N; i++) order[base + i] = idx[i];
  }
  const ctx = { board: [...board], R, runs, vals, order };
  cache.set(key, ctx);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return ctx;
}

/**
 * Equity of every combo against the weighted range `w` (Float64Array[N]) on `board`.
 * Returns Float64Array[N]; NaN where the combo is blocked by the board or nothing is left.
 */
export function equityVsRange(w, board, opts) {
  const ctx = boardCtx(board, opts);
  const { R, vals, order } = ctx;
  const num = new Float64Array(N);
  const den = new Float64Array(N);
  const cardBelow = new Float64Array(52);
  const cardTie = new Float64Array(52);
  const cardAll = new Float64Array(52);
  for (let r = 0; r < R; r++) {
    const base = r * N;
    cardBelow.fill(0);
    cardAll.fill(0);
    let W = 0;
    for (let i = 0; i < N; i++) {
      const wi = w[i];
      if (wi > 0 && vals[base + i] >= 0) { W += wi; cardAll[CA[i]] += wi; cardAll[CB[i]] += wi; }
    }
    if (W <= 0) continue;
    let below = 0;
    let k = 0;
    while (k < N && vals[base + order[base + k]] < 0) k++;
    while (k < N) {
      const v = vals[base + order[base + k]];
      let end = k;
      let tie = 0;
      while (end < N && vals[base + order[base + end]] === v) {
        const j = order[base + end];
        const wj = w[j];
        if (wj > 0) { tie += wj; cardTie[CA[j]] += wj; cardTie[CB[j]] += wj; }
        end++;
      }
      for (let m = k; m < end; m++) {
        const i = order[base + m];
        const a = CA[i], b = CB[i];
        const wi = w[i] > 0 ? w[i] : 0;
        const tot = W - cardAll[a] - cardAll[b] + wi;
        if (tot <= 1e-12) continue;
        const bel = below - cardBelow[a] - cardBelow[b];
        const ti = tie - cardTie[a] - cardTie[b] + wi;
        num[i] += bel + 0.5 * ti;
        den[i] += tot;
      }
      for (let m = k; m < end; m++) {
        const j = order[base + m];
        const wj = w[j];
        if (wj > 0) {
          cardBelow[CA[j]] += wj; cardBelow[CB[j]] += wj;
          cardTie[CA[j]] = 0; cardTie[CB[j]] = 0;
        }
      }
      below += tie;
      k = end;
    }
  }
  const eq = new Float64Array(N);
  for (let i = 0; i < N; i++) eq[i] = den[i] > 0 ? num[i] / den[i] : NaN;
  return eq;
}

/** Weighted average of `x` under weights `w` (skipping NaN). */
export function wavg(x, w) {
  let s = 0, t = 0;
  for (let i = 0; i < N; i++) if (w[i] > 0 && !Number.isNaN(x[i])) { s += w[i] * x[i]; t += w[i]; }
  return t > 0 ? s / t : NaN;
}

/** Zero the combos that use any of `cards`. Returns a new array. */
export function removeCards(w, cards) {
  const out = Float64Array.from(w);
  const dead = new Uint8Array(52);
  for (const c of cards) dead[c] = 1;
  for (let i = 0; i < N; i++) if (dead[CA[i]] || dead[CB[i]]) out[i] = 0;
  return out;
}
