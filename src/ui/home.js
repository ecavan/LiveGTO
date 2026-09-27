/**
 * Home page — mode selection.
 */
import { navigate } from '../router.js';

export function render(container) {
  container.innerHTML = `
  <div class="text-center space-y-10 pt-8">
    <div>
      <h1 class="text-4xl font-bold text-emerald-400 tracking-tight">LiveGTO</h1>
      <p class="text-gray-500 mt-2 text-lg">Train your poker instincts</p>
    </div>

    <div class="grid gap-4 max-w-sm mx-auto">
      <a href="#puzzles"
         class="block p-6 bg-emerald-900/40 rounded-xl border border-emerald-500/50
                hover:border-emerald-400/80 hover:bg-emerald-900/60 transition-all">
        <h2 class="text-lg font-semibold text-emerald-300">Puzzles</h2>
        <p class="text-sm text-gray-400 mt-1">Real cards, one right answer &mdash; vs GTO or vs a Station, Nit, Maniac or Whale. Rated like chess puzzles.</p>
      </a>

      <a href="#playbook"
         class="block p-5 bg-amber-900/25 rounded-xl border border-amber-700/40
                hover:border-amber-500/60 hover:bg-amber-900/40 transition-all">
        <h2 class="text-base font-semibold text-amber-300">Playbook</h2>
        <p class="text-sm text-gray-400 mt-1">The rules behind the puzzles: how to play each hand class vs each villain type, by board texture.</p>
      </a>

      <a href="#play"
         class="block p-6 bg-emerald-900/30 rounded-xl border border-emerald-700/40
                hover:border-emerald-500/60 hover:bg-emerald-900/50 transition-all">
        <h2 class="text-lg font-semibold text-emerald-300">Play</h2>
        <p class="text-sm text-gray-400 mt-1">Full hands against a bot (Reg, Station, Nit, Maniac or Whale), with a coach after every decision: what each option was worth against his actual range.</p>
      </a>

      <a href="#simulate"
         class="block p-6 bg-amber-900/30 rounded-xl border border-amber-700/40
                hover:border-amber-500/60 hover:bg-amber-900/50 transition-all">
        <h2 class="text-lg font-semibold text-amber-300">Simulate</h2>
        <p class="text-sm text-gray-400 mt-1">A session against one bot with no interruptions, then a review: bb/100, your biggest mistakes, and the rating you played at.</p>
      </a>

      <a href="#preflop"
         class="block p-5 bg-gray-900/80 rounded-xl border border-gray-800
                hover:border-emerald-500/60 hover:bg-gray-900 transition-all">
        <h2 class="text-base font-semibold text-gray-100">Preflop charts</h2>
        <p class="text-xs text-gray-500 mt-1">Live 9-handed ranges from The Course: open, 3-bet, call or fold.</p>
      </a>
    </div>

    <p class="text-xs text-gray-600 pt-4">No tracking. No accounts. Just reps.</p>
  </div>`;
}
