/**
 * Playbook — rules you can remember. Pick a villain type, a spot and a board texture, and see what
 * each hand class does against him, next to what a solver does. Built from every solved puzzle spot.
 */
import { aggregate, rule, top, CATEGORIES } from '../engine/playbook.js';
import { PROFILES } from '../engine/puzzles.js';
import { pct } from '../engine/potmath.js';

let book = null;
let filters = { profile: 'station', family: '', decision: 'facing', street: '', suits: '', connect: '', paired: '', height: '' };

const CLASS_LABEL = {
  monster: 'Monsters', strong: 'Strong', medium: 'Medium', weak: 'Weak pairs', draw: 'Draws', air: 'Air',
};
const CAT_COLOR = {
  fold: 'bg-gray-500', check: 'bg-sky-600', call: 'bg-emerald-600',
  'bet small': 'bg-amber-500', 'bet big': 'bg-orange-600', raise: 'bg-red-600', 'all-in': 'bg-red-800',
};

export async function render(container) {
  container.innerHTML = `<p class="text-center text-gray-500 pt-12">Loading playbook…</p>`;
  try {
    if (!book) {
      const res = await fetch('/library/playbook.json');
      if (!res.ok) throw new Error('Playbook not built');
      book = await res.json();
    }
  } catch (e) {
    container.innerHTML = `<p class="text-center text-red-400 pt-12">${e.message}. Run <code>npm run playbook</code>.</p>`;
    return;
  }
  draw(container);
}

function families() {
  const seen = new Map();
  for (const e of book.entries) seen.set(e.f, true);
  const names = {
    srp_btn_bb: 'BTN vs BB', srp_co_btn: 'CO vs BTN', srp_ep_bb: 'UTG vs BB',
    '3bp_bb_btn': '3-bet pot', limp_mp_bb: 'Limped pot',
  };
  return [...seen.keys()].map(id => ({ id, name: names[id] || id }));
}

function bar(dist) {
  return `<div class="flex h-2.5 rounded overflow-hidden bg-gray-800">${
    CATEGORIES.filter(c => dist[c] > 0.005).map(c =>
      `<div class="${CAT_COLOR[c]}" style="width:${100 * dist[c]}%" title="${c} ${pct(dist[c])}"></div>`).join('')
  }</div>`;
}

function controls() {
  const sel = (key, options) => `
    <select data-f="${key}" class="bg-gray-900 border border-gray-700 rounded px-2 py-1">
      ${options.map(([v, l]) => `<option value="${v}" ${filters[key] === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>`;
  return `
  <div class="space-y-2 text-xs">
    <div class="flex flex-wrap gap-2 justify-center">
      ${sel('profile', [...Object.entries(PROFILES).filter(([k]) => k !== 'gto').map(([k, v]) => [k, `vs ${v}`]), ['', 'vs all villain types']])}
      ${sel('decision', [['facing', 'Facing a bet'], ['betting', 'Checked to you / first to act']])}
      ${sel('street', [['', 'Turn + river'], ['turn', 'Turn'], ['river', 'River']])}
      ${sel('family', [['', 'All pots'], ...families().map(f => [f.id, f.name])])}
    </div>
    <div class="flex flex-wrap gap-2 justify-center">
      <span class="text-gray-500 self-center">Flop:</span>
      ${sel('suits', [['', 'any suits'], ['rainbow', 'rainbow'], ['two-tone', 'two-tone'], ['monotone', 'monotone']])}
      ${sel('connect', [['', 'any connectedness'], ['connected', 'connected'], ['semi', 'semi-connected'], ['dry', 'dry']])}
      ${sel('paired', [['', 'paired or not'], ['unpaired', 'unpaired'], ['paired', 'paired']])}
      ${sel('height', [['', 'any high card'], ['ace', 'A-high'], ['big', 'K/Q-high'], ['mid', 'J–8-high'], ['low', '7-high or lower']])}
    </div>
  </div>`;
}

function draw(container) {
  const { n, rows } = aggregate(book, filters);
  const vname = filters.profile ? PROFILES[filters.profile] : 'these villains';
  const adjustments = rows
    .filter(r => top(r.exploit)[0] && top(r.gto)[0] && top(r.exploit)[0][0] !== top(r.gto)[0][0])
    .map(r => `<li><span class="text-gray-200">${CLASS_LABEL[r.class]}:</span> ${top(r.exploit)[0][0]}
      <span class="text-gray-500">(a solver would ${top(r.gto)[0][0]})</span></li>`);

  const table = rows.map(r => `
    <div class="py-2 border-b border-gray-800">
      <div class="flex justify-between text-sm">
        <span class="font-semibold text-gray-200">${CLASS_LABEL[r.class]}</span>
        <span class="text-gray-500 text-xs">${pct(r.share)} of your range</span>
      </div>
      <div class="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 items-center mt-1 text-xs">
        <span class="text-amber-300">vs ${filters.profile ? PROFILES[filters.profile] : 'them'}</span>
        <div>${bar(r.exploit)}<div class="text-gray-300 mt-0.5">${rule(r.exploit)}</div></div>
        <span class="text-sky-300">Solver</span>
        <div>${bar(r.gto)}<div class="text-gray-500 mt-0.5">${rule(r.gto)}</div></div>
      </div>
    </div>`).join('');

  const legend = CATEGORIES.map(c => `<span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm ${CAT_COLOR[c]}"></span>${c}</span>`).join(' ');

  container.innerHTML = `
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold text-emerald-400">Playbook</h1>
      <p class="text-xs text-gray-500">What each hand class does, averaged over every solved spot that matches. One action per hand; bars show how the class splits.</p>
    </div>
    ${controls()}
    ${n === 0 ? '<p class="text-center text-gray-500 pt-6">No solved spots match. Loosen a filter.</p>' : `
    <div class="text-xs text-gray-500 text-center">${n} spots</div>
    ${adjustments.length ? `<div class="rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-sm">
      <div class="font-semibold text-amber-300 mb-1">Adjustments vs ${vname}</div>
      <ul class="space-y-0.5 text-gray-300">${adjustments.join('')}</ul>
      <div class="text-[0.7rem] text-gray-500 mt-1.5">Classes are hand strength on the board, not against his range. When a player who never bluffs bets big on a scary river, even a "monster" like a small straight or bottom set can be beat.</div></div>`
      : `<div class="text-sm text-gray-400 text-center">Here you play these hands the same way a solver would.</div>`}
    <div>${table}</div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 justify-center text-[0.65rem] text-gray-400">${legend}</div>
    <a href="#puzzles" class="block text-center py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-semibold">Drill these in Puzzles</a>`}
  </div>`;
  container.querySelectorAll('select[data-f]').forEach(s => s.addEventListener('change', () => {
    filters[s.dataset.f] = s.value;
    draw(container);
  }));
}
