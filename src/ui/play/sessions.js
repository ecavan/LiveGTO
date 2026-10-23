/**
 * Sessions: your live results. Start a session at the casino (the clock runs, add re-buys, cash
 * out), or enter one afterwards; see profit, $/hour and big blinds per hour, by stakes and casino,
 * and the graph of your results over time.
 *   #play/sessions
 */
import {
  loadSessions, saveSessions, makeSession, startSession, endSession, totals, groupBy, curve, profit, toCSV, today, bbOf,
} from '../../engine/sessions.js';
import { icon, esc, stat } from '../kit.js';
import { playTabs } from './views.js';

let editing = null; // session id being edited, or 'new'
let tick = null;
let range = 'all'; // all | year | 90

const money = (x, { sign = false } = {}) => `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}$${Math.abs(Math.round(x)).toLocaleString()}`;
const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
const bbh = (x) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
const hrs = (h) => (h < 10 ? h.toFixed(1) : Math.round(h).toString());
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function inRange(s) {
  if (range === 'all') return true;
  const days = (Date.now() - new Date(`${s.date}T12:00:00`).getTime()) / 86400000;
  return range === 'year' ? s.date.slice(0, 4) === today().slice(0, 4) : days <= 90;
}

export function render(container) {
  clearInterval(tick);
  editing = null;
  draw(container);
  return () => clearInterval(tick);
}

function chart(points) {
  if (points.length < 2) return '<p class="text-sm text-ink-400">Your results graph appears after two sessions.</p>';
  const W = 600, H = 150;
  const vals = [0, ...points.map(p => p.total)];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(1, hi - lo);
  const x = (i) => (i / (vals.length - 1)) * W, y = (v) => H - 6 - ((v - lo) / span) * (H - 12);
  const last = vals[vals.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="w-full" style="height:${H}px">
      <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgb(var(--ink-600))" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${last >= 0 ? '#34d399' : '#f43f5e'}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="flex justify-between text-[11px] text-ink-400 num mt-1"><span>${fmtDate(points[0].date)}</span><span>${money(last, { sign: true })} after ${points.length} sessions</span></div>`;
}

function form(s) {
  const v = s || { date: today(), casino: lastOf('casino'), stakes: lastOf('stakes') || '1/2', buyin: '', cashout: '', hours: '', notes: '' };
  const casinos = [...new Set(loadSessions().map(x => x.casino).filter(Boolean))];
  return `<div class="panel panel-pad space-y-3" id="ss-form">
    <div class="font-semibold text-white">${s ? 'Edit session' : 'Add a session'}</div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <label class="space-y-1 block"><span class="h-sec">Date</span><input name="date" type="date" value="${esc(v.date)}" class="w-full"></label>
      <label class="space-y-1 block"><span class="h-sec">Casino</span><input name="casino" type="text" list="ss-casinos" value="${esc(v.casino)}" placeholder="optional" class="w-full"><datalist id="ss-casinos">${casinos.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="space-y-1 block"><span class="h-sec">Stakes</span><input name="stakes" type="text" value="${esc(v.stakes)}" placeholder="1/2" class="w-full"></label>
      <label class="space-y-1 block"><span class="h-sec">Hours</span><input name="hours" type="number" inputmode="decimal" step="0.25" min="0" value="${v.hours}" class="w-full"></label>
      <label class="space-y-1 block"><span class="h-sec">Buy-in ($, all of it)</span><input name="buyin" type="number" inputmode="decimal" min="0" value="${v.buyin}" class="w-full"></label>
      <label class="space-y-1 block"><span class="h-sec">Cash-out ($)</span><input name="cashout" type="number" inputmode="decimal" min="0" value="${v.cashout}" class="w-full"></label>
      <label class="space-y-1 block col-span-2"><span class="h-sec">Notes</span><input name="notes" type="text" value="${esc(v.notes)}" placeholder="table, players, how you played" class="w-full"></label>
    </div>
    <p id="ss-err" class="text-sm text-rose-300 hidden"></p>
    <div class="flex gap-2 flex-wrap"><button id="ss-save" class="btn btn-primary">Save</button><button id="ss-cancel" class="btn">Cancel</button>
      ${s ? '<button id="ss-del" class="btn btn-quiet text-rose-300 ml-auto">Delete</button>' : ''}</div>
  </div>`;
}

const lastOf = (field) => [...loadSessions()].reverse().find(s => s[field])?.[field] || '';

function runningCard(run) {
  const h = (Date.now() - run.start) / 3600000;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `<div class="panel panel-pad !border-emerald-700/60 space-y-3">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div><div class="h-sec !text-emerald-300">Playing now</div>
        <div class="text-xl font-semibold text-white mt-1">${esc(run.stakes)}${run.casino ? ` · ${esc(run.casino)}` : ''}</div>
        <div class="text-sm text-ink-300">Started ${new Date(run.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · in for ${money(run.buyin)}</div></div>
      <div class="text-3xl font-semibold text-white num" id="ss-clock">${hh}:${String(mm).padStart(2, '0')}</div>
    </div>
    <div class="grid sm:grid-cols-2 gap-3">
      <div class="flex gap-2"><input id="ss-add" type="number" inputmode="decimal" min="1" placeholder="re-buy ($)" class="w-full"><button id="ss-addbtn" class="btn">Add</button></div>
      <div class="flex gap-2"><input id="ss-out" type="number" inputmode="decimal" min="0" placeholder="cash-out ($)" class="w-full"><button id="ss-end" class="btn btn-primary whitespace-nowrap">Cash out</button></div>
    </div>
    <p id="ss-err" class="text-sm text-rose-300 hidden"></p>
    <button id="ss-discard" class="btn btn-quiet btn-sm text-ink-400">Discard this session</button>
  </div>`;
}

function startCard() {
  return `<div class="panel panel-pad space-y-3">
    <div class="font-semibold text-white">At the casino? Start the clock</div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
      <label class="space-y-1 block"><span class="h-sec">Stakes</span><input id="st-stakes" type="text" value="${esc(lastOf('stakes') || '1/2')}" class="w-full"></label>
      <label class="space-y-1 block"><span class="h-sec">Casino</span><input id="st-casino" type="text" value="${esc(lastOf('casino'))}" placeholder="optional" class="w-full"></label>
      <label class="space-y-1 block"><span class="h-sec">Buy-in ($)</span><input id="st-buyin" type="number" inputmode="decimal" min="1" class="w-full"></label>
      <button id="st-go" class="btn btn-primary">${icon('play', 'w-4 h-4')} Start</button>
    </div>
    <p id="st-err" class="text-sm text-rose-300 hidden"></p>
  </div>`;
}

function draw(container) {
  clearInterval(tick);
  const all = loadSessions();
  const run = all.find(s => s.running);
  const list = all.filter(s => !s.running && inRange(s)).sort((a, b) => b.date.localeCompare(a.date));
  const t = totals(list);
  const editRow = editing && editing !== 'new' ? all.find(s => s.id === editing) : null;
  const byStakes = groupBy(list, 'stakes');
  const byCasino = groupBy(list, 'casino');
  const table = (rows, label) => (rows.length < 2 ? '' : `<div class="panel panel-pad"><div class="h-sec mb-2">By ${label}</div>
    <table class="w-full text-sm num"><thead><tr class="text-left text-[11px] uppercase tracking-wide text-ink-400"><th class="pb-1 font-semibold">${label}</th><th class="font-semibold text-right">Hours</th><th class="font-semibold text-right">Profit</th><th class="font-semibold text-right">$/h</th><th class="font-semibold text-right">bb/h</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="border-t border-ink-800"><td class="py-1.5 text-white">${esc(r.key)}</td><td class="text-right">${hrs(r.hours)}</td><td class="text-right whitespace-nowrap ${tone(r.net)}">${money(r.net, { sign: true })}</td><td class="text-right whitespace-nowrap ${tone(r.perHour)}">${money(r.perHour, { sign: true })}</td><td class="text-right whitespace-nowrap">${bbh(r.bbPerHour)}</td></tr>`).join('')}</tbody></table></div>`);

  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Play</div><h1 class="h-title">Sessions</h1>
        <p class="muted mt-1 text-sm max-w-2xl">Your live results: profit, $ an hour and big blinds an hour, over time and by stakes and casino. Kept on this device; export a copy now and then.</p></div>
      ${playTabs('sessions')}
    </div>
    ${editing ? form(editRow) : run ? runningCard(run) : `${startCard()}<div class="flex gap-2 flex-wrap"><button id="ss-new" class="btn">${icon('pen', 'w-4 h-4')} Add a past session</button>${all.length ? '<button id="ss-csv" class="btn btn-quiet">Export CSV</button>' : ''}</div>`}
    ${all.some(s => !s.running) ? `<div class="flex justify-end"><div class="seg">${[['all', 'All time'], ['year', 'This year'], ['90', '90 days']].map(([v, l]) => `<button data-range="${v}" class="px-3 py-1.5 rounded-lg text-sm font-medium ${v === range ? 'bg-ink-700 text-white shadow-card' : 'text-ink-300 hover:text-ink-100'}">${l}</button>`).join('')}</div></div>` : ''}
    ${!t ? (all.some(s => !s.running) ? '<p class="text-sm text-ink-400">No sessions in this period.</p>' : '') : `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${stat('Profit', `<span class="${tone(t.net)}">${money(t.net, { sign: true })}</span>`, `${t.n} session${t.n === 1 ? '' : 's'} · ${hrs(t.hours)} hours`)}
      ${stat('Per hour', `<span class="${tone(t.perHour)}">${money(t.perHour, { sign: true })}</span>`, t.ci != null ? `±${money(t.ci)} (95%)` : 'needs 2+ sessions for a range')}
      ${stat('Big blinds / hour', bbh(t.bbPerHour), 'each session in its own blinds')}
      ${stat('Winning sessions', `${Math.round(t.winRate * 100)}%`, `best ${money(profit(t.best), { sign: true })} · worst ${money(profit(t.worst), { sign: true })}`)}
    </div>
    ${t.ci != null ? `<p class="text-xs text-ink-400">Live poker swings: your sessions vary by about ${money(t.sdHour)} an hour, so after ${hrs(t.hours)} hours your real rate is somewhere around ${money(t.perHour - t.ci, { sign: true })} to ${money(t.perHour + t.ci, { sign: true })} an hour. The range halves every time your hours quadruple.</p>` : ''}
    <div class="panel panel-pad"><div class="h-sec mb-2">Results</div>${chart(curve(list))}</div>
    <div class="grid md:grid-cols-2 gap-4 items-start">${table(byStakes, 'stakes')}${table(byCasino, 'casino')}</div>
    <div class="panel divide-y divide-ink-800">${list.map(s => `<button data-edit="${s.id}" class="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-ink-800/40">
      <div class="min-w-0 flex-1"><div class="text-white font-semibold">${fmtDate(s.date)} · ${esc(s.stakes)}${s.casino ? ` <span class="text-ink-300 font-normal">· ${esc(s.casino)}</span>` : ''}</div>
        <div class="text-xs text-ink-400 truncate">${hrs(s.hours)} h · in ${money(s.buyin)}, out ${money(s.cashout)}${s.notes ? ` · ${esc(s.notes)}` : ''}</div></div>
      <div class="text-right shrink-0"><div class="font-semibold num ${tone(profit(s))}">${money(profit(s), { sign: true })}</div><div class="text-[11px] text-ink-400 num">${s.hours >= 0.5 ? `${money(profit(s) / s.hours, { sign: true })}/h` : '&nbsp;'}</div></div></button>`).join('')}</div>`}
  </div>`;
  wire(container);
  if (run) tick = setInterval(() => { const el = container.querySelector('#ss-clock'); if (!el) { clearInterval(tick); return; } const h = (Date.now() - run.start) / 3600000; el.textContent = `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; }, 15000);
}

function showErr(container, sel, msg) { const e = container.querySelector(sel); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }

function wire(container) {
  const $ = (s) => container.querySelector(s);
  const all = () => loadSessions();
  $('#ss-new')?.addEventListener('click', () => { editing = 'new'; draw(container); });
  $('#ss-cancel')?.addEventListener('click', () => { editing = null; draw(container); });
  container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editing = b.dataset.edit; draw(container); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  container.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { range = b.dataset.range; draw(container); }));
  $('#ss-save')?.addEventListener('click', () => {
    const f = $('#ss-form');
    const v = Object.fromEntries([...f.querySelectorAll('input')].filter(i => i.name).map(i => [i.name, i.value]));
    const prev = editing !== 'new' ? all().find(s => s.id === editing) : null;
    const { session, error } = makeSession(v, prev);
    if (error) { showErr(container, '#ss-err', error); return; }
    const list = all().filter(s => s.id !== session.id);
    saveSessions([...list, session]);
    editing = null;
    draw(container);
  });
  $('#ss-del')?.addEventListener('click', (e) => {
    if (e.currentTarget.dataset.sure !== '1') { e.currentTarget.dataset.sure = '1'; e.currentTarget.textContent = 'Tap again to delete'; return; }
    saveSessions(all().filter(s => s.id !== editing));
    editing = null;
    draw(container);
  });
  $('#st-go')?.addEventListener('click', () => {
    const stakes = $('#st-stakes').value.trim(), buyin = Number($('#st-buyin').value);
    if (!bbOf(stakes)) { showErr(container, '#st-err', 'Enter the stakes, like 1/2 or 2/5.'); return; }
    if (!(buyin > 0)) { showErr(container, '#st-err', 'Enter your buy-in.'); return; }
    saveSessions([...all().filter(s => !s.running), startSession({ stakes, casino: $('#st-casino').value, buyin })]);
    draw(container);
  });
  $('#ss-addbtn')?.addEventListener('click', () => {
    const x = Number($('#ss-add').value);
    if (!(x > 0)) return;
    saveSessions(all().map(s => (s.running ? { ...s, buyin: Math.round((s.buyin + x) * 100) / 100 } : s)));
    draw(container);
  });
  $('#ss-end')?.addEventListener('click', () => {
    const raw = $('#ss-out').value;
    if (raw === '' || !(Number(raw) >= 0)) { showErr(container, '#ss-err', 'Enter what you cashed out (0 if you lost it all).'); return; }
    saveSessions(all().map(s => (s.running ? endSession(s, Number(raw)) : s)));
    draw(container);
  });
  $('#ss-discard')?.addEventListener('click', (e) => {
    if (e.currentTarget.dataset.sure !== '1') { e.currentTarget.dataset.sure = '1'; e.currentTarget.textContent = 'Tap again to discard it'; return; }
    saveSessions(all().filter(s => !s.running));
    draw(container);
  });
  $('#ss-csv')?.addEventListener('click', () => {
    const blob = new Blob([toCSV(all())], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `poker-sessions-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
