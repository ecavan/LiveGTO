/**
 * Header rating chips: Puzzles and Play. Links to settings.
 */
import { loadStats } from '../engine/puzzles.js';
import { loadRaw, KEYS } from '../store.js';
import { icon } from './kit.js';

export function playRatingNow() {
  const store = loadRaw(KEYS.play, { sessions: [] });
  let hands = 0, sum = 0;
  for (const p of [...store.sessions].reverse()) {
    if (p.rating == null || p.hands < 5) continue;
    sum += p.rating * p.hands;
    hands += p.hands;
    if (hands >= 1000) break;
  }
  return hands ? Math.round(sum / hands) : null;
}

export function renderRatings(el) {
  if (!el) return;
  const pz = loadStats();
  const play = playRatingNow();
  el.innerHTML = `
    <a href="#puzzles" class="pill hidden sm:inline-flex" title="Puzzle rating">${icon('puzzle', 'w-3.5 h-3.5 text-emerald-300')}<span class="num">${pz.played ? pz.rating : '—'}</span></a>
    <a href="#play" class="pill hidden sm:inline-flex" title="Play rating">${icon('play', 'w-3.5 h-3.5 text-amber-300')}<span class="num">${play ?? '—'}</span></a>
    <a href="#settings" class="btn btn-quiet !p-2" title="Settings">${icon('gear', 'w-5 h-5')}</a>`;
}
