/**
 * Today's path: three small things a day, in order, so opening the app is never "what now?".
 *   1. the daily puzzle
 *   2. five puzzles, on your costliest leak when you have one
 *   3. ten hands against a bot or at the live table
 * A day with all three counts toward the streak. Puzzles are counted here as they are answered;
 * the daily puzzle and the hands are read from where they already live.
 */
import { loadRaw, save, KEYS } from '../store.js';

export const GOAL = { puzzles: 5, hands: 10 };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function load() {
  const p = Object(loadRaw(KEYS.path, {}));
  const date = dayKey();
  return { date, puzzles: p.date === date ? p.puzzles || 0 : 0, right: p.date === date ? p.right || 0 : 0, days: Array.isArray(p.days) ? p.days : [] };
}

/** A rated or drill puzzle was answered. */
export function bumpPuzzle(correct) {
  const p = load();
  p.puzzles += 1;
  if (correct) p.right += 1;
  save(KEYS.path, p);
}

/** Consecutive finished days ending today or yesterday. */
export function streakOf(days, now = new Date()) {
  const set = new Set(days);
  const d = new Date(now);
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/**
 * Where today stands. `dailyDone`: today's daily puzzle is answered; `hands`: stored hands
 * (each with `at`, a timestamp). Marks the day finished the first time all three are done.
 */
export function pathToday({ dailyDone, hands = [] }) {
  const p = load();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const played = hands.filter(h => !h.live && (h.at ?? 0) >= start.getTime()).length;
  const steps = [
    { key: 'daily', done: !!dailyDone, n: dailyDone ? 1 : 0, of: 1 },
    { key: 'puzzles', done: p.puzzles >= GOAL.puzzles, n: Math.min(p.puzzles, GOAL.puzzles), of: GOAL.puzzles, right: p.right, total: p.puzzles },
    { key: 'hands', done: played >= GOAL.hands, n: Math.min(played, GOAL.hands), of: GOAL.hands },
  ];
  const done = steps.every(s => s.done);
  if (done && !p.days.includes(p.date)) { p.days = [...p.days, p.date].slice(-400); save(KEYS.path, p); }
  return { steps, done, streak: streakOf(p.days), next: steps.find(s => !s.done)?.key ?? null };
}
