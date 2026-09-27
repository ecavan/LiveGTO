/**
 * Puzzles — chess.com-style: a real spot, your real cards, one correct action.
 * Graded by EV against the solver (GTO) or against a specific villain type (node-locked).
 */
import { renderPokerTable, renderCard } from './components.js';
import { cardToDisplay } from '../engine/cards.js';
import {
  PROFILES, candidates, families, pickPuzzle, key, grade, updateRating, explain,
  cellLabel, cellOf, loadStats, saveStats,
} from '../engine/puzzles.js';
import { pct } from '../engine/potmath.js';

let index = null;
const files = new Map();
let stats = loadStats();
let filters = { street: '', profile: '', decision: '', family: '' };
let current = null; // { cand, record, puzzle, answered, gridTab }

async function getIndex() {
  if (!index) {
    const res = await fetch('/library/index.json');
    if (!res.ok) throw new Error('Puzzle library not found');
    index = await res.json();
  }
  return index;
}

async function getRecord(cand) {
  if (!files.has(cand.file)) {
    const res = await fetch(`/library/${cand.file}`);
    files.set(cand.file, await res.json());
  }
  return files.get(cand.file).records.find(r => r.id === cand.id);
}

export async function render(container) {
  container.innerHTML = `<p class="text-center text-gray-500 pt-12">Loading puzzles…</p>`;
  try {
    await getIndex();
  } catch (e) {
    container.innerHTML = `<p class="text-center text-red-400 pt-12">${e.message}. Build it with <code>ps library</code> (see solver/README).</p>`;
    return;
  }
  await next(container);
}

async function next(container) {
  const cands = candidates(index, filters);
  const cand = pickPuzzle(cands, stats.rating, new Set(stats.seen));
  if (!cand) {
    current = null;
    draw(container);
    return;
  }
  const record = await getRecord(cand);
  current = { cand, record, puzzle: record.puzzles[cand.i], answered: null, gridTab: 'villain' };
  draw(container);
}

// ------------------------------------------------------------------ rendering

function filterBar() {
  const opt = (v, label, sel) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${label}</option>`;
  return `
  <div class="flex flex-wrap gap-2 justify-center text-xs">
    <select data-f="profile" class="bg-gray-900 border border-gray-700 rounded px-2 py-1">
      ${opt('', 'All villain types', filters.profile)}
      ${Object.entries(PROFILES).filter(([k]) => k !== 'gto').map(([k, v]) => opt(k, `vs ${v}`, filters.profile)).join('')}
      ${opt('gto', 'vs GTO (baseline)', filters.profile)}
      ${opt('all', 'Everything', filters.profile)}
    </select>
    <select data-f="family" class="bg-gray-900 border border-gray-700 rounded px-2 py-1">
      ${opt('', 'All pots', filters.family)}
      ${families(index).map(f => opt(f.id, f.name, filters.family)).join('')}
    </select>
    <select data-f="street" class="bg-gray-900 border border-gray-700 rounded px-2 py-1">
      ${opt('', 'Turn + river', filters.street)}${opt('turn', 'Turn', filters.street)}${opt('river', 'River', filters.street)}
    </select>
    <select data-f="decision" class="bg-gray-900 border border-gray-700 rounded px-2 py-1">
      ${opt('', 'All spots', filters.decision)}
      ${opt('facing', 'Facing a bet', filters.decision)}
      ${opt('betting', 'Bet or check', filters.decision)}
    </select>
  </div>`;
}

function header() {
  const acc = stats.played ? Math.round((100 * stats.solved) / stats.played) : 0;
  return `
  <div class="flex items-center justify-between">
    <div>
      <div class="text-xs text-gray-500 uppercase tracking-wide">Puzzle rating</div>
      <div class="text-2xl font-bold text-emerald-400 font-mono" id="pz-rating">${stats.rating}</div>
    </div>
    <div class="text-right text-xs text-gray-500">
      ${stats.played} played · ${acc}% solved
      ${current ? `<div class="text-gray-400 mt-0.5">puzzle ${current.puzzle.rating}</div>` : ''}
    </div>
  </div>`;
}

function historyLines(r) {
  const street = { turn: 'Turn', river: 'River' }[r.street];
  const prior = r.history.prior.join(', ');
  const cur = r.history.street.length ? r.history.street.join(', ') : '—';
  return `
  <div class="text-xs text-gray-400 space-y-0.5 font-mono">
    <div><span class="text-gray-600">Preflop</span> ${r.history.preflop}</div>
    <div><span class="text-gray-600">Before</span> ${prior}</div>
    <div><span class="text-gray-600">${street}</span> ${cur}</div>
  </div>`;
}

function villainBadge(r) {
  const color = r.villain.profile === 'gto' ? 'border-sky-700/50 bg-sky-900/20 text-sky-300'
    : 'border-amber-700/50 bg-amber-900/20 text-amber-300';
  return `
  <div class="rounded-lg border ${color} px-3 py-2">
    <div class="text-sm font-semibold">Villain (${r.villain.pos}): ${r.villain.name}</div>
    <div class="text-xs text-gray-400 mt-0.5">${r.villain.desc}</div>
  </div>`;
}

/** Heads-up table: hero at the bottom (seat 1), villain at the top (seat 4), nobody else. */
function table(r, p) {
  const heroCards = [p.cards.slice(0, 2), p.cards.slice(2, 4)].map(cardToDisplay);
  const seats = Array.from({ length: 6 }, () => ({ hidden: true }));
  seats[0] = { position: r.hero.pos, is_hero: true, is_active: true, cards: heroCards, stack: r.stack.toFixed(1) };
  seats[3] = { position: r.villain.pos, is_active: true, cards: null, stack: (r.stack - r.to_call).toFixed(1) };
  const dealerSeat = r.hero.pos === 'BTN' ? 0 : r.villain.pos === 'BTN' ? 3 : -1;
  const bets = r.to_call > 0 ? { 3: `${r.to_call}bb` } : null;
  const potShown = (r.pot - r.to_call).toFixed(1);
  return renderPokerTable({
    seats, dealerSeat, bets,
    board: r.board.map(cardToDisplay),
    pot: null,
    situation: null,
  }) + `<div class="text-center text-sm font-mono text-amber-300/90 -mt-1">`
    + `${r.street === 'turn' ? 'Turn' : 'River'} · pot ${potShown}bb · ${r.decision_desc}`
    + (r.to_call > 0 ? ` · ${r.to_call}bb to call` : '') + `</div>`;
}

function actionButtons(r) {
  return `
  <div class="grid grid-cols-2 gap-2">
    ${r.actions_short.map((a, i) => `
      <button data-act="${i}" class="py-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 font-semibold text-sm">
        ${a}${r.actions[i] !== a ? `<div class="text-[0.65rem] text-gray-400 font-normal">${r.actions[i]}</div>` : ''}
      </button>`).join('')}
  </div>`;
}

function feedback(r, p, g, choice) {
  const a = r.actions_short;
  const banner = {
    best: ['bg-emerald-900/40 border-emerald-600/50 text-emerald-300', `Best move: ${a[p.answer]}`],
    fine: ['bg-sky-900/40 border-sky-600/50 text-sky-300', `Also fine: ${a[choice]} (best: ${a[p.answer]})`],
    mistake: ['bg-red-900/40 border-red-700/50 text-red-300',
      `Mistake: ${a[choice]} costs ${g.loss_bb.toFixed(2)}bb (${pct(g.loss_pct, 1)} of the pot). Best: ${a[p.answer]}`],
  }[g.verdict];

  const maxLoss = Math.max(0.01, ...p.ev.map(x => -x));
  const bars = a.map((lab, i) => {
    const loss = -p.ev[i];
    const w = Math.max(2, 100 * (1 - loss / maxLoss));
    const tag = i === p.answer ? 'best' : p.fine.includes(i) ? 'fine' : '';
    const col = i === p.answer ? 'bg-emerald-500' : p.fine.includes(i) ? 'bg-sky-500' : 'bg-gray-600';
    return `
    <div class="flex items-center gap-2 text-xs">
      <div class="w-16 text-right ${i === choice ? 'text-white font-semibold' : 'text-gray-400'}">${lab}</div>
      <div class="flex-1 bg-gray-800 rounded h-3"><div class="${col} h-3 rounded" style="width:${w}%"></div></div>
      <div class="w-20 font-mono ${loss < 0.005 ? 'text-emerald-400' : 'text-gray-400'}">${loss < 0.005 ? tag || 'best' : `−${loss.toFixed(2)}bb`}</div>
    </div>`;
  }).join('');

  const points = explain(r, p).map(pt => `
    <div class="text-sm"><span class="text-gray-300 font-semibold">${pt.title}.</span>
      <span class="text-gray-400">${pt.body}</span></div>`).join('');

  return `
  <div class="flash-in space-y-4">
    <div class="rounded-lg border px-3 py-2 text-sm font-semibold ${banner[0]}">${banner[1]}</div>
    <div class="space-y-1.5">${bars}</div>
    <div class="space-y-2">${points}</div>
    ${rangePanel(r, p)}
    <button id="pz-next" class="w-full py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-semibold">Next puzzle</button>
  </div>`;
}

function rangePanel(r, p) {
  const tabs = [
    ['villain', r.villain.profile === 'gto' ? 'His range' : `His range (${r.villain.name})`],
    ...(r.villain.profile === 'gto' ? [] : [['villain_gto', 'His range (solver)']]),
    ['hero', 'Your range'],
  ];
  const t = current.gridTab;
  const data = t === 'hero' ? r.grid.hero : t === 'villain_gto' ? r.grid.villain_gto
    : (r.villain.profile === 'gto' ? r.grid.villain_gto : r.grid.villain_profile);
  const heroCell = cellOf(p.cards);
  const cells = data.freq.map((f, i) => {
    const eq = data.eq[i];
    // colour by equity (red → amber → green), opacity by how much of the hand is in range
    const hue = Math.round(120 * eq);
    const bg = f > 0 ? `hsla(${hue}, 70%, 40%, ${0.3 + 0.7 * f})` : 'rgba(31,41,55,0.35)';
    const hero = t === 'hero' && i === heroCell ? 'range-cell-hero' : '';
    const title = f > 0 ? `${cellLabel(i)}: ${pct(f)} of combos, equity ${pct(eq)}` : cellLabel(i);
    return `<div class="range-cell ${hero}" style="background:${bg}" title="${title}">${cellLabel(i)}</div>`;
  }).join('');
  return `
  <div class="space-y-2">
    <div class="flex gap-1 text-xs">
      ${tabs.map(([k, lab]) => `<button data-grid="${k}" class="px-2 py-1 rounded ${k === t ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-400'}">${lab}</button>`).join('')}
    </div>
    <div class="grid mx-auto w-fit" style="grid-template-columns: repeat(13, auto); gap: 1px;">${cells}</div>
    <div class="text-[0.65rem] text-gray-500 text-center">Colour = equity vs the other range (red → green). Brightness = how much of that hand is in the range here.</div>
  </div>`;
}

function draw(container) {
  if (!current) {
    container.innerHTML = `<div class="space-y-4">${header()}${filterBar()}
      <p class="text-center text-gray-500 pt-8">No puzzles match these filters.</p></div>`;
    wire(container);
    return;
  }
  const { record: r, puzzle: p, answered } = current;
  container.innerHTML = `
  <div class="space-y-4">
    ${header()}
    ${filterBar()}
    ${villainBadge(r)}
    ${table(r, p)}
    ${historyLines(r)}
    <div class="text-sm text-center text-gray-300">You have <span class="font-semibold">${p.hand}</span>. What's your play?</div>
    <div id="pz-body">${answered ? feedback(r, p, answered.g, answered.choice) : actionButtons(r)}</div>
  </div>`;
  wire(container);
}

function wire(container) {
  container.querySelectorAll('select[data-f]').forEach(sel => {
    sel.addEventListener('change', () => {
      filters[sel.dataset.f] = sel.value;
      next(container);
    });
  });
  container.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => answer(container, Number(btn.dataset.act)));
  });
  container.querySelectorAll('button[data-grid]').forEach(btn => {
    btn.addEventListener('click', () => {
      current.gridTab = btn.dataset.grid;
      draw(container);
    });
  });
  container.querySelector('#pz-next')?.addEventListener('click', () => next(container));
}

function answer(container, choice) {
  if (!current || current.answered) return;
  const { record: r, puzzle: p, cand } = current;
  const g = grade(p, r, choice);
  const before = stats.rating;
  stats.rating = updateRating(stats.rating, p.rating, g.correct, stats.played);
  stats.played += 1;
  if (g.correct) stats.solved += 1;
  stats.seen = [...stats.seen, key(cand)].slice(-300);
  stats.history = [...stats.history, { id: key(cand), v: g.verdict, loss: +g.loss_bb.toFixed(2), d: stats.rating - before }].slice(-500);
  saveStats(stats);
  current.answered = { g, choice };
  draw(container);
}
