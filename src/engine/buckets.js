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
 *   - Air splits in two: air with equity (a gutshot, two overcards, or on the flop a backdoor
 *     flush or straight draw: your natural bluffs and barrels) and dead air (nothing to improve
 *     to: give up, or bluff only for a reason). On the river all air is just air.
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
  { key: 'eqair', name: 'Air with equity', desc: 'gutshots, two overcards, backdoor draws' },
  { key: 'air', name: 'Dead air', desc: 'no pair, no draw, nothing to improve to' },
];
export const BUCKET_KEYS = BUCKETS.map(b => b.key);

/** The default plan for each bucket, heads-up and multiway (Learn → Hand buckets, the drill). */
export const BUCKET_PLAN = {
  nutted: { hu: 'Build the pot: bet big, raise, get the stacks in. Slow down only on a dry board against someone who will bet for you.', mw: 'Bet big: someone will call. Raise when you\'re bet into.' },
  vulnerable: { hu: 'Bet for value and protection, usually big. If he raises on a scary board, slow down: you beat bluffs and worse, not the nuts.', mw: 'Bet big and charge the draws; be more careful when two players show strength.' },
  strong: { hu: 'Value-bet one or two streets; check-call against an aggressive player. Don\'t stack off against a nit\'s raise.', mw: 'Bet once for value and protection, then mostly pot control.' },
  medium: { hu: 'Showdown value: check, call a bet, rarely bet yourself. Bet thin in position against a station.', mw: 'Check and call small bets; fold to a bet and a raise.' },
  weak: { hu: 'Check and look for a cheap showdown; fold to big bets.', mw: 'Mostly check-fold: too many players to get to showdown cheaply.' },
  fdraw: { hu: 'Semi-bluff: bet, or raise his bet. You win when he folds and when you hit.', mw: 'Call when the price is right; bet when you\'re last to act and the table looks weak.' },
  sdraw: { hu: 'Semi-bluff like a flush draw (a little weaker: 8 outs).', mw: 'Call with a good price; a raise often isn\'t worth it with several players behind.' },
  eqair: { hu: 'Your best bluffs. C-bet these; barrel the turn when it gives you a draw or scares him. Against a station, bluff less.', mw: 'C-bet sometimes on dry boards; give up most of the time with two or more opponents.' },
  air: { hu: 'Give up: check and fold. Bluff only with a reason: a nit, a scare card, a blocker.', mw: 'Check and fold.' },
};
export const BUCKET = Object.fromEntries(BUCKETS.map(b => [b.key, b]));

/** The 6 live classes (library records) shown as buckets: monster → Monsters, draw → Draws. */
export const CLASS_AS_BUCKET = {
  monster: { key: 'nutted', name: 'Monsters', desc: 'sets, straights, flushes, top two pair' },
  strong: BUCKET.strong, medium: BUCKET.medium, weak: BUCKET.weak,
  draw: { key: 'draw', name: 'Draws', desc: 'flush draws, open-enders' },
  air: { key: 'air', name: 'Air', desc: 'no pair and no real draw' },
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
    // the nut card: the highest card of the suit that isn't on the board
    const onBoard = new Set(board.filter(c => suit(c) === s).map(rank));
    let nut = 12;
    while (onBoard.has(nut)) nut--;
    if (mine < nut) out.push('four to a flush');
  }
  if (cat < CAT.STRAIGHT && maxInWindow(board) >= 3) out.push('straight possible');
  if (cat < CAT.FULL_HOUSE && new Set(board.map(rank)).size < board.length) out.push('paired board');
  return out;
}

const rankMask = (cards) => cards.reduce((m, c) => m | (1 << rank(c)), 0);
/** Highest straight in a 13-bit rank mask, or −1 (the ace also plays low). */
function straightTop(m) {
  const w = (m << 1) | ((m >> 12) & 1); // bit 0 = ace low
  for (let top = 13; top >= 4; top--) if (((w >> (top - 4)) & 31) === 31) return top;
  return -1;
}

/** How many ranks would give a straight that uses a hole card (2 = open-ender or double gutshot). */
function straightRanks(hole, board) {
  const bm = rankMask(board), all = rankMask([...board, ...hole]);
  if (straightTop(all) >= 0) return 0;
  let n = 0;
  for (let r = 0; r < 13; r++) {
    if (all & (1 << r)) continue;
    const t = straightTop(all | (1 << r));
    if (t >= 0 && straightTop(bm | (1 << r)) !== t) n++;
  }
  return n;
}

/**
 * Why an unpaired, drawless hand still has equity (empty = dead air):
 *   gutshot              one rank away from a straight that uses a hole card
 *   two overcards        both hole cards above the board
 *   backdoor flush draw  (flop) three to a flush with a hole card, two more of the suit to come
 *   backdoor straight    (flop) both hole cards inside a 5-rank window with a board card
 */
export function airEquity(hole, board) {
  const out = [];
  if (board.length >= 5) return out;
  if (straightRanks(hole, board) >= 1) out.push('gutshot');
  const top = Math.max(...board.map(rank));
  if (rank(hole[0]) > top && rank(hole[1]) > top && rank(hole[0]) !== rank(hole[1])) out.push('two overcards');
  if (board.length === 3) {
    for (let x = 0; x < 4; x++) {
      const h = hole.filter(c => suit(c) === x).length;
      if (h >= 1 && h + board.filter(c => suit(c) === x).length === 3) { out.push('backdoor flush draw'); break; }
    }
    const lo = (r) => [r, r === 12 ? -1 : r]; // the ace plays high or low
    const [a, b] = hole.map(rank);
    let bds = false;
    for (const ra of lo(a)) for (const rb of lo(b)) {
      if (ra === rb || Math.abs(ra - rb) > 4) continue;
      for (const c of board) for (const rc of lo(rank(c))) {
        const r3 = [ra, rb, rc];
        if (new Set(r3).size === 3 && Math.max(...r3) - Math.min(...r3) <= 4) bds = true;
      }
    }
    if (bds) out.push('backdoor straight draw');
  }
  return out;
}

/** The bucket of one hand on a board (3–5 cards). */
export function bucketOf(hole, board) {
  const cls = classify(hole, board);
  if (cls === 'monster') return vulnerability(hole, board).length ? 'vulnerable' : 'nutted';
  if (cls === 'draw') return hasFlushDraw(hole, board) ? 'fdraw' : 'sdraw';
  if (cls === 'air') return airEquity(hole, board).length ? 'eqair' : 'air';
  return cls;
}

/** Why a hand is in its bucket, in a few words ("set, but flush possible", "backdoor flush draw · two overcards"). */
export function bucketWhy(hole, board) {
  const b = bucketOf(hole, board);
  const made = { [CAT.HIGH]: 'no pair', [CAT.PAIR]: 'a pair', [CAT.TWO_PAIR]: 'two pair', [CAT.TRIPS]: rank(hole[0]) === rank(hole[1]) ? 'a set' : 'trips', [CAT.STRAIGHT]: 'a straight', [CAT.FLUSH]: 'a flush', [CAT.FULL_HOUSE]: 'a full house', [CAT.QUADS]: 'quads', [CAT.STRAIGHT_FLUSH]: 'a straight flush' }[category(evaluate([...hole, ...board]))];
  if (b === 'vulnerable') return `${made}, but ${vulnerability(hole, board).join(', ')}`;
  if (b === 'nutted') return made;
  if (b === 'eqair') return airEquity(hole, board).join(' · ');
  if (b === 'fdraw' || b === 'sdraw') {
    const ranks = straightRanks(hole, board);
    const st = ranks >= 2 ? 'an open-ender' : ranks === 1 ? 'a gutshot' : '';
    if (b === 'sdraw') return 'an open-ender or double gutshot (8 outs)';
    return st ? `a flush draw and ${st} (${ranks >= 2 ? 15 : 12} outs)` : 'a flush draw (9 outs)';
  }
  if (b === 'strong' || b === 'medium' || b === 'weak') return pairWhy(hole, board) || BUCKET[b].desc;
  return BUCKET[b].desc;
}

const RANK_WORD = ['deuce', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
/** "top pair, good kicker", "overpair", "second pair", "trips", … for a made pair-class hand. */
function pairWhy(hole, board) {
  const cat = category(evaluate([...hole, ...board]));
  const br = [...new Set(board.map(rank))].sort((a, b) => b - a);
  const [r1, r2] = hole.map(rank);
  const on = (r) => board.filter(c => rank(c) === r).length;
  if (cat === CAT.TRIPS) return 'trips (one card in your hand, two on the board)';
  if (cat === CAT.TWO_PAIR && on(r1) && on(r2) && r1 !== r2) return 'two pair';
  if (r1 === r2 && !on(r1)) {
    if (r1 > br[0]) return `an overpair (${RANK_WORD[r1]}s)`;
    return r1 > (br[1] ?? -1) ? 'a pocket pair below the top card' : 'a small pocket pair';
  }
  const paired = [[r1, r2], [r2, r1]].filter(([r]) => on(r) === 1).sort((a, b) => b[0] - a[0])[0];
  if (!paired) return '';
  const [r, kick] = paired;
  const k = kick >= 8 ? 'good kicker' : 'weak kicker';
  if (r === br[0]) return `top pair, ${k}`;
  if (r === br[1]) return 'second pair';
  return 'third pair or worse';
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
