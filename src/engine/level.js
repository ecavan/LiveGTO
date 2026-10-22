/**
 * Levels: what the coach grades you against.
 *   1  Baseline   the solid play: what a strong player does against a strong player (GTO-like)
 *   2  Exploit    the best play against the villain in front of you (Station, Nit, Maniac, …)
 * Both are graded, and each has its own puzzle and Play rating. Preflop is the chart at both.
 */
import { settings, saveSettings } from '../store.js';

export const LEVELS = {
  1: { name: 'Level 1 · Baseline', short: 'Baseline', blurb: 'The solid play: how a strong player plays against a strong player. Learn this first.' },
  2: { name: 'Level 2 · Exploit', short: 'Exploit', blurb: 'The best play against the villain in front of you: bet more into a Station, bluff a Nit, call down a Maniac.' },
};

export const getLevel = () => (Number(settings().level) === 2 ? 2 : 1);

export function setLevel(level) {
  saveSettings({ ...settings(), level: Number(level) === 2 ? 2 : 1 });
  try { window.dispatchEvent(new Event('livegto:ratings')); } catch { /* no window in tests */ }
}

/**
 * The grade of option `idx` at the other level (a coach result `k` priced for that level), kept on
 * each decision as `d.other` so the coach can show both: { level, best, fine, loss, verdict }.
 */
export function otherGrade(k, idx, pot, level) {
  if (!k || !k.options[idx]) return null;
  const best = k.options[k.best];
  const loss = Math.round(Math.max(0, best.ev - k.options[idx].ev) * 100) / 100;
  const verdict = idx === k.best ? 'best' : k.fine.includes(idx) ? 'fine' : (loss >= 10 || loss >= 0.25 * pot) ? 'blunder' : 'mistake';
  return { level, best: k.best, fine: [...k.fine], loss: verdict === 'fine' || verdict === 'best' ? 0 : loss, verdict };
}
