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
let navId = 0;

/**
 * Each navigation renders into its own fresh root element. A slow render (a big puzzle file,
 * the course) that finishes after you've moved on writes into a detached root, so it can never
 * paint over the page you're on, and its cleanup runs at once. Timers in a view can check
 * `root.isConnected` to know whether their page is still showing.
 */
const isChunkError = (e) => /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(String(e?.message || e));
const RELOAD_KEY = 'livegto.chunkReload';
const reloadedRecently = () => { try { return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 60000; } catch { return false; } };
const markReload = () => { try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* private mode */ } };

async function onRoute() {
  if (window.__swUpdated) { window.__swUpdated = false; location.reload(); return; }
  const my = ++navId;
  const { name, params } = current();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const fn = routes[name];
  listeners.forEach(l => l(name));
  container.innerHTML = '';
  const root = document.createElement('div');
  container.appendChild(root);
  window.scrollTo(0, 0);
  if (!fn) {
    root.innerHTML = '<p class="page text-center text-ink-300 pt-16">Page not found</p>';
    return;
  }
  let c;
  try {
    c = await fn(root, params);
  } catch (e) {
    console.error(e);
    // A page's code could not be fetched: after a deploy the app that is running is the old one,
    // and its chunks are gone from the server (and from the updated service worker's cache). A
    // reload gets the new app; one try, so a real outage still shows the message below.
    if (my === navId && isChunkError(e) && !reloadedRecently()) { markReload(); location.reload(); return; }
    if (my === navId) root.innerHTML = `<div class="page text-center pt-16 space-y-3"><p class="text-ink-200">Something went wrong loading this page.</p><p class="text-xs text-ink-400">${String(e?.message || e).replace(/[<>&]/g, '')}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
    return;
  }
  if (my !== navId) { if (typeof c === 'function') { try { c(); } catch { /* ignore */ } } return; }
  cleanup = c;
}

export function start(el) {
  container = el;
  window.addEventListener('hashchange', onRoute);
  onRoute();
}
