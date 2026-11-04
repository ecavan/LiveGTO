/**
 * Home: where you left off, today's puzzle, your biggest leak and the drill for it, your numbers,
 * and your recent sessions (each opens in Review). The same shape as ChessBot's home.
 */
import { loadStats, dueItems, dailyStreak, dailyAt, today } from '../engine/puzzles.js';
import { loadHands, leakReport, sessionsOf, accuracyOf, gradeCounts } from '../engine/history.js';
import { loadSessions, totals as liveTotals } from '../engine/sessions.js';
import { loadRaw, KEYS } from '../store.js';
import { playRatingInfo } from './ratings.js';
import { icon, esc, fmtBB, levelSwitch, wireLevel, ratingText, PROVISIONAL_SE } from './kit.js';
import { getLevel, LEVELS } from '../engine/level.js';
import { AGENTS, AGENT_IDS, eloOf } from '../engine/hu/agents.js';
import { getCourse } from './learn/course.js';
import { activeHeadsUp } from './play.js';
import { activeTable } from './play/table.js';
import { sessionTitle } from './play/review.js';

const LEAK_MIN_HANDS = 10;
const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
const accTone = (a) => (a == null ? '' : a >= 90 ? 'text-emerald-300' : a >= 75 ? 'text-sky-300' : a >= 60 ? 'text-yellow-300' : 'text-rose-300');
const money = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}$${Math.abs(Math.round(x)).toLocaleString()}`;

export async function render(container) {
  const lv = getLevel();
  const pz = loadStats();
  const play = playRatingInfo();
  const due = dueItems(pz).length;
  const queued = pz.queue?.length ?? 0;
  const streak = dailyStreak(pz);
  const daily = dailyAt(pz, today());
  const hands = loadHands();
  const sessions = sessionsOf(hands);
  const leak = hands.length >= LEAK_MIN_HANDS ? leakReport(hands).leaks[0] : null;
  const acc = accuracyOf(hands.slice(-100));
  const live = liveTotals(loadSessions());
  const hu = activeHeadsUp();
  const table = activeTable();
  const bots = [...AGENT_IDS].sort((a, b) => eloOf(a) - eloOf(b));

  // ---- hero: carry on, or start playing
  const playCard = hu || table ? `
    <a href="${hu ? '#play' : '#play/table'}" class="card-link panel panel-pad !border-emerald-700/50 hero-play flex flex-col gap-2">
      <div class="h-sec"><span class="text-emerald-300">Session in progress</span></div>
      <div class="text-2xl font-semibold text-white">${hu ? `vs ${esc(AGENTS[hu.bot]?.name ?? hu.bot)}` : `Live table · ${esc(LEVELS_TABLE[table.level] ?? '')}`}</div>
      <div class="text-sm text-ink-300">${hu ? `${hu.hands} hand${hu.hands === 1 ? '' : 's'} · <span class="${tone(hu.net)}">${fmtBB(hu.net, { sign: true })}</span>` : `${table.hands} hand${table.hands === 1 ? '' : 's'}${table.n ? ` · ${table.n}-handed` : ''}`}</div>
      <span class="btn btn-primary self-start mt-2">Continue</span>
    </a>` : `
    <div class="panel panel-pad !border-emerald-700/50 hero-play flex flex-col gap-2">
      <div class="h-sec"><span class="text-emerald-300">Play</span></div>
      <div class="text-2xl font-semibold text-white">Play a rated bot</div>
      <div class="text-sm text-ink-300">Seven bots from ${esc(AGENTS[bots[0]].name)} (${eloOf(bots[0])}) to ${esc(AGENTS[bots.at(-1)].name)} (${eloOf(bots.at(-1))}), or a live 6-max table. The coach grades every decision.</div>
      <div class="flex gap-2 flex-wrap mt-2"><a href="#play" class="btn btn-primary">Heads-up</a><a href="#play/table" class="btn">Live table</a></div>
    </div>`;

  const dailyCard = `
    <a href="#puzzles/daily" class="card-link panel panel-pad flex flex-col gap-2">
      <div class="h-sec">Daily puzzle · ${LEVELS[lv].short}</div>
      <div class="text-2xl font-semibold text-white">${daily ? (daily.v === 'mistake' ? 'Missed. It comes back for review.' : 'Solved ✓') : 'Ready for you'}</div>
      <div class="text-sm text-ink-300">${streak ? `${streak}-day streak. ` : ''}One solved spot a day, with one right answer.</div>
      <span class="btn self-start mt-2">${daily ? 'Open' : 'Solve'}</span>
    </a>`;

  // ---- focus: the leak that costs you most, and the drill for it (ChessBot's weekly plan)
  const focus = leak ? `
    <div class="panel panel-pad !border-sky-700/50 space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <div class="h-sec"><span class="text-sky-300">Your biggest leak · last ${hands.length} hands</span></div>
          <div class="text-xl font-semibold text-white mt-1">${esc(leak.name)}</div>
          <p class="text-sm text-ink-300 mt-1 max-w-2xl">${esc(leak.fix)} It cost you <span class="text-rose-300 font-semibold num">${leak.per100.toFixed(1)}bb</span> per 100 hands, ${leak.count} time${leak.count === 1 ? '' : 's'}.</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <a class="btn btn-primary" href="${leak.key.startsWith('pre-') ? '#train/preflop' : `#puzzles/drill/${leak.key}`}">${icon('target', 'w-4 h-4')} ${leak.key.startsWith('pre-') ? 'Preflop trainer' : 'Drill this leak'}</a>
          ${leak.examples[0] ? `<a class="btn" href="#review/h/${leak.examples[0].id}/${leak.examples[0].at + 1}">See your worst one</a>` : ''}
        </div>
      </div>
    </div>` : `
    <div class="panel panel-pad text-sm text-ink-300 flex items-center gap-3">
      ${icon('target', 'w-5 h-5 text-sky-300 shrink-0')}
      <span>${hands.length ? `Play ${LEAK_MIN_HANDS - hands.length} more hand${LEAK_MIN_HANDS - hands.length === 1 ? '' : 's'}` : `Play ${LEAK_MIN_HANDS} hands`} and your biggest leak shows up here, with a drill for it.</span>
    </div>`;

  // ---- numbers
  const tile = (href, k, v, s) => `<a href="${href}" class="stat hover:border-ink-500 transition"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></a>`;
  const solvedPct = pz.played ? Math.round((100 * pz.solved) / pz.played) : null;
  const tiles = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
    ${tile('#puzzles', `Puzzle rating · ${LEVELS[lv].short}`, pz.played ? pz.rating : '—', pz.played ? `${pz.played} played · ${solvedPct}% solved` : 'solve one to start')}
    ${tile('#play', `Play rating · ${LEVELS[lv].short}`, play ? ratingText(play.rating, play.se, 'text-xs') : '—', play ? `${play.hands} hands${play.se > PROVISIONAL_SE ? ', still settling' : ''}` : 'rated after 20 hands')}
    ${tile(due ? '#puzzles/review' : '#puzzles', 'Mistakes to review', due, queued ? `${queued} missed puzzle${queued === 1 ? '' : 's'} queued` : 'puzzles you miss come back')}
    ${tile('#review/insights', 'Decision accuracy', `<span class="${accTone(acc)}">${acc ?? '—'}</span>`, hands.length ? `last ${Math.min(100, hands.length)} hands` : 'play or log a hand')}
  </div>`;

  // ---- places to go
  const course = await getCourse().catch(() => null);
  const learn = loadRaw(KEYS.learn, { done: {} });
  const steps = course ? course.modules.reduce((a, m) => a + m.steps.length, 0) : 0;
  const doneSteps = Object.keys(learn.done || {}).length;
  const nextMod = course ? course.modules.findIndex((m, mi) => m.steps.some((_, si) => !learn.done[`${mi}.${si}`])) : -1;
  const nextStep = nextMod >= 0 ? course.modules[nextMod].steps.findIndex((_, si) => !learn.done[`${nextMod}.${si}`]) : 0;
  const go = (href, sec, col, title, sub) => `<a href="${href}" class="card-link panel panel-pad">
      <div class="h-sec"><span class="${col}">${sec}</span></div><div class="text-white font-semibold mt-1">${title}</div><div class="text-sm text-ink-300 mt-1">${sub}</div></a>`;
  const places = `<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
    ${go('#watch', 'Watch', 'text-amber-300', 'Bots play, the coach explains', 'Cards face up. See how the Pro takes apart a Station, one decision at a time.')}
    ${go(nextMod >= 0 ? `#train/course/${nextMod}/${Math.max(0, nextStep)}` : '#train', 'Course', 'text-sky-300', doneSteps ? `${doneSteps} of ${steps || '…'} steps done` : 'Boot Camp', nextMod >= 0 && course ? `Next: ${esc(course.modules[nextMod].title)}.` : 'Pot odds, ranges, c-bets, exploiting players: the whole course.')}
    ${go('#train/preflop', 'Preflop', 'text-sky-300', 'Preflop trainer', 'Raise, call or fold from every seat, against live 9-handed charts.')}
    ${go('#review/sessions', 'Live results', '', live ? `<span class="${tone(live.net)}">${money(live.net)}</span> over ${live.n} session${live.n === 1 ? '' : 's'}` : 'Track your casino sessions', live ? `${money(live.perHour)} an hour · ${live.hours < 10 ? live.hours.toFixed(1) : Math.round(live.hours)} hours` : 'Start the clock at the table, cash out, see your $ an hour. Log hands too.')}
  </div>`;

  // ---- recent sessions, each opens in Review
  const recent = sessions.slice(0, 5).map(x => {
    const a = accuracyOf(x.hands);
    const net = x.hands.reduce((q, h) => q + (h.net ?? 0), 0);
    const c = gradeCounts(x.hands);
    return `<a href="#review/s/${x.sid}" class="flex items-center gap-3 px-4 py-3 hover:bg-ink-850/60">
      <div class="min-w-0 flex-1"><div class="text-sm font-semibold text-white truncate">${sessionTitle(x)}</div>
        <div class="text-xs text-ink-400">${new Date(x.sid).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${x.hands.length} hand${x.hands.length === 1 ? '' : 's'} · <span class="${tone(net)}">${fmtBB(net, { sign: true })}</span>${c.blunder ? ` · <span class="text-rose-300">${c.blunder} blunder${c.blunder > 1 ? 's' : ''}</span>` : ''}</div></div>
      <div class="text-right"><div class="text-xl font-semibold num ${accTone(a)}">${a ?? '—'}</div><div class="text-[10px] uppercase tracking-wider text-ink-400">accuracy</div></div>
      ${icon('next', 'w-4 h-4 text-ink-400')}</a>`;
  }).join('');

  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="text-sm text-ink-300">Graded at</div>
      ${levelSwitch({ blurb: false })}
    </div>
    <div class="grid md:grid-cols-2 gap-4">${playCard}${dailyCard}</div>
    ${focus}
    ${tiles}
    ${places}
    ${recent ? `<section>
      <div class="flex items-center justify-between mb-2"><div class="h-sec">Recent sessions</div><a href="#review" class="text-sm text-ink-300 hover:text-white">All sessions →</a></div>
      <div class="panel divide-y divide-ink-800">${recent}</div>
    </section>` : ''}
  </div>`;
  wireLevel(container, () => render(container));
}

const LEVELS_TABLE = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
