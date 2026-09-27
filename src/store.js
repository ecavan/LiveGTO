/**
 * Persistent, per-device state (localStorage). Every access is wrapped: private browsing or a
 * full disk must never break the app.
 */
export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : { ...fallback, ...JSON.parse(v) };
  } catch {
    return fallback;
  }
}
export function loadRaw(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

export const KEYS = {
  settings: 'livegto.settings.v1',
  play: 'livegto.play.v2',
  learn: 'livegto.learn.v1',
  drills: 'livegto.drills.v1',
};

export const settings = () => load(KEYS.settings, { coach: 'decision', pauseOn: 'mistake', bot: 'reg', length: 0, tier: 'feel' });
export const saveSettings = (s) => save(KEYS.settings, s);
