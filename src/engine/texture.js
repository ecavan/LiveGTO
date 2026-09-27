/**
 * Board texture classes, the way a live player sorts flops.
 *
 *   suits    rainbow · two-tone · monotone
 *   connect  connected (three ranks inside a 5-card straight window: straights already possible)
 *            semi      (two ranks within 3 of each other: plenty of straight draws, e.g. J-9-4)
 *            dry       (nothing close, e.g. K-7-2, J-6-2)
 *   paired   unpaired · paired · trips
 *   height   ace (A-high) · big (K/Q-high) · mid (J–8-high) · low (7-high or lower)
 *
 * Suits only matter through what they make possible, so J♥5♥9♠ and J♦5♦9♠ are the same spot
 * (poker is symmetric under relabelling suits). `randomSuitMap` / `remapCard` use that to show one
 * solved spot as any member of its family.
 */

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

const rankOf = (c) => RANKS.indexOf(c[0]); // 0 = deuce … 12 = ace

/** Distinct rank values for straight maths, with the ace also counted low (value 1). */
function straightValues(cards) {
  const v = new Set(cards.map(c => rankOf(c) + 2)); // 2..14
  if (v.has(14)) v.add(1);
  return [...v].sort((a, b) => a - b);
}

/** Largest number of distinct ranks inside any 5-rank straight window (A-5 … T-A). */
function maxInWindow(cards) {
  const v = straightValues(cards);
  let best = 0;
  for (let lo = 1; lo <= 10; lo++) {
    // count distinct real ranks (ace high and low are the same card)
    const inWin = new Set(v.filter(x => x >= lo && x <= lo + 4).map(x => (x === 1 ? 14 : x)));
    best = Math.max(best, inWin.size);
  }
  return best;
}

function closestGap(cards) {
  const v = straightValues(cards);
  let gap = Infinity;
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1] === 1 ? 14 : v[i - 1];
    const b = v[i] === 1 ? 14 : v[i];
    if (a !== b) gap = Math.min(gap, v[i] - v[i - 1]);
  }
  return gap;
}

export function flopTexture(board) {
  const flop = board.slice(0, 3);
  const suitCounts = {};
  const rankCounts = {};
  for (const c of flop) {
    suitCounts[c[1]] = (suitCounts[c[1]] || 0) + 1;
    rankCounts[c[0]] = (rankCounts[c[0]] || 0) + 1;
  }
  const maxSuit = Math.max(...Object.values(suitCounts));
  const maxRank = Math.max(...Object.values(rankCounts));
  const distinct = Object.keys(rankCounts).length;
  const top = Math.max(...flop.map(rankOf));

  const suits = maxSuit === 3 ? 'monotone' : maxSuit === 2 ? 'two-tone' : 'rainbow';
  const paired = maxRank === 3 ? 'trips' : maxRank === 2 ? 'paired' : 'unpaired';
  let connect;
  if (distinct === 3 && maxInWindow(flop) === 3) connect = 'connected';
  else if (closestGap(flop) <= 3) connect = 'semi';
  else connect = 'dry';
  const height = top === 12 ? 'ace' : top >= 10 ? 'big' : top >= 6 ? 'mid' : 'low';
  return { suits, connect, paired, height };
}

const HEIGHT_LABEL = { ace: 'A-high', big: 'K/Q-high', mid: 'J–8-high', low: 'low' };
const CONNECT_LABEL = { connected: 'connected', semi: 'semi-connected', dry: 'dry' };

export function textureLabel(t) {
  const parts = [HEIGHT_LABEL[t.height], t.suits, CONNECT_LABEL[t.connect]];
  if (t.paired !== 'unpaired') parts.push(t.paired);
  return parts.join(' · ');
}

/** What the full current board (flop, turn or river) makes possible. */
export function boardTags(board) {
  const tags = [];
  const suitCounts = {};
  const rankCounts = {};
  for (const c of board) {
    suitCounts[c[1]] = (suitCounts[c[1]] || 0) + 1;
    rankCounts[c[0]] = (rankCounts[c[0]] || 0) + 1;
  }
  const maxSuit = Math.max(...Object.values(suitCounts));
  const maxRank = Math.max(...Object.values(rankCounts));
  if (maxSuit >= 4) tags.push('4-flush');
  else if (maxSuit === 3) tags.push('flush possible');
  else if (maxSuit === 2 && board.length < 5) tags.push('flush draw');
  const w = maxInWindow(board);
  if (w >= 4) tags.push('4 to a straight');
  else if (w === 3) tags.push('straight possible');
  if (maxRank >= 3) tags.push('trips on board');
  else if (Object.values(rankCounts).filter(n => n >= 2).length >= 2) tags.push('double-paired');
  else if (maxRank === 2) tags.push('paired');
  return tags;
}

// ---------------------------------------------------------------- suit relabelling

/** A random permutation of the four suits, e.g. { s: 'h', h: 'd', d: 'c', c: 's' }. */
export function randomSuitMap(rand = Math.random) {
  const to = SUITS.split('');
  for (let i = to.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [to[i], to[j]] = [to[j], to[i]];
  }
  return Object.fromEntries(SUITS.split('').map((s, i) => [s, to[i]]));
}

const CARD = /^[2-9TJQKA][shdc]$/;

/** Relabel one card ("Kh") or a run of cards ("AhKd"). Anything else is returned unchanged. */
export function remapCard(str, map) {
  if (str.length % 2 === 0 && str.match(/^([2-9TJQKA][shdc])+$/)) {
    return str.replace(/([2-9TJQKA])([shdc])/g, (_, r, s) => r + map[s]);
  }
  return str;
}

export const isCard = (s) => CARD.test(s);
