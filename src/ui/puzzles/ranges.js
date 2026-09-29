/**
 * Range builder: paint a preflop range on the 13×13 grid (raise / call / fold), submit, and see it
 * graded cell by cell against the live chart (Ed Miller, The Course). Drag to paint on an iPad.
 */
import { RFI_RANGES, FACING_OPEN, comboShare } from '../../engine/ranges.js';
import { GRID, icon, esc, seg, wireSeg } from '../kit.js';
import { loadStats, saveStats } from '../../engine/puzzles.js';
import { puzzleTabs } from './tabs.js';
import { pct } from '../../engine/potmath.js';

const COMBOS = (k) => (k.length === 2 ? 6 : k.endsWith('s') ? 4 : 12);
const COL = { raise: '#10b981', call: '#0ea5e9', fold: 'rgb(var(--ink-800))' };
const NAME = { UTG: 'under the gun', MP: 'middle position', CO: 'the cutoff', BTN: 'the button', SB: 'the small blind', BB: 'the big blind' };

export const SPOTS = [
  ...['UTG', 'MP', 'CO', 'BTN', 'SB'].map(p => ({ id: `rfi-${p}`, kind: 'rfi', hero: p, title: `Open from ${p}`, desc: `Folded to you in ${NAME[p]}. Raise or fold: no limping.` })),
  ...[['BTN', 'UTG'], ['BTN', 'CO'], ['CO', 'UTG'], ['SB', 'BTN'], ['BB', 'UTG'], ['BB', 'BTN']].map(([h, o]) => ({
    id: `vs-${h}-${o}`, kind: 'facing', hero: h, opener: o, title: `${h} vs ${o} open`,
    desc: `${o} raises, folded to you in ${NAME[h]}. 3-bet, call or fold.${h === 'SB' ? ' From the small blind: 3-bet or fold.' : ''}`,
  })),
];

/** The chart's answer for every cell: 'raise' | 'call' | 'fold'. */
export function chartOf(spot) {
  const out = {};
  const { raise, call } = spot.kind === 'rfi' ? { raise: RFI_RANGES[spot.hero], call: new Set() } : FACING_OPEN[`${spot.hero}|${spot.opener}`];
  for (const k of GRID) out[k] = raise.has(k) ? 'raise' : call.has(k) ? 'call' : 'fold';
  return out;
}

/**
 * Grade a painted range against the chart, weighted by combos.
 * score = combos played right / combos either of you plays (folds you both agree on don't count).
 */
export function gradeRange(spot, painted) {
  const chart = chartOf(spot);
  let right = 0, union = 0, loose = 0, tight = 0, swapped = 0;
  const cells = {};
  for (const k of GRID) {
    const want = chart[k], got = painted[k] || 'fold';
    const w = COMBOS(k);
    if (want === 'fold' && got === 'fold') { cells[k] = 'ok-fold'; continue; }
    union += w;
    if (want === got) { right += w; cells[k] = 'ok'; }
    else if (want === 'fold') { loose += w; cells[k] = 'loose'; }
    else if (got === 'fold') { tight += w; cells[k] = 'tight'; }
    else { swapped += w; cells[k] = 'swap'; right += w * 0.5; }
  }
  const score = union ? right / union : 1;
  return { score, loose: loose / 1326, tight: tight / 1326, swapped: swapped / 1326, cells, chart };
}

const size = (painted, act) => comboShare(new Set(GRID.filter(k => painted[k] === act)));

let st = { spot: SPOTS[3], painted: {}, brush: 'raise', result: null, hint: true };

export function render(container) {
  draw(container);
  const up = () => { st.painting = null; };
  window.addEventListener('pointerup', up);
  return () => window.removeEventListener('pointerup', up);
}

function draw(container) {
  const spot = st.spot;
  const stats = loadStats();
  const best = stats.rangeBest?.[spot.id];
  const r = st.result;
  const target = chartOf(spot);
  const tRaise = comboShare(new Set(GRID.filter(k => target[k] === 'raise')));
  const tCall = comboShare(new Set(GRID.filter(k => target[k] === 'call')));
  const actions = spot.kind === 'rfi' || spot.hero === 'SB' ? ['raise', 'fold'] : ['raise', 'call', 'fold'];
  const label = { raise: spot.kind === 'rfi' ? 'Raise' : '3-bet', call: 'Call', fold: 'Fold' };

  const cellBg = (k) => {
    if (!r) return COL[st.painted[k] || 'fold'];
    const c = r.cells[k];
    return c === 'ok' ? COL[r.chart[k]] : c === 'ok-fold' ? COL.fold : c === 'loose' ? '#e11d48' : c === 'tight' ? '#f59e0b' : '#8b5cf6';
  };
  const cellTitle = (k) => {
    if (!r) return `${k}: ${label[st.painted[k] || 'fold']}`;
    const c = r.cells[k];
    const you = label[st.painted[k] || 'fold'], ch = label[r.chart[k]];
    return c.startsWith('ok') ? `${k}: ${ch} (right)` : `${k}: you ${you}, chart ${ch}`;
  };
  const grid = `<div class="rg select-none" id="rb-grid" style="touch-action:none;max-width:560px">${GRID.map(k => `<div data-k="${k}" style="background:${cellBg(k)};cursor:pointer" title="${cellTitle(k)}" class="${r && !r.cells[k].startsWith('ok') ? 'ring-1 ring-white/60' : ''}">${k}</div>`).join('')}</div>`;

  const scoreTone = (s) => (s >= 0.9 ? 'text-emerald-300' : s >= 0.75 ? 'text-sky-300' : s >= 0.6 ? 'text-yellow-300' : 'text-rose-300');
  const side = r ? `<div class="space-y-3 fade-up">
      <div class="verdict ${r.score >= 0.9 ? 'v-best' : r.score >= 0.75 ? 'v-fine' : 'v-mistake'}">
        <div class="text-3xl font-semibold num ${scoreTone(r.score)}">${Math.round(100 * r.score)}%</div>
        <div class="text-sm text-ink-200 mt-1">${r.score >= 0.95 ? 'Spot on. That is the chart.' : r.score >= 0.85 ? 'Very close to the chart.' : r.score >= 0.7 ? 'The shape is right; the edges need work.' : 'A long way off the chart. Look at the colours.'}</div>
      </div>
      <div class="space-y-1.5 text-sm">
        <div class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm inline-block" style="background:#e11d48"></i><span class="text-ink-200">Too loose: <b class="text-white">${pct(r.loose)}</b> of hands you play that the chart folds</span></div>
        <div class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm inline-block" style="background:#f59e0b"></i><span class="text-ink-200">Too tight: <b class="text-white">${pct(r.tight)}</b> of hands you fold that the chart plays</span></div>
        ${actions.length === 3 ? `<div class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm inline-block" style="background:#8b5cf6"></i><span class="text-ink-200">Wrong action: <b class="text-white">${pct(r.swapped)}</b> (3-bet vs call)</span></div>` : ''}
        <div class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm inline-block" style="background:${COL.raise}"></i><span class="text-ink-200">Right (${label.raise}${actions.length === 3 ? ` / <span style="color:${COL.call}">call</span>` : ''})</span></div>
      </div>
      <p class="text-xs text-ink-400">Chart: ${label.raise.toLowerCase()} ${pct(tRaise)}${tCall ? `, call ${pct(tCall)}` : ''} of hands. Score = combos played right ÷ combos either of you plays.</p>
      <div class="grid grid-cols-2 gap-2"><button id="rb-again" class="btn">Try again</button><button id="rb-next" class="btn btn-primary">Next spot ${icon('next', 'w-4 h-4')}</button></div>
    </div>`
    : `<div class="space-y-3">
      <div class="text-sm text-ink-300">${esc(spot.desc)}</div>
      <div class="space-y-1"><div class="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">Brush</div>
        <div class="grid gap-2" style="grid-template-columns:repeat(${actions.length},minmax(0,1fr))">${actions.map(a => `<button data-brush="${a}" class="act ${a === 'fold' ? 'act-fold' : a === 'call' ? 'act-pass' : 'act-aggr'} ${st.brush === a ? '!ring-2 !ring-amber-300' : ''}">${label[a]}</button>`).join('')}</div></div>
      <div class="text-sm text-ink-200">Your range: <b class="text-white">${pct(size(st.painted, 'raise'))}</b> ${label.raise.toLowerCase()}${actions.length === 3 ? `, <b class="text-white">${pct(size(st.painted, 'call'))}</b> call` : ''}
        ${st.hint ? `<span class="text-ink-400"> · target about ${pct(tRaise)}${tCall ? ` + ${pct(tCall)}` : ''}</span>` : ''}</div>
      <label class="flex items-center gap-2 text-xs text-ink-400"><input type="checkbox" id="rb-hint" ${st.hint ? 'checked' : ''} class="accent-amber-400"> Show the target size</label>
      <p class="text-xs text-ink-400">Tap or drag across cells to paint them. Pairs on the diagonal, suited above, offsuit below.</p>
      <div class="grid grid-cols-3 gap-2"><button id="rb-clear" class="btn">Clear</button><button id="rb-submit" class="btn btn-primary col-span-2">Check my range</button></div>
    </div>`;

  container.innerHTML = `<div class="page space-y-4">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Puzzles</div><h1 class="h-title">Range builder</h1>
        <p class="muted mt-1 text-sm">Build the whole range, not one hand. Graded against the live chart from The Course.</p></div>
      ${best != null ? `<div class="text-right"><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Best here</div><div class="text-2xl font-semibold num ${scoreTone(best)}">${Math.round(100 * best)}%</div></div>` : ''}
    </div>
    <div>${puzzleTabs('ranges')}</div>
    <div class="flex flex-wrap gap-1.5">${SPOTS.map(s => {
      const b = stats.rangeBest?.[s.id];
      return `<button data-spot="${s.id}" class="mv ${s.id === spot.id ? 'on' : ''}">${esc(s.title)}${b != null ? ` <span class="text-[10px] ${scoreTone(b)}">${Math.round(100 * b)}%</span>` : ''}</button>`;
    }).join('')}</div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
      <div class="panel panel-pad flex justify-center">${grid}</div>
      <div class="panel panel-pad">${side}</div>
    </div>
  </div>`;
  wire(container);
}

function wire(container) {
  const g = container.querySelector('#rb-grid');
  const paint = (el) => {
    const k = el?.dataset?.k;
    if (!k || st.result) return;
    const v = st.painting === 'erase' ? 'fold' : st.brush;
    if ((st.painted[k] || 'fold') === v) return;
    st.painted[k] = v;
    el.style.background = COL[v];
    const info = container.querySelector('#rb-grid');
    if (info) updateSize(container);
  };
  g.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el || st.result) return;
    e.preventDefault();
    // tapping a cell that already has the brush's action clears it (fold), and the drag erases
    st.painting = (st.painted[el.dataset.k] || 'fold') === st.brush && st.brush !== 'fold' ? 'erase' : 'paint';
    paint(el);
  });
  g.addEventListener('pointermove', (e) => {
    if (!st.painting) return;
    paint(document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-k]'));
  });
  container.querySelectorAll('[data-brush]').forEach(b => b.addEventListener('click', () => { st.brush = b.dataset.brush; draw(container); }));
  container.querySelectorAll('[data-spot]').forEach(b => b.addEventListener('click', () => {
    st = { ...st, spot: SPOTS.find(s => s.id === b.dataset.spot), painted: {}, result: null, brush: 'raise' };
    draw(container);
  }));
  container.querySelector('#rb-clear')?.addEventListener('click', () => { st.painted = {}; draw(container); });
  container.querySelector('#rb-hint')?.addEventListener('change', (e) => { st.hint = e.target.checked; draw(container); });
  container.querySelector('#rb-submit')?.addEventListener('click', () => {
    st.result = gradeRange(st.spot, st.painted);
    const stats = loadStats();
    stats.rangeBest = { ...(stats.rangeBest || {}), [st.spot.id]: Math.max(stats.rangeBest?.[st.spot.id] ?? 0, st.result.score) };
    saveStats(stats);
    draw(container);
  });
  container.querySelector('#rb-again')?.addEventListener('click', () => { st.result = null; draw(container); });
  container.querySelector('#rb-next')?.addEventListener('click', () => {
    const i = SPOTS.findIndex(s => s.id === st.spot.id);
    st = { ...st, spot: SPOTS[(i + 1) % SPOTS.length], painted: {}, result: null, brush: 'raise' };
    draw(container);
  });
}

function updateSize(container) {
  // cheap: redraw only the size line
  const el = [...container.querySelectorAll('.text-sm.text-ink-200')].find(x => x.textContent.startsWith('Your range'));
  if (!el) return;
  const spot = st.spot;
  const target = chartOf(spot);
  const tRaise = comboShare(new Set(GRID.filter(k => target[k] === 'raise')));
  const tCall = comboShare(new Set(GRID.filter(k => target[k] === 'call')));
  const three = !(spot.kind === 'rfi' || spot.hero === 'SB');
  const lab = spot.kind === 'rfi' ? 'raise' : '3-bet';
  el.innerHTML = `Your range: <b class="text-white">${pct(size(st.painted, 'raise'))}</b> ${lab}${three ? `, <b class="text-white">${pct(size(st.painted, 'call'))}</b> call` : ''}
    ${st.hint ? `<span class="text-ink-400"> · target about ${pct(tRaise)}${tCall ? ` + ${pct(tCall)}` : ''}</span>` : ''}`;
}
