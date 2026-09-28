/**
 * Learn: the course, table-maths drills, range drills, preflop, cheat sheets.
 *   #learn                     home
 *   #learn/course/<m>/<s>      course reader
 *   #learn/drill/<id>          a maths drill
 *   #learn/range               → Puzzles → Buckets (the range drill moved there)
 *   #learn/preflop             preflop trainer and charts
 *   #learn/formulas            formula sheet
 *   #learn/playbook            exploit playbook
 */
import { icon } from './kit.js';
import { DRILLS } from '../engine/drills.js';
import { loadRaw, KEYS } from '../store.js';
import { getCourse } from './learn/course.js';

export async function render(container, params = []) {
  const [sub, ...rest] = params;
  if (sub === 'course') return (await import('./learn/course.js')).render(container, rest);
  if (sub === 'drill') return (await import('./learn/drills.js')).render(container, rest);
  if (sub === 'range') { window.location.hash = 'puzzles/buckets'; return undefined; }
  if (sub === 'preflop') return (await import('./learn/preflop.js')).render(container, rest);
  if (sub === 'formulas') return (await import('./learn/formulas.js')).render(container, rest);
  if (sub === 'playbook') {
    container.innerHTML = `<div class="page max-w-4xl space-y-4"><a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a><div id="pb"></div></div>`;
    return (await import('./playbook.js')).render(container.querySelector('#pb'), rest);
  }
  return home(container);
}

async function home(container) {
  const learn = loadRaw(KEYS.learn, { done: {}, last: null });
  const drills = loadRaw(KEYS.drills, {});
  container.innerHTML = `<div class="page space-y-8 fade-up">
    <div><div class="h-sec">Learn</div><h1 class="h-title">Understand it, then drill it.</h1></div>
    <section class="space-y-3">
      <div class="flex items-center justify-between"><h2 class="text-lg font-semibold text-white">Course</h2><span class="text-xs text-ink-400">Boot Camp, corrected against the textbooks</span></div>
      <div id="modules" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"><div class="text-sm text-ink-400">Loading course…</div></div>
    </section>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold text-white">Table maths</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        ${Object.entries(DRILLS).map(([id, d]) => {
          const st = drills[id];
          return `<a href="#learn/drill/${id}" class="panel px-4 py-3 hover:border-ink-500 transition">
            <div class="flex items-center justify-between"><span class="font-semibold text-white">${d.name}</span><span class="text-[11px] text-ink-400 uppercase tracking-wide">${d.group}</span></div>
            <div class="text-xs text-ink-300 mt-1">${d.blurb}</div>
            ${st ? `<div class="text-xs text-ink-400 mt-2">${st.right}/${st.n} right · best streak ${st.best}</div>` : ''}
          </a>`;
        }).join('')}
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold text-white">Ranges and preflop</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        ${tile('#puzzles/buckets', 'grid', 'Buckets', 'Your whole range after the flop: one plan for your monsters, pairs, draws and air. In Puzzles.')}
        ${tile('#learn/preflop', 'target', 'Preflop trainer', 'Raise, call or fold from every seat, live 9-handed charts.')}
        ${tile('#learn/formulas', 'learn', 'Formula sheet', 'Every number you use at the table, on one page.')}
        ${tile('#learn/playbook', 'flag', 'Exploit playbook', 'How each hand class plays against each villain type.')}
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
    return `<a href="#learn/course/${mi}/${next < 0 ? 0 : next}" class="panel panel-pad hover:border-ink-500 transition flex flex-col gap-3">
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
