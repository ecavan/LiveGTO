/**
 * Header rating chips: Puzzles and Play. Links to settings.
 */
import { loadStats } from '../engine/puzzles.js';
import { loadRaw, KEYS } from '../store.js';
import { icon } from './kit.js';
import { getLevel, LEVELS } from '../engine/level.js';
import { poolRating } from '../engine/hu/session.js';

export function playRatingNow(level = getLevel()) {
  return playRatingInfo(level)?.rating ?? null;
}
/** The pooled Play rating with its spread and hands, or null before MIN_RATED hands. */
export function playRatingInfo(level = getLevel()) {
  const store = loadRaw(KEYS.play, { sessions: [] });
  return poolRating([...store.sessions].reverse().filter(p => p.edgeN >= 1 && (p.level ?? 2) === level));
}

/**
 * Your Play rating after each session, oldest first: the pooled rating over the sessions up to
 * that one, the same way the current rating is pooled. [{ at, rating, se, hands }]
 */
export function playRatingSeries(level = getLevel()) {
  const store = loadRaw(KEYS.play, { sessions: [] });
  const rows = store.sessions.filter(p => p.edgeN >= 1 && (p.level ?? 2) === level);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = poolRating(rows.slice(0, i + 1).reverse());
    if (r) out.push({ at: rows[i].at, rating: r.rating, se: r.se, hands: r.hands });
  }
  return out;
}

export function renderRatings(el) {
  if (!el) return;
  const pz = loadStats();
  const play = playRatingNow();
  const lv = getLevel();
  el.innerHTML = `
    <a href="#settings" class="pill hidden sm:inline-flex" title="${LEVELS[lv].name}: ratings and grades are at this level (change it in Puzzles, Play or Settings)">L${lv}</a>
    <a href="#puzzles" class="pill hidden sm:inline-flex" title="Puzzle rating">${icon('puzzle', 'w-3.5 h-3.5 text-emerald-300')}<span class="num">${pz.played ? pz.rating : '—'}</span></a>
    <a href="#play" class="pill hidden sm:inline-flex" title="Play rating">${icon('play', 'w-3.5 h-3.5 text-amber-300')}<span class="num">${play ?? '—'}</span></a>
    <a href="#settings" class="btn btn-quiet !p-2" title="Settings">${icon('gear', 'w-5 h-5')}</a>`;
}
