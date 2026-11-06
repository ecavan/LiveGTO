/**
 * Train: the course, table-maths drills, range drills, preflop, cheat sheets.
 *   #train                     home
 *   #train/course/<m>/<s>      course reader
 *   #train/drill/<id>          a maths drill
 *   #train/range               → Puzzles → Buckets (the range drill moved there)
 *   #train/preflop             preflop trainer and charts
 *   #train/formulas            formula sheet
 *   #train/playbook            exploit playbook
 *   #train/buckets             hand buckets: sort your hand after the flop
 *   #train/types               player types: their HUD stats, how to spot and beat them
 */
import { icon } from './kit.js';
import { DRILLS } from '../engine/drills.js';
import { redirect } from '../router.js';
import { loadRaw, KEYS } from '../store.js';
import { getCourse } from './learn/course.js';

export async function render(container, params = []) {
  const [sub, ...rest] = params;
  if (sub === 'course') return (await import('./learn/course.js')).render(container, rest);
  if (sub === 'drill') { if (rest[0] && !DRILLS[rest[0]]) { redirect('train'); return undefined; } return (await import('./learn/drills.js')).render(container, rest); }
  if (sub === 'range') { redirect('puzzles/buckets'); return undefined; }
  if (sub === 'preflop') return (await import('./learn/preflop.js')).render(container, rest);
  if (sub === 'buckets') return (await import('./learn/buckets.js')).render(container, rest);
  if (sub === 'types') return (await import('./learn/types.js')).render(container, rest);
  if (sub === 'formulas') return (await import('./learn/formulas.js')).render(container, rest);
  if (sub === 'playbook') {
    container.innerHTML = `<div class="page max-w-4xl space-y-4"><a href="#train" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Train</a><div id="pb"></div></div>`;
    return (await import('./playbook.js')).render(container.querySelector('#pb'), rest);
  }
  return home(container);
}

async function home(container) {
  const learn = loadRaw(KEYS.learn, { done: {}, last: null });
  const drills = loadRaw(KEYS.drills, {});
  container.innerHTML = `<div class="page space-y-8 fade-up">
    <div><div class="h-sec">Train</div><h1 class="h-title">Understand it, then drill it.</h1></div>
    <section class="space-y-3">
      <div class="flex items-center justify-between"><h2 class="text-lg font-semibold text-white">Course</h2><span class="text-xs text-ink-400">Boot Camp, corrected against the textbooks</span></div>
      <div id="modules" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"><div class="text-sm text-ink-400">Loading course…</div></div>
    </section>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold text-white">Table maths</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        ${Object.entries(DRILLS).map(([id, d]) => {
          const st = drills[id];
          return `<a href="#train/drill/${id}" class="panel px-4 py-3 hover:border-ink-500 transition">
            <div class="flex items-center justify-between"><span class="font-semibold text-white">${d.name}</span><span class="text-[11px] text-ink-400 uppercase tracking-wide">${d.group}</span></div>
            <div class="text-xs text-ink-300 mt-1">${d.blurb}</div>
            ${st ? `<div class="text-xs text-ink-400 mt-2">${st.right}/${st.n} right · best streak ${st.best}</div>` : ''}
          </a>`;
        }).join('')}
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold text-white">Hand reading, ranges and preflop</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        ${tile('#train/buckets', 'grid', 'Hand buckets', 'Six buckets after the flop (nuts, value, bluff-catcher, draw, air with equity, air) and the plan for each, by board.')}
        ${tile('#train/types', 'bot', 'Player types', 'Whale, station, nit, reg…: their real HUD stats, how to spot them live, how to beat them.')}
        ${tile('#puzzles/buckets', 'grid', 'Range buckets', 'Your whole range in a real spot: one plan for your monsters, pairs, draws and air. In Puzzles.')}
        ${tile('#train/preflop', 'target', 'Preflop trainer', 'Raise, call or fold from every seat, live 9-handed charts.')}
        ${tile('#train/formulas', 'learn', 'Formula sheet', 'Every number you use at the table, on one page.')}
        ${tile('#train/playbook', 'flag', 'Exploit playbook', 'How each hand class plays against each villain type.')}
      </div>
    </section>
  </div>`;
  const course = await getCourse().catch(() => null);
  const el = container.querySelector('#modules');
  if (!el) return;
  if (!course) { el.innerHTML = '<div class="text-sm text-rose-300">Course not available offline yet.</div>'; return; }
  el.innerHTML = course.modules.map((m, mi) => {
    const n = m.steps.length;
    const done = m.steps.filter((_, si) => learn.done[`${mi}.${si}`]).length;
    const next = m.steps.findIndex((_, si) => !learn.done[`${mi}.${si}`]);
    return `<a href="#train/course/${mi}/${next < 0 ? 0 : next}" class="panel panel-pad hover:border-ink-500 transition flex flex-col gap-3">
      <div class="flex items-center justify-between"><span class="text-[11px] uppercase tracking-[0.1em] text-ink-400 font-semibold">Module ${mi + 1}</span>
        <span class="text-xs text-ink-300 num">${done}/${n}</span></div>
      <div><div class="text-lg font-semibold text-white leading-snug">${m.title}</div><div class="text-sm text-ink-300 mt-0.5">${m.sub}</div></div>
      <div class="h-1.5 rounded-full bg-ink-700 overflow-hidden mt-auto"><div class="h-full bg-sky-400" style="width:${(100 * done) / n}%"></div></div>
      <div class="text-sm font-semibold text-sky-300">${done === 0 ? 'Start' : done === n ? 'Review' : 'Continue'} ${icon('next', 'w-4 h-4 inline')}</div>
    </a>`;
  }).join('');
}

const tile = (href, ic, title, blurb) => `<a href="${href}" class="panel px-4 py-3 hover:border-ink-500 transition flex gap-3">
  <span class="w-9 h-9 shrink-0 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center">${icon(ic, 'w-5 h-5')}</span>
  <span><span class="block font-semibold text-white">${title}</span><span class="block text-xs text-ink-300 mt-0.5">${blurb}</span></span></a>`;
