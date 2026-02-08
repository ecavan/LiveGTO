/**
 * Minimal global state — streak counter and active filters.
 */
let _streak = 0;
let _filterPosition = null;
let _filterTexture = null;

export function getStreak() { return _streak; }
export function setStreak(n) { _streak = n; updateStreakDisplay(); }
export function incrementStreak() { _streak++; updateStreakDisplay(); }
export function resetStreak() { _streak = 0; updateStreakDisplay(); }

export function getFilterPosition() { return _filterPosition; }
export function setFilterPosition(pos) { _filterPosition = pos; }

export function getFilterTexture() { return _filterTexture; }
export function setFilterTexture(tex) { _filterTexture = tex; }

function updateStreakDisplay() {
  const el = document.getElementById('streak-val');
  if (el) el.textContent = _streak;
}
