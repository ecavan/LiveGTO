/**
 * Hash router. "#learn/drill/pot-odds" → route "learn" with params ["drill", "pot-odds"].
 * A view may return a cleanup function (timers etc.), called before the next route renders.
 */
const routes = {};
let cleanup = null;
const listeners = [];

export function register(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(hash) {
  if (window.location.hash.slice(1) === hash) onRoute();
  else window.location.hash = hash;
}

export function current() {
  const [name, ...params] = (window.location.hash.slice(1) || 'home').split('/');
  return { name, params };
}

export function onChange(fn) { listeners.push(fn); }

let container = null;
async function onRoute() {
  const { name, params } = current();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const fn = routes[name];
  listeners.forEach(l => l(name));
  container.innerHTML = '';
  window.scrollTo(0, 0);
  if (!fn) {
    container.innerHTML = '<p class="page text-center text-ink-300 pt-16">Page not found</p>';
    return;
  }
  cleanup = await fn(container, params);
}

export function start(el) {
  container = el;
  window.addEventListener('hashchange', onRoute);
  onRoute();
}
