/**
 * LiveGTO — main entry point.
 * Registers all routes and starts the hash router.
 */
import { register, start } from './router.js';
import { render as renderHome } from './ui/home.js';
import { render as renderPreflop } from './ui/preflop.js';
import { render as renderPostflop } from './ui/postflop.js';
import { getStreak } from './state.js';

// Routes
register('home', renderHome);
register('preflop', renderPreflop);
register('postflop', renderPostflop);

// Lazy-load play and simulate (bigger modules)
register('play', async (container) => {
  const { render } = await import('./ui/play.js');
  render(container);
});
register('simulate', async (container) => {
  const { render } = await import('./ui/simulate.js');
  render(container);
});

// Header navigation
document.querySelector('.logo-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.hash = 'home';
});

// Start router
const app = document.getElementById('app');
start(app);
