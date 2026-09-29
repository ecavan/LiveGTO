/** Light / dark / follow the device. The choice lives in localStorage so index.html can apply it before first paint. */
const KEY = 'livegto.theme';
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function themePref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme(pref = themePref()) {
  const light = pref === 'light' || (pref === 'system' && !!mq?.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f6f9' : '#07090d');
}

export function setTheme(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode */ }
  applyTheme(pref);
}

mq?.addEventListener?.('change', () => applyTheme());
