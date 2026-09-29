/**
 * Preflop trainer (live 9-handed, The Course): first in, raise or fold; facing an open, 3-bet,
 * call or fold. Drill mode deals hands; chart mode shows every range.
 */
import { RFI_RANGES, FACING_OPEN, comboShare } from '../../engine/ranges.js';
import { icon, cards, verdict, seg, wireSeg, rangeGrid, GRID, esc } from '../kit.js';
import { loadRaw, save, KEYS } from '../../store.js';

const POS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';

let st = { mode: 'drill', pos: '', q: null, answered: null, streak: 0, chart: 'RFI|CO' };

function keyOf(a, b) {
  const ra = RANKS.indexOf(a[0]), rb = RANKS.indexOf(b[0]);
  const hi = ra >= rb ? a : b, lo = hi === a ? b : a;
  if (hi[0] === lo[0]) return hi[0] + lo[0];
  return hi[0] + lo[0] + (hi[1] === lo[1] ? 's' : 'o');
}

function spots(pos) {
  const out = [];
  for (const p of ['UTG', 'MP', 'CO', 'BTN', 'SB']) out.push({ kind: 'rfi', hero: p });
  for (const k of Object.keys(FACING_OPEN)) { const [h, o] = k.split('|'); out.push({ kind: 'facing', hero: h, opener: o }); }
  return pos ? out.filter(s => s.hero === pos) : out;
}

function deal() {
  const pool = spots(st.pos);
  const sp = pool[Math.floor(Math.random() * pool.length)];
  const d = [];
  while (d.length < 2) {
    const c = RANKS[Math.floor(Math.random() * 13)] + SUITS[Math.floor(Math.random() * 4)];
    if (!d.includes(c)) d.push(c);
  }
  d.sort((a, b) => RANKS.indexOf(b[0]) - RANKS.indexOf(a[0]));
  const key = keyOf(d[0], d[1]);
  let correct, raise, call;
  if (sp.kind === 'rfi') {
    raise = RFI_RANGES[sp.hero];
    call = new Set();
    correct = raise.has(key) ? 'raise' : 'fold';
  } else {
    ({ raise, call } = FACING_OPEN[`${sp.hero}|${sp.opener}`]);
    correct = raise.has(key) ? 'raise' : call.has(key) ? 'call' : 'fold';
  }
  st.q = { ...sp, hand: d, key, correct, raise, call };
  st.answered = null;
}

export function render(container) {
  if (!st.q) deal();
  draw(container);
  return () => { document.onkeydown = null; };
}

function chartGrid(raise, call, me) {
  return rangeGrid(GRID.map(l => ({
    label: l, me: l === me,
    bg: raise.has(l) ? 'rgba(16,185,129,.7)' : call.has(l) ? 'rgba(56,189,248,.55)' : 'rgb(var(--ink-800))',
  })));
}

function draw(container) {
  const drills = loadRaw(KEYS.drills, {});
  const rec = drills.preflop || { n: 0, right: 0, best: 0 };
  let main;
  if (st.mode === 'drill') {
    const q = st.q;
    const has = st.answered != null;
    const labels = q.kind === 'rfi' ? [['raise', 'Raise'], ['fold', 'Fold']]
      : q.call.size ? [['raise', '3-bet'], ['call', 'Call'], ['fold', 'Fold']] : [['raise', '3-bet'], ['fold', 'Fold']];
    const situation = q.kind === 'rfi' ? `Folded to you in the <b>${q.hero}</b>.` : `<b>${q.opener}</b> opens to 3bb. You are in the <b>${q.hero}</b>.`;
    const share = Math.round(100 * (comboShare(q.raise) + comboShare(q.call)));
    main = `<div class="panel panel-pad space-y-5">
      <div class="text-center text-lg text-ink-100">${situation}</div>
      <div class="flex justify-center gap-2">${cards(q.hand, 'xl', 'deal')}</div>
      <div class="grid gap-2" style="grid-template-columns: repeat(${labels.length}, minmax(0,1fr))">
        ${labels.map(([v, l], i) => {
          let cls = v === 'fold' ? 'act-fold' : v === 'call' ? 'act-pass' : 'act-aggr';
          if (has && v === q.correct) cls = 'bg-emerald-500/20 border-emerald-400 text-emerald-100';
          else if (has && v === st.answered) cls = 'bg-rose-500/20 border-rose-400 text-rose-100';
          return `<button class="act ${cls}" data-a="${v}" ${has ? 'disabled' : ''}>${l}<span class="absolute top-1.5 right-2 text-[10px] text-ink-400 hidden lg:block">${i + 1}</span></button>`;
        }).join('')}
      </div>
      ${has ? `${verdict(st.answered === q.correct ? 'best' : 'mistake', st.answered === q.correct ? `Correct: ${q.key} is a ${q.correct}` : `${q.key} is a ${q.correct}`,
        `${q.kind === 'rfi' ? `${q.hero} opens ${share}% of hands. Raise or fold: never open-limp.` : `vs a ${q.opener} open, ${q.hero} continues with ${share}% of hands.${q.hero === 'SB' ? ' From the SB it is 3-bet or fold.' : ''}`}`)}
        <div class="space-y-2"><div class="flex gap-3 text-xs text-ink-300"><span><i class="inline-block w-3 h-3 rounded-sm align-middle mr-1" style="background:rgba(16,185,129,.7)"></i>${q.kind === 'rfi' ? 'Raise' : '3-bet'}</span>${q.kind === 'rfi' ? '' : '<span><i class="inline-block w-3 h-3 rounded-sm align-middle mr-1" style="background:rgba(56,189,248,.55)"></i>Call</span>'}</div>
          ${chartGrid(q.raise, q.call, q.key)}</div>
        <button id="pf-next" class="btn btn-primary btn-lg btn-block">Next hand ${icon('next', 'w-5 h-5')}</button>` : ''}
    </div>`;
  } else {
    const [kind, a] = st.chart.split('|');
    const opts = [...['UTG', 'MP', 'CO', 'BTN', 'SB'].map(p => [`RFI|${p}`, `${p} open`]), ...Object.keys(FACING_OPEN).map(k => [`F|${k}`, `${k.split('|')[0]} vs ${k.split('|')[1]}`])];
    let raise, call = new Set(), title;
    if (kind === 'RFI') { raise = RFI_RANGES[a]; title = `${a}: open`; }
    else { const k = st.chart.slice(2); ({ raise, call } = FACING_OPEN[k]); title = `${k.split('|')[0]} facing a ${k.split('|')[1]} open`; }
    main = `<div class="panel panel-pad space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap"><div class="text-lg font-semibold text-white">${esc(title)}</div>
        <select id="pf-chart">${opts.map(([v, l]) => `<option value="${v}" ${v === st.chart ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="text-sm text-ink-300">${kind === 'RFI' ? `Raise ${Math.round(100 * comboShare(raise))}% of hands` : `3-bet ${Math.round(100 * comboShare(raise))}% · call ${Math.round(100 * comboShare(call))}%`}</div>
      ${chartGrid(raise, call, null)}
    </div>`;
  }
  container.innerHTML = `<div class="page max-w-3xl space-y-4 fade-up">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
      ${seg('mode', [{ v: 'drill', label: 'Drill' }, { v: 'charts', label: 'Charts' }], st.mode)}
    </div>
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><div class="h-sec">Preflop</div><h1 class="h-title">Live 9-handed charts</h1><p class="text-sm text-ink-300 mt-1">Ed Miller, <i>The Course</i>. 100bb, $1/$2–$2/$5.</p></div>
      ${st.mode === 'drill' ? `<div class="flex gap-4 text-right">
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Streak</div><div class="text-2xl font-semibold num text-emerald-300">${st.streak}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">All time</div><div class="text-2xl font-semibold num">${rec.n ? Math.round((100 * rec.right) / rec.n) : 0}%</div></div></div>` : ''}
    </div>
    ${st.mode === 'drill' ? `<div class="flex gap-1.5 flex-wrap">${['', ...POS].map(p => `<button data-pos="${p}" class="px-3 py-1.5 rounded-full text-sm font-semibold border ${st.pos === p ? 'bg-emerald-500/15 border-emerald-400 text-emerald-200' : 'bg-ink-850 border-ink-700 text-ink-300'}">${p || 'All seats'}</button>`).join('')}</div>` : ''}
    ${main}
  </div>`;
  wireSeg(container, (n, v) => { st.mode = v; draw(container); });
  container.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { st.pos = b.dataset.pos; deal(); draw(container); }));
  container.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => answer(container, b.dataset.a)));
  container.querySelector('#pf-next')?.addEventListener('click', () => { deal(); draw(container); });
  container.querySelector('#pf-chart')?.addEventListener('change', (e) => { st.chart = e.target.value; draw(container); });
  document.onkeydown = (e) => {
    if (!container.isConnected || st.mode !== 'drill') return;
    if (/^[1-3]$/.test(e.key)) container.querySelectorAll('[data-a]')[Number(e.key) - 1]?.click();
    if (e.key === 'Enter' || e.key === ' ') { const b = container.querySelector('#pf-next'); if (b) { e.preventDefault(); b.click(); } }
  };
}

function answer(container, a) {
  if (st.answered != null) return;
  st.answered = a;
  const ok = a === st.q.correct;
  st.streak = ok ? st.streak + 1 : 0;
  const drills = loadRaw(KEYS.drills, {});
  const rec = drills.preflop || { n: 0, right: 0, best: 0 };
  rec.n++; if (ok) rec.right++; rec.best = Math.max(rec.best, st.streak);
  drills.preflop = rec;
  save(KEYS.drills, drills);
  draw(container);
}
