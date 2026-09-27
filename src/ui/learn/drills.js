/**
 * A table-maths drill: endless questions, streak and accuracy, the formula after every answer.
 */
import { DRILLS } from '../../engine/drills.js';
import { icon, cards, verdict, esc } from '../kit.js';
import { loadRaw, save, KEYS } from '../../store.js';

let state = null;
let keyHandler = null;

export function render(container, [id = 'potodds'] = []) {
  const d = DRILLS[id] || DRILLS.potodds;
  if (!state || state.id !== id) state = { id, q: d.gen(Math.random), answered: null, streak: 0, session: { n: 0, right: 0 } };
  draw(container, d);
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = (e) => {
    if (/^[1-4]$/.test(e.key)) container.querySelector(`[data-opt="${Number(e.key) - 1}"]`)?.click();
    else if (e.key === 'Enter' || e.key === ' ') { const b = container.querySelector('#dr-next'); if (b) { e.preventDefault(); b.click(); } }
  };
  window.addEventListener('keydown', keyHandler);
  return () => { window.removeEventListener('keydown', keyHandler); keyHandler = null; };
}

function draw(container, d) {
  const { q, answered, streak, session } = state;
  const all = loadRaw(KEYS.drills, {});
  const st = all[state.id] || { n: 0, right: 0, best: 0 };
  const has = answered != null;
  container.innerHTML = `<div class="page max-w-3xl space-y-4 fade-up">
    <div class="flex items-center justify-between gap-3">
      <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
      <select id="dr-pick">${Object.entries(DRILLS).map(([k, v]) => `<option value="${k}" ${k === state.id ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
    </div>
    <div class="flex items-end justify-between">
      <div><div class="h-sec">${esc(d.group)}</div><h1 class="h-title">${esc(d.name)}</h1></div>
      <div class="flex gap-4 text-right">
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Streak</div><div class="text-2xl font-semibold num text-emerald-300">${streak}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Session</div><div class="text-2xl font-semibold num">${session.right}/${session.n}</div></div>
        <div class="hidden sm:block"><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Best</div><div class="text-2xl font-semibold num text-amber-200">${st.best}</div></div>
      </div>
    </div>
    <div class="panel panel-pad space-y-4">
      <div class="text-lg text-white leading-snug">${q.prompt}</div>
      ${q.hole || q.board ? `<div class="flex items-center justify-center gap-6 py-1 flex-wrap">
        ${q.hole ? `<div class="text-center"><div class="text-xs text-ink-400 mb-1">You</div><div class="flex gap-1">${cards(q.hole, 'lg')}</div></div>` : ''}
        ${q.board ? `<div class="text-center"><div class="text-xs text-ink-400 mb-1">Board</div><div class="flex gap-1">${cards(q.board, 'lg')}</div></div>` : ''}
      </div>` : ''}
      <div class="grid grid-cols-2 gap-2">
        ${q.options.map((o, i) => {
          let cls = 'bg-ink-800 border-ink-600 hover:bg-ink-700';
          if (has && i === q.correct) cls = 'bg-emerald-500/15 border-emerald-500/60 text-emerald-100';
          else if (has && i === answered) cls = 'bg-rose-500/15 border-rose-500/60 text-rose-100';
          else if (has) cls = 'bg-ink-850 border-ink-700 text-ink-400';
          return `<button data-opt="${i}" class="rounded-xl border px-4 py-4 text-lg font-semibold num transition ${cls}" ${has ? 'disabled' : ''}>${o}</button>`;
        }).join('')}
      </div>
      ${has ? `${verdict(answered === q.correct ? 'best' : 'mistake', answered === q.correct ? 'Correct' : `Answer: ${q.options[q.correct]}`)}
        <div class="text-[15px] text-ink-100 leading-relaxed">${q.explain}</div>
        <button id="dr-next" class="btn btn-primary btn-lg btn-block">Next ${icon('next', 'w-5 h-5')}</button>` : ''}
    </div>
  </div>`;
  container.querySelector('#dr-pick').addEventListener('change', (e) => { window.location.hash = `learn/drill/${e.target.value}`; });
  container.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => answer(container, d, Number(b.dataset.opt))));
  container.querySelector('#dr-next')?.addEventListener('click', () => {
    state.q = d.gen(Math.random);
    state.answered = null;
    draw(container, d);
  });
}

function answer(container, d, i) {
  if (state.answered != null) return;
  state.answered = i;
  const ok = i === state.q.correct;
  state.streak = ok ? state.streak + 1 : 0;
  state.session.n++;
  if (ok) state.session.right++;
  const all = loadRaw(KEYS.drills, {});
  const st = all[state.id] || { n: 0, right: 0, best: 0 };
  st.n++;
  if (ok) st.right++;
  st.best = Math.max(st.best, state.streak);
  all[state.id] = st;
  save(KEYS.drills, all);
  draw(container, d);
}
