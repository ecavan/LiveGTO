/**
 * Hand buckets: how players think after the flop. Instead of 1,326 combos, six kinds of hand,
 * strongest first, each with one plan:
 *
 *   Nuts            the best hand or close to it on this board (a set on a dry board, a made
 *                   flush, a full house)
 *   Value           strong but beatable: overpairs, top pair good kicker, two pair, and big hands
 *                   on boards where a flush, a straight or a full house is possible
 *   Bluff-catcher   a pair that beats bluffs but not value: top pair weak kicker, middle pair,
 *                   small pocket pairs (showdown value)
 *   Draw            no pair yet, real outs: flush draws, open-enders, combo draws
 *   Air with equity no pair, no real draw, but live: a gutshot, two overcards, or on the flop a
 *                   backdoor flush or straight draw. Where your bluffs come from
 *   Air             nothing to improve to: give up unless you have a reason
 *
 * The same hand moves between buckets as the board changes (a set is Nuts on K-7-2 and Value on
 * J-T-9 with two hearts), and so does the plan: see boardKind and plans.js.
 * Built on the live-player classes (hand.js classify), the same ones the bots and the solver use.
 */
import { classify, evaluate, category, CAT, rank, suit, ALL_COMBOS, handType } from './hu/hand.js';
import { N } from './hu/equity.js';
import { cardStr } from './hu/hand.js';
import { boardTags } from './texture.js';

export const BUCKETS = [
  { key: 'nuts', name: 'Nuts', desc: 'the best hand or close to it on this board' },
  { key: 'value', name: 'Value', desc: 'strong but beatable: overpairs, top pair good kicker, two pair' },
  { key: 'catcher', name: 'Bluff-catcher', desc: 'a pair that beats bluffs, not value' },
  { key: 'draw', name: 'Draw', desc: 'flush draws, open-enders, combo draws' },
  { key: 'eqair', name: 'Air with equity', desc: 'gutshots, two overcards, backdoor draws' },
  { key: 'air', name: 'Air', desc: 'nothing to improve to' },
];
export const BUCKET_KEYS = BUCKETS.map(b => b.key);

/** Plain-English default plan for each bucket, heads-up and multiway (the plan tables in plans.js give the solved version by board). */
export const BUCKET_PLAN = {
  nuts: { hu: 'Build the pot: bet, raise, get the stacks in.', mw: 'Bet big: someone will call. Raise when you\'re bet into.' },
  value: { hu: 'Bet for value and protection. Slow down when he raises a scary board: you beat bluffs and worse, not the nuts.', mw: 'Bet once for value and protection, then pot control.' },
  catcher: { hu: 'Check and call a bet; don\'t bet yourself unless he calls with worse (a station).', mw: 'Check; call small bets, fold to a bet and a raise.' },
  draw: { hu: 'Semi-bluff: bet, or raise his bet. You win when he folds and when you hit.', mw: 'Call when the price is right; bet when the table looks weak.' },
  eqair: { hu: 'Your bluffs: c-bet these, and barrel the turn when it gives you a draw or scares him.', mw: 'Mostly give up: with two or more players someone has something.' },
  air: { hu: 'Give up: check and fold. Bluff only with a reason (a nit, a scare card).', mw: 'Check and fold.' },
};
export const BUCKET = Object.fromEntries(BUCKETS.map(b => [b.key, b]));

/** The solver's classes (library records) shown as buckets. */
export const CLASS_AS_BUCKET = {
  monster: { key: 'nuts', name: 'Nuts & big hands', desc: 'sets, straights, flushes, top two pair' },
  strong: BUCKET.value,
  medium: BUCKET.catcher, weak: BUCKET.catcher,
  draw: BUCKET.draw,
  air: { key: 'air', name: 'Air', desc: 'no pair and no real draw' },
};

// ------------------------------------------------------------------ board kinds

/**
 * Four kinds of board, decided on the flop (the way players talk about boards; what the turn and
 * river change shows up in your bucket instead: a set becomes Value when the flush comes in):
 *   monotone  three of a suit: a flush is already possible
 *   paired    a pair on the board: full houses are possible, few strong hands around
 *   wet       two of a suit or connected cards (J♥T♥8♣, 9-8-4): draws everywhere
 *   dry       none of that (K♠7♥2♦, A-8-3 rainbow): few draws
 */
export const BOARD_KINDS = {
  dry: { name: 'Dry', desc: 'rainbow, unpaired, cards far apart: few draws' },
  wet: { name: 'Wet', desc: 'two of a suit or connected cards: draws everywhere' },
  paired: { name: 'Paired', desc: 'a pair on the flop' },
  monotone: { name: 'Monotone', desc: 'three of one suit on the flop' },
};
export function boardKind(board) {
  const flop = board.slice(0, 3);
  if (maxSuitCount(flop) >= 3) return 'monotone';
  if (new Set(flop.map(rank)).size < 3) return 'paired';
  if (maxSuitCount(flop) === 2 || maxInWindow(flop) >= 3 || closeRanks(flop)) return 'wet';
  return 'dry';
}
/**
 * Two board cards within two ranks of each other (J-9, 8-7): open-enders are easy. Not the ace:
 * A-K or A-3 only give gutshots, so A-K-7 and A-8-3 rainbow stay dry.
 */
function closeRanks(board) {
  const r = [...new Set(board.map(rank))].filter(x => x !== 12).sort((a, b) => a - b);
  for (let i = 1; i < r.length; i++) if (r[i] - r[i - 1] <= 2) return true;
  return false;
}

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
  if (cls === 'monster') return vulnerability(hole, board).length ? 'value' : 'nuts';
  if (cls === 'strong') return 'value';
  if (cls === 'medium' || cls === 'weak') return 'catcher';
  if (cls === 'draw') return 'draw';
  return airEquity(hole, board).length ? 'eqair' : 'air';
}

/** Why a hand is in its bucket, in a few words ("set, but flush possible", "backdoor flush draw · two overcards"). */
export function bucketWhy(hole, board) {
  const b = bucketOf(hole, board);
  const cls = classify(hole, board);
  const made = { [CAT.HIGH]: 'no pair', [CAT.PAIR]: 'a pair', [CAT.TWO_PAIR]: 'two pair', [CAT.TRIPS]: rank(hole[0]) === rank(hole[1]) ? 'a set' : 'trips', [CAT.STRAIGHT]: 'a straight', [CAT.FLUSH]: 'a flush', [CAT.FULL_HOUSE]: 'a full house', [CAT.QUADS]: 'quads', [CAT.STRAIGHT_FLUSH]: 'a straight flush' }[category(evaluate([...hole, ...board]))];
  if (cls === 'monster') {
    const v = vulnerability(hole, board);
    return v.length ? `${made}, but ${v.join(', ')}` : made;
  }
  if (b === 'eqair') return airEquity(hole, board).join(' · ');
  if (b === 'draw') {
    const ranks = straightRanks(hole, board);
    if (!hasFlushDraw(hole, board)) return 'an open-ender or double gutshot (8 outs)';
    const st = ranks >= 2 ? 'an open-ender' : ranks === 1 ? 'a gutshot' : '';
    return st ? `a flush draw and ${st} (${ranks >= 2 ? 15 : 12} outs)` : 'a flush draw (9 outs)';
  }
  if (b === 'value' || b === 'catcher') return pairWhy(hole, board) || BUCKET[b].desc;
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

const CAT_WORD = { [CAT.PAIR]: 'pairs', [CAT.TWO_PAIR]: 'two pair', [CAT.TRIPS]: 'sets and trips', [CAT.STRAIGHT]: 'straights', [CAT.FLUSH]: 'flushes', [CAT.FULL_HOUSE]: 'full houses', [CAT.QUADS]: 'quads', [CAT.STRAIGHT_FLUSH]: 'straight flushes' };

/** Description of a bucket on this board, from what's actually in it. */
function describe(key, board, idx, w) {
  if (key !== 'nuts' && key !== 'value') return BUCKET[key].desc;
  const by = {};
  for (const i of idx) { const c = category(evaluate([...ALL_COMBOS[i], ...board])); by[c] = (by[c] || 0) + w[i]; }
  const words = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c]) => CAT_WORD[c]).filter(Boolean).slice(0, 3).join(', ');
  const d = boardDangers(board);
  return key === 'value' && d.length ? `${words} (${d.join(', ')})` : words;
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
  const by = new Map();
  for (const c of classes) {
    const B = CLASS_AS_BUCKET[c.class];
    const w = c.exploit.weight;
    const r = by.get(B.key) || { key: B.key, name: B.name, desc: B.desc, share: 0, examples: [], mix: c.exploit.pure.map(() => 0) };
    r.share += w;
    c.exploit.pure.forEach((p, i) => { r.mix[i] += w * p; });
    by.set(B.key, r);
  }
  return [...by.values()].filter(r => r.share >= 0.02).map(r => {
    const mix = r.mix.map(x => x / r.share);
    const best = mix.reduce((a, x, j) => (x > mix[a] ? j : a), 0);
    return { ...r, mix, best, agree: mix[best] };
  });
}

/** One-line reading of the board for bucket views ("flush possible · straight possible"). */
export const boardLine = (board) => { const t = boardTags(board.map(cardStr)); return t.length ? t.join(' · ') : 'unpaired, no flush or straight possible'; };
