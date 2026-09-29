/**
 * LiveGTO: Learn · Puzzles · Play.
 */
import './styles.css';
import { register, start, onChange } from './router.js';
import { icon } from './ui/kit.js';
import { renderRatings } from './ui/ratings.js';
import { applyTheme } from './theme.js';

applyTheme();

const TABS = [
  { id: 'learn', label: 'Learn', icon: 'learn' },
  { id: 'puzzles', label: 'Puzzles', icon: 'puzzle' },
  { id: 'play', label: 'Play', icon: 'play' },
];

const lazy = (loader) => async (container, params) => {
  const mod = await loader();
  return mod.render(container, params);
};

register('home', lazy(() => import('./ui/home.js')));
register('learn', lazy(() => import('./ui/learn.js')));
register('puzzles', lazy(() => import('./ui/puzzles.js')));
register('play', lazy(() => import('./ui/play.js')));
register('settings', lazy(() => import('./ui/settings.js')));
// old links
for (const old of ['simulate', 'preflop', 'playbook', 'postflop']) {
  register(old, () => { window.location.hash = old === 'simulate' ? 'play' : old === 'postflop' ? 'puzzles' : `learn/${old}`; });
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
