/**
 * Home: the three modes, with where you are in each.
 */
import { loadStats, dueItems, dailyStreak, today } from '../engine/puzzles.js';
import { loadHands, leakReport } from '../engine/history.js';
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
  const due = dueItems(pz).length;
  const streak = dailyStreak(pz);
  const dailyDone = !!pz.daily?.[today()];
  const hands = loadHands();
  const topLeak = hands.length >= 10 ? leakReport(hands).leaks[0] : null;
  const quick = (href, ic, col, title, sub, badge = 0) => `<a href="${href}" class="panel px-4 py-3 flex items-center gap-3 hover:border-ink-500">
      <span class="relative">${icon(ic, `w-5 h-5 ${col}`)}${badge ? `<span class="absolute -top-2 -right-2 min-w-[16px] h-[16px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1">${badge}</span>` : ''}</span>
      <span class="min-w-0"><span class="block text-sm font-semibold truncate">${title}</span><span class="block text-xs text-ink-400 truncate">${sub}</span></span></a>`;

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
        'Solver-backed spots with one right answer, a daily puzzle, range building, flop and multiway spots.',
        pz.played ? pz.rating : '—', 'Puzzle rating', `${pz.played} attempts`)}
      ${card('#play', 'play', 'bg-amber-500/15 text-amber-300', 'Play',
        'Rated bots heads-up or a live 6-max table. The coach grades every decision; replay them in game review.',
        play ?? '—', 'Play rating', last ? `Last: vs ${AGENTS[last.bot]?.name ?? last.bot} (${eloOf(last.bot)})` : 'No sessions yet')}
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      ${quick('#puzzles/daily', 'star', 'text-amber-300', dailyDone ? 'Daily puzzle: done' : 'Daily puzzle', streak ? `${streak}-day streak` : 'one spot a day')}
      ${quick('#puzzles/review', 'target', 'text-rose-300', 'Missed puzzles', due ? `${due} due today` : `${pz.queue?.length ?? 0} in the queue`, due)}
      ${quick('#play/review', 'review', 'text-amber-300', 'Game review', topLeak ? `Top leak: ${topLeak.name.toLowerCase()}` : 'replay your hands')}
      ${quick('#learn/drill/feel', 'bolt', 'text-sky-300', 'Bet-size feel', 'size and price in 8 seconds')}
    </div>
  </div>`;
}
