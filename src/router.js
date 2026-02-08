/**
 * Hash-based SPA router.
 * Routes: #home, #preflop, #postflop, #play, #simulate
 */
const routes = {};

export function register(hash, renderFn) {
  routes[hash] = renderFn;
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function start(container) {
  function onRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    const renderFn = routes[hash];
    if (renderFn) {
      container.innerHTML = '';
      renderFn(container);
    } else {
      container.innerHTML = '<p class="text-center text-gray-500 pt-12">Page not found</p>';
    }
  }
  window.addEventListener('hashchange', onRoute);
  onRoute();
}
