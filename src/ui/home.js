/**
 * Home: the three modes, with where you are in each.
 */
import { loadStats } from '../engine/puzzles.js';
import { loadRaw, KEYS } from '../store.js';
import { playRatingNow } from './ratings.js';
import { icon } from './kit.js';
import { AGENTS, eloOf } from '../engine/hu/agents.js';

export function render(container) {
  const pz = loadStats();
  const play = playRatingNow();
  const last = loadRaw(KEYS.play, { sessions: [] }).sessions.at(-1);
  const learn = loadRaw(KEYS.learn, { done: {} });
  const doneSteps = Object.keys(learn.done || {}).length;

  const card = (href, ic, tone, title, lead, stat, statLabel, foot) => `
    <a href="${href}" class="panel panel-pad group flex flex-col gap-4 hover:border-ink-500 transition min-h-[210px]">
      <div class="flex items-center justify-between">
        <span class="w-11 h-11 rounded-2xl ${tone} flex items-center justify-center">${icon(ic, 'w-6 h-6')}</span>
        <span class="text-ink-400 group-hover:text-white transition">${icon('next', 'w-5 h-5')}</span>
      </div>
      <div><div class="text-xl font-semibold text-white">${title}</div><p class="text-sm text-ink-300 mt-1 leading-snug">${lead}</p></div>
      <div class="mt-auto flex items-end justify-between">
        <div><div class="text-[11px] uppercase tracking-[0.1em] text-ink-400 font-semibold">${statLabel}</div><div class="text-2xl font-semibold num text-white">${stat}</div></div>
        <div class="text-xs text-ink-400 text-right">${foot}</div>
      </div>
    </a>`;

  container.innerHTML = `<div class="page space-y-6 fade-up">
    <div>
      <h1 class="h-title">Get better at live poker.</h1>
      <p class="muted mt-1">Learn the maths, drill real spots, then play bots that punish your leaks.</p>
    </div>
    <div class="grid md:grid-cols-3 gap-4">
      ${card('#learn', 'learn', 'bg-sky-500/15 text-sky-300', 'Learn',
        'The Boot Camp course, quick-fire table maths, range drills and preflop charts.',
        doneSteps, 'Steps done', 'Pot odds · MDF · outs · combos')}
      ${card('#puzzles', 'puzzle', 'bg-emerald-500/15 text-emerald-300', 'Puzzles',
        'Solver-backed spots with one right answer against a Station, Nit, Maniac or Whale.',
        pz.played ? pz.rating : '—', 'Puzzle rating', `${pz.played} solved attempts`)}
      ${card('#play', 'play', 'bg-amber-500/15 text-amber-300', 'Play',
        'Heads-up against rated bots, from Whale to Pro. The coach grades every decision.',
        play ?? '—', 'Play rating', last ? `Last: vs ${AGENTS[last.bot]?.name ?? last.bot} (${eloOf(last.bot)})` : 'No sessions yet')}
    </div>
    <div class="grid sm:grid-cols-3 gap-3">
      <a href="#learn/drill/potodds" class="panel px-4 py-3 flex items-center gap-3 hover:border-ink-500">${icon('bolt', 'w-5 h-5 text-sky-300')}<span class="text-sm font-semibold">Quick drill: pot odds</span></a>
      <a href="#learn/range" class="panel px-4 py-3 flex items-center gap-3 hover:border-ink-500">${icon('grid', 'w-5 h-5 text-sky-300')}<span class="text-sm font-semibold">Range drill: who continues?</span></a>
      <a href="#learn/preflop" class="panel px-4 py-3 flex items-center gap-3 hover:border-ink-500">${icon('target', 'w-5 h-5 text-sky-300')}<span class="text-sm font-semibold">Preflop trainer</span></a>
    </div>
  </div>`;
}
