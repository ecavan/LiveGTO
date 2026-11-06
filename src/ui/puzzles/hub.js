/**
 * Puzzles hub (#puzzles): your rating and its curve, today's puzzle, your missed ones, a drill for
 * each leak (yours first), and one-tap presets for the kind of spot you want. The same shape as
 * ChessBot's Puzzles page. The solver itself is at #puzzles/rated.
 */
import { loadStats, dueItems, dailyStreak, dailyAt, today, LEAK_DRILLS, PROFILES } from '../../engine/puzzles.js';
import { loadHands, leakReport, LEAKS } from '../../engine/history.js';
import { getLevel, LEVELS } from '../../engine/level.js';
import { icon, esc, levelSwitch, wireLevel } from '../kit.js';
import { filters } from './filters.js';
import { puzzleTabs } from './tabs.js';

/** Preset spots: each sets the rated-puzzle filters (everything else cleared). */
export const PRESETS = {
  flop: { street: 'flop' }, turn: { street: 'turn' }, river: { street: 'river' },
  facing: { decision: 'facing' }, betting: { decision: 'betting' },
  hu: { players: 'hu' }, multiway: { players: 'multiway' },
  station: { profile: 'station' }, nit: { profile: 'nit' }, maniac: { profile: 'maniac' }, whale: { profile: 'whale' },
  monotone: { suits: 'monotone' }, 'two-tone': { suits: 'two-tone' }, paired: { paired: 'paired' },
  connected: { connect: 'connected' }, dry: { connect: 'dry' }, ace: { height: 'ace' }, low: { height: 'low' },
};

/** Apply a preset ('all' clears every filter). Returns false for an unknown one. */
export function applyPreset(name) {
  if (name !== 'all' && !PRESETS[name]) return false;
  for (const k of Object.keys(filters)) filters[k] = '';
  Object.assign(filters, PRESETS[name] || {});
  return true;
}

/** The preset the current filters match exactly, or 'all' for none, or null for a custom mix. */
function activePreset() {
  const on = Object.entries(filters).filter(([, v]) => v);
  if (!on.length) return 'all';
  if (on.length > 1) return null;
  return Object.keys(PRESETS).find(p => Object.entries(PRESETS[p]).every(([k, v]) => filters[k] === v)) ?? null;
}

/** Your rating at this level over the last puzzles, rebuilt from the per-puzzle rating changes. */
function ratingCurve(st) {
  const single = Object.keys(st.levels || {}).length <= 1;
  const hist = (st.history || []).filter(e => e.lv === st.level || (e.lv == null && single)).slice(-60);
  if (hist.length < 3) return null;
  const curve = [st.rating];
  for (let i = hist.length - 1; i >= 0; i--) curve.unshift(curve[0] - (hist[i].d || 0));
  return curve;
}

function sparkline(curve) {
  const W = 300, H = 56, pad = 4;
  const lo = Math.min(...curve), hi = Math.max(...curve);
  const x = (i) => pad + (i * (W - 2 * pad)) / (curve.length - 1);
  const y = (v) => pad + ((hi - v) * (H - 2 * pad)) / Math.max(1, hi - lo);
  const pts = curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = curve.at(-1) >= curve[0];
  const col = up ? '#34d399' : '#fb7185';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="w-full h-14" role="img" aria-label="Rating over your last ${curve.length - 1} puzzles: ${curve[0]} to ${curve.at(-1)}">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

const chip = (href, label, on = false, extra = '') =>
  `<a href="${href}" class="chip ${on ? 'chip-on' : ''}">${label}${extra}</a>`;

export function render(container) {
  const lv = getLevel();
  const st = loadStats();
  const due = dueItems(st).length;
  const queued = st.queue?.length ?? 0;
  const streak = dailyStreak(st);
  const daily = dailyAt(st, today());
  const solvedPct = st.played ? Math.round((100 * st.solved) / st.played) : null;
  const curve = ratingCurve(st);
  const recent = curve ? curve.at(-1) - curve[0] : 0;
  const preset = activePreset();

  // your postflop leaks (the ones a puzzle drill trains), costliest first
  const hands = loadHands();
  const mine = hands.length >= 10 ? leakReport(hands).leaks.filter(l => LEAK_DRILLS[l.key]).slice(0, 3) : [];
  const mineKeys = new Set(mine.map(l => l.key));

  const rated = `
    <div class="panel panel-pad !border-emerald-700/50 hero-play flex flex-col gap-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="h-sec"><span class="text-emerald-300">Rated puzzles · ${LEVELS[lv].short}</span></div>
          <div class="text-4xl font-semibold text-white num mt-1">${st.played ? st.rating : '—'}</div>
          <div class="text-sm text-ink-300 mt-1">${st.played ? `${st.played} played · ${solvedPct}% solved${curve ? ` · <span class="${recent > 0 ? 'text-emerald-300' : recent < 0 ? 'text-rose-300' : ''}">${recent > 0 ? '+' : ''}${recent}</span> over your last ${curve.length - 1}` : ''}` : 'Every puzzle starts you at 1000. Solve one to get a rating.'}</div>
        </div>
        ${icon('puzzle', 'w-8 h-8 text-emerald-300 shrink-0')}
      </div>
      ${curve ? sparkline(curve) : ''}
      <p class="text-sm text-ink-300">A real solved spot with your real cards. Find the play that makes the most money. Puzzles near your rating come first: solve one and your rating goes up, miss one and it comes back for review.</p>
      <div class="flex gap-2 flex-wrap">
        <a href="#puzzles/rated/all" class="btn btn-primary">${icon('play', 'w-4 h-4')} Solve mixed puzzles</a>
        ${preset !== 'all' ? `<a href="#puzzles/rated" class="btn">Carry on with your filters</a>` : ''}
      </div>
    </div>`;

  const side = `
    <div class="grid gap-4">
      <a href="#puzzles/daily" class="card-link panel panel-pad flex flex-col gap-1">
        <div class="h-sec"><span class="text-amber-300">Daily puzzle</span></div>
        <div class="text-lg font-semibold text-white">${daily ? (daily.v === 'mistake' ? 'Missed today. It comes back for review.' : 'Solved today ✓') : 'Today\'s puzzle is ready'}</div>
        <div class="text-sm text-ink-300">${streak ? `${streak}-day streak. ` : ''}One spot a day, not rated.</div>
      </a>
      <a href="#puzzles/review" class="card-link panel panel-pad flex flex-col gap-1">
        <div class="h-sec"><span class="text-rose-300">Review mistakes</span></div>
        <div class="text-lg font-semibold text-white">${due ? `${due} due now` : queued ? 'Nothing due today' : 'No missed puzzles'}</div>
        <div class="text-sm text-ink-300">${queued ? `${queued} in the queue. ` : ''}A puzzle you miss comes back after 1, 3 and 7 days until you solve it.</div>
      </a>
    </div>`;

  const rank = (k) => (mineKeys.has(k) ? mine.findIndex(l => l.key === k) : 99);
  const leakChips = Object.keys(LEAK_DRILLS)
    .sort((a, b) => rank(a) - rank(b))
    .map(k => chip(`#puzzles/drill/${k}`, esc(LEAKS[k]?.name ?? k), false, mineKeys.has(k) ? ' <span class="text-rose-300 ml-1">●</span>' : ''))
    .join('');
  const drills = `
    <section class="panel panel-pad space-y-3">
      <div>
        <div class="h-sec"><span class="text-sky-300">Fix a leak</span></div>
        <p class="text-sm text-ink-300 mt-1">${mine.length
    ? `From your last ${hands.length} hands, your costliest is <b class="text-white">${esc(mine[0].name.toLowerCase())}</b>. Each drill picks spots where that mistake is the one to avoid, about two times in three. Drills count toward your rating.`
    : 'Each drill picks spots where one kind of mistake is the one to avoid, about two times in three. Play 10 hands and your own leaks are marked here. Drills count toward your rating.'}</p>
      </div>
      <div class="flex flex-wrap gap-2">${leakChips}</div>
      ${mine.length ? '<div class="text-xs text-ink-400"><span class="text-rose-300">●</span> one of your leaks</div>' : ''}
    </section>`;

  const group = (title, items) => `<div class="space-y-1.5"><div class="text-xs uppercase tracking-wider text-ink-400 font-semibold">${title}</div>
    <div class="flex flex-wrap gap-2">${items.map(([p, l]) => chip(`#puzzles/rated/${p}`, l, preset === p)).join('')}</div></div>`;
  const spots = `
    <section class="panel panel-pad space-y-4">
      <div>
        <div class="h-sec"><span class="text-violet-300">Practise a kind of spot</span></div>
        <p class="text-sm text-ink-300 mt-1">Rated puzzles of one kind only. Fine-tune it with the Filters under the puzzle.</p>
      </div>
      ${group('Street', [['flop', 'Flop'], ['turn', 'Turn'], ['river', 'River']])}
      ${group('Your decision', [['facing', 'Facing a bet'], ['betting', 'Bet or check'], ['hu', 'Heads-up'], ['multiway', 'Multiway']])}
      ${lv === 2 ? group('Villain type', Object.entries(PROFILES).filter(([k]) => k !== 'gto').map(([k, v]) => [k, `vs ${esc(v)}`])) : ''}
      ${group('Board', [['monotone', 'Monotone'], ['two-tone', 'Two-tone'], ['paired', 'Paired'], ['connected', 'Connected'], ['dry', 'Dry'], ['ace', 'A-high'], ['low', '7-high or lower']])}
      ${lv === 1 ? '<p class="text-xs text-ink-400">Level 1 puzzles are against a solid player. Switch to Level 2 to pick a villain type.</p>' : ''}
    </section>`;

  const tools = `<div class="grid sm:grid-cols-2 gap-4">
    <a href="#puzzles/ranges" class="card-link panel panel-pad">
      <div class="h-sec"><span class="text-sky-300">Ranges</span></div>
      <div class="text-white font-semibold mt-1">Build a preflop range</div>
      <div class="text-sm text-ink-300 mt-1">Paint the hands you open or call from a seat, then see how close you are to the chart.</div></a>
    <a href="#puzzles/buckets" class="card-link panel panel-pad">
      <div class="h-sec"><span class="text-sky-300">Buckets</span></div>
      <div class="text-white font-semibold mt-1">Play your range, not your hand</div>
      <div class="text-sm text-ink-300 mt-1">Split your whole range into buckets (value, draws, bluff-catchers, air) and pick one play for each. Works offline.</div></a>
  </div>`;

  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><div class="h-sec">Puzzles</div><h1 class="h-title">Find the best play</h1></div>
      ${levelSwitch({ blurb: false })}
    </div>
    <div>${puzzleTabs('')}</div>
    <div class="grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">${rated}${side}</div>
    ${drills}
    ${spots}
    ${tools}
  </div>`;
  wireLevel(container, () => { filters.profile = ''; render(container); });
}
