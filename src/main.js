/**
 * LiveGTO: Home · Play · Watch · Puzzles · Train · Review.
 */
import './styles.css';
import { register, start, onChange, redirect } from './router.js';
import { icon } from './ui/kit.js';
import { renderRatings } from './ui/ratings.js';
import { applyTheme } from './theme.js';

applyTheme();

const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'play', label: 'Play', icon: 'play' },
  { id: 'watch', label: 'Watch', icon: 'bot' },
  { id: 'puzzles', label: 'Puzzles', icon: 'puzzle' },
  { id: 'train', label: 'Train', icon: 'learn' },
  { id: 'review', label: 'Review', icon: 'review' },
];

const lazy = (loader) => async (container, params) => {
  const mod = await loader();
  return mod.render(container, params);
};

register('home', lazy(() => import('./ui/home.js')));
register('train', lazy(() => import('./ui/learn.js')));
register('watch', lazy(() => import('./ui/play/watch.js')));
register('review', lazy(() => import('./ui/play/review.js')));
register('puzzles', lazy(() => import('./ui/puzzles.js')));
register('play', lazy(() => import('./ui/play.js')));
register('settings', lazy(() => import('./ui/settings.js')));
// After a deploy the updated service worker takes over while the old app is still running, whose
// page chunks are gone from the server: the next page change reloads into the new app instead.
if ('serviceWorker' in navigator) {
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) window.__swUpdated = true; had = true; });
}
// old links (bookmarks, the review queue, links saved in hand notes)
register('learn', (c, params) => redirect(['train', ...params].join('/')));
for (const old of ['simulate', 'preflop', 'playbook', 'postflop']) {
  register(old, () => redirect(old === 'simulate' ? 'play' : old === 'postflop' ? 'puzzles/rated' : `train/${old}`));
}

function drawTabs(active) {
  const top = document.getElementById('tabs-top');
  const bottom = document.getElementById('tabs-bottom');
  top.innerHTML = TABS.map(t => `<a href="#${t.id}" class="${t.id === active ? 'on' : ''}">${t.label}</a>`).join('');
  bottom.innerHTML = TABS.map(t => `<a href="#${t.id}" class="${t.id === active ? 'on' : ''}">${icon(t.icon, 'w-6 h-6')}${t.label}</a>`).join('');
  renderRatings(document.getElementById('ratings'));
}
onChange(drawTabs);
window.addEventListener('livegto:ratings', () => renderRatings(document.getElementById('ratings')));

// Range grids: the numbers behind a cell live in its tooltip, which a touch screen can't show.
// Tapping a cell writes them under the grid instead.
document.addEventListener('click', (e) => {
  const cell = e.target.closest?.('.rg > div[title]');
  if (!cell || cell.closest('#rb-grid')) return;
  const grid = cell.parentElement;
  let out = grid.nextElementSibling;
  if (!out || !out.classList.contains('rg-readout')) {
    out = document.createElement('div');
    out.className = 'rg-readout';
    grid.after(out);
  }
  out.textContent = cell.getAttribute('title');
});

start(document.getElementById('app'));
