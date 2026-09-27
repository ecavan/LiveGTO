/**
 * Puzzle modes: rated (the solver library), today's daily, your review queue, the range builder,
 * and generated flop and multiway spots.
 */
import { loadStats, dueItems, today } from '../../engine/puzzles.js';

export function puzzleTabs(active) {
  const st = loadStats();
  const due = dueItems(st).length;
  const dailyDone = !!st.daily?.[today()];
  const items = [
    ['', 'Rated'],
    ['daily', `Daily${dailyDone ? ' ✓' : ''}`],
    ['review', `Review${due ? ` <span class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold px-1">${due}</span>` : ''}`],
    ['ranges', 'Ranges'],
    ['flop', 'Flop'],
    ['multiway', 'Multiway'],
  ];
  return `<div class="seg overflow-x-auto max-w-full">${items.map(([v, l]) =>
    `<a href="#puzzles${v ? '/' + v : ''}" class="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap inline-flex items-center ${v === active ? 'bg-ink-700 text-white shadow-card' : 'text-ink-300 hover:text-ink-100'}">${l}</a>`).join('')}</div>`;
}
