/**
 * Header rating chips: Puzzles and Play. Links to settings.
 */
import { loadStats } from '../engine/puzzles.js';
import { loadRaw, KEYS } from '../store.js';
import { icon } from './kit.js';
import { getLevel, LEVELS } from '../engine/level.js';
import { poolRating } from '../engine/hu/session.js';

export function playRatingNow(level = getLevel()) {
  const store = loadRaw(KEYS.play, { sessions: [] });
  const r = poolRating([...store.sessions].reverse().filter(p => p.edgeN >= 1 && (p.level ?? 2) === level));
  return r ? r.rating : null;
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
