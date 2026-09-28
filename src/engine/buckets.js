/**
 * Hand buckets: how players think after the flop. Instead of 1,326 combos, a handful of kinds of
 * hand, each with one plan: "sets and two pair: bet big; flush draws: bet small; air: give up".
 *
 * Built on the live-player classes (hand.js classify, the same ones the bots and the solver use),
 * with two refinements that matter at the table:
 *   - Monsters split by the board: a set or two pair is "big but vulnerable" when a flush or a
 *     straight is already possible, or the board is paired (a full house beats it). Same hand, a
 *     different plan: you can't always get it all in.
 *   - Draws split into flush draws and straight draws (open-enders).
 */
import { classify, evaluate, category, CAT, rank, suit, ALL_COMBOS, handType } from './hu/hand.js';
import { N } from './hu/equity.js';
import { cardStr } from './hu/hand.js';
import { boardTags } from './texture.js';

export const BUCKETS = [
  { key: 'nutted', name: 'Monsters', desc: 'sets, two pair, straights, flushes' },
  { key: 'vulnerable', name: 'Big but vulnerable', desc: 'strong, but the board can beat it' },
  { key: 'strong', name: 'Strong pairs', desc: 'overpairs, top pair good kicker, weaker two pair' },
  { key: 'medium', name: 'Medium pairs', desc: 'top pair weak kicker, second pair' },
  { key: 'weak', name: 'Weak pairs', desc: 'third pair, small pocket pairs' },
  { key: 'fdraw', name: 'Flush draws', desc: 'four to a flush (with or without a straight draw)' },
  { key: 'sdraw', name: 'Straight draws', desc: 'open-enders' },
  { key: 'air', name: 'Air', desc: 'gutshots, overcards, nothing' },
];
export const BUCKET_KEYS = BUCKETS.map(b => b.key);
export const BUCKET = Object.fromEntries(BUCKETS.map(b => [b.key, b]));

/** The 6 live classes (library records) shown as buckets: monster → Monsters, draw → Draws. */
export const CLASS_AS_BUCKET = {
  monster: { key: 'nutted', name: 'Monsters', desc: 'sets, straights, flushes, top two pair' },
  strong: BUCKET.strong, medium: BUCKET.medium, weak: BUCKET.weak,
  draw: { key: 'draw', name: 'Draws', desc: 'flush draws, open-enders' },
  air: BUCKET.air,
};

const maxSuitCount = (board) => { const c = [0, 0, 0, 0]; for (const x of board) c[suit(x)]++; return Math.max(...c); };

/** Most distinct ranks of the board inside any 5-rank window (3+ = a straight is possible). */
function maxInWindow(board) {
  let m = 0;
  for (const c of board) m |= 1 << (rank(c) + 1); // bit r+1 = rank r
  if (m & (1 << 13)) m |= 1; // the ace plays low too
  let best = 0;
  for (let lo = 0; lo <= 9; lo++) {
    let n = 0;
    for (let k = 0; k < 5; k++) if (m & (1 << (lo + k))) n++;
    best = Math.max(best, n);
  }
  return best;
}

/** What on this board could beat a made hand: flush / straight / full house possible. */
export function boardDangers(board) {
  const d = [];
  const ms = maxSuitCount(board);
  if (ms >= 3) d.push(ms >= 4 ? 'four to a flush' : 'flush possible');
  if (maxInWindow(board) >= 3) d.push('straight possible');
  if (new Set(board.map(rank)).size < board.length) d.push('paired board');
  return d;
}

function hasFlushDraw(hole, board) {
  for (let s = 0; s < 4; s++) {
    const onBoard = board.filter(c => suit(c) === s).length;
    const inHand = hole.filter(c => suit(c) === s).length;
    if (inHand >= 1 && onBoard + inHand === 4) return true;
  }
  return false;
}

/** Why a monster is vulnerable here (empty = it isn't). */
export function vulnerability(hole, board) {
  const cat = category(evaluate([...hole, ...board]));
  const out = [];
  const ms = maxSuitCount(board);
  if (cat < CAT.FLUSH && ms >= 3) out.push('flush possible');
  if (cat === CAT.FLUSH && ms >= 4) {
    // a flush that isn't the nut flush on a four-flush board
    const s = [0, 1, 2, 3].find(x => board.filter(c => suit(c) === x).length >= 4);
    const mine = Math.max(...hole.filter(c => suit(c) === s).map(rank), -1);
    if (mine < 12) out.push('four to a flush');
  }
  if (cat < CAT.STRAIGHT && maxInWindow(board) >= 3) out.push('straight possible');
  if (cat < CAT.FULL_HOUSE && new Set(board.map(rank)).size < board.length) out.push('paired board');
  return out;
}

/** The bucket of one hand on a board (3–5 cards). */
export function bucketOf(hole, board) {
  const cls = classify(hole, board);
  if (cls === 'monster') return vulnerability(hole, board).length ? 'vulnerable' : 'nutted';
  if (cls === 'draw') return hasFlushDraw(hole, board) ? 'fdraw' : 'sdraw';
  return cls;
}

const cache = new Map();
/** Bucket index (into BUCKETS) of every combo on `board`; −1 if it uses a board card. */
export function bucketsOn(board) {
  const key = board.join(',');
  if (cache.has(key)) return cache.get(key);
  const dead = new Set(board);
  const out = new Int8Array(N);
  ALL_COMBOS.forEach((c, i) => { out[i] = dead.has(c[0]) || dead.has(c[1]) ? -1 : BUCKET_KEYS.indexOf(bucketOf(c, board)); });
  cache.set(key, out);
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  return out;
}

const CAT_WORD = { [CAT.TWO_PAIR]: 'two pair', [CAT.TRIPS]: 'sets and trips', [CAT.STRAIGHT]: 'straights', [CAT.FLUSH]: 'flushes', [CAT.FULL_HOUSE]: 'full houses', [CAT.QUADS]: 'quads', [CAT.STRAIGHT_FLUSH]: 'straight flushes' };

/** Description of a bucket on this board, from what's actually in it. */
function describe(key, board, idx, w) {
  if (key !== 'nutted' && key !== 'vulnerable') return BUCKET[key].desc;
  const by = {};
  for (const i of idx) { const c = category(evaluate([...ALL_COMBOS[i], ...board])); by[c] = (by[c] || 0) + w[i]; }
  const words = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c]) => CAT_WORD[c]).filter(Boolean).slice(0, 3).join(', ');
  return key === 'vulnerable' ? `${words}; but ${boardDangers(board).join(', ')}` : words;
}

/** The three most common hand types (by weight) among combos `idx`. */
function examples(idx, w) {
  const by = new Map();
  for (const i of idx) { const k = handType(ALL_COMBOS[i]); by.set(k, (by.get(k) || 0) + w[i]); }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

/**
 * A range (weights over the 1326 combos) by bucket: [{ key, name, desc, share, examples }], in
 * bucket order, buckets under `min` of the range left out.
 */
export function composition(w, board, min = 0.005) {
  const b = bucketsOn(board);
  const idx = BUCKETS.map(() => []);
  let tot = 0;
  for (let i = 0; i < N; i++) if (w[i] > 0 && b[i] >= 0) { idx[b[i]].push(i); tot += w[i]; }
  if (!(tot > 0)) return [];
  return BUCKETS.map((B, k) => {
    const share = idx[k].reduce((a, i) => a + w[i], 0) / tot;
    return { key: B.key, name: B.name, desc: describe(B.key, board, idx[k], w), share, examples: examples(idx[k], w) };
  }).filter(r => r.share >= min);
}

/**
 * A plan by bucket: for your range `w` and the best option per combo (`best[i]`, −1 = not in the
 * range), each bucket's share of your range and how its hands split across the options.
 * Row: { key, name, desc, share, examples, mix: [share per option], best (option index), agree }
 * where `agree` = the share of the bucket that the best option is right for.
 */
export function plan(w, board, best, nOpts, min = 0.02) {
  const rows = composition(w, board, min);
  const b = bucketsOn(board);
  for (const r of rows) {
    const k = BUCKET_KEYS.indexOf(r.key);
    const mix = new Array(nOpts).fill(0);
    let t = 0;
    for (let i = 0; i < N; i++) if (b[i] === k && w[i] > 0 && best[i] >= 0) { mix[best[i]] += w[i]; t += w[i]; }
    r.mix = t > 0 ? mix.map(x => x / t) : mix;
    r.best = r.mix.reduce((a, x, j) => (x > r.mix[a] ? j : a), 0);
    r.agree = r.mix[r.best];
  }
  return rows.filter(r => r.mix.some(x => x > 0));
}

/** Bucket plan rows from a library record's class plans (the solver's classes). */
export function planFromClasses(classes) {
  return classes.filter(c => c.exploit.weight >= 0.02).map(c => {
    const B = CLASS_AS_BUCKET[c.class];
    const mix = c.exploit.pure;
    const best = mix.reduce((a, x, j) => (x > mix[a] ? j : a), 0);
    return { key: B.key, name: B.name, desc: B.desc, share: c.exploit.weight, examples: [], mix, best, agree: mix[best] };
  });
}

/** One-line reading of the board for bucket views ("flush possible · straight possible"). */
export const boardLine = (board) => { const t = boardTags(board.map(cardStr)); return t.length ? t.join(' · ') : 'dry: no flush or straight draws, unpaired'; };
