/**
 * Course reader: concept cards in three depths (Feel / Formula / Proof) and questions.
 */
import { icon, seg, wireSeg, pokerTable, cards, esc, verdict, rangeGrid, GRID } from '../kit.js';
import { loadRaw, save, KEYS, settings, saveSettings } from '../../store.js';
import { expand } from '../../engine/ranges.js';

let course = null;
export async function getCourse() {
  if (!course) {
    const r = await fetch('/course.json');
    if (!r.ok) throw new Error('course');
    course = await r.json();
  }
  return course;
}

let keyHandler = null;

export async function render(container, [mStr = '0', sStr = '0'] = []) {
  const c = await getCourse();
  const mi = Math.max(0, Math.min(c.modules.length - 1, Number(mStr) || 0));
  const mod = c.modules[mi];
  const si = Math.max(0, Math.min(mod.steps.length - 1, Number(sStr) || 0));
  const step = mod.steps[si];
  const learn = loadRaw(KEYS.learn, { done: {}, answers: {} });
  const id = `${mi}.${si}`;
  const st = settings();
  const answered = learn.answers?.[id];

  if (step.type === 'concept' && !learn.done[id]) {
    learn.done[id] = 1;
    save(KEYS.learn, learn);
  }

  const prevHref = si > 0 ? `#learn/course/${mi}/${si - 1}` : mi > 0 ? `#learn/course/${mi - 1}/${c.modules[mi - 1].steps.length - 1}` : null;
  const nextHref = si < mod.steps.length - 1 ? `#learn/course/${mi}/${si + 1}` : mi < c.modules.length - 1 ? `#learn/course/${mi + 1}/0` : '#learn';
  const done = mod.steps.filter((_, k) => learn.done[`${mi}.${k}`]).length;

  const body = step.type === 'concept' ? conceptHtml(step, st.tier) : questionHtml(step, answered);

  container.innerHTML = `<div class="page max-w-3xl space-y-4 fade-up">
    <div class="flex items-center justify-between gap-3">
      <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
      <div class="text-xs text-ink-400 num">Module ${mi + 1} · ${si + 1} / ${mod.steps.length}</div>
    </div>
    <div>
      <div class="text-sm font-semibold text-sky-300">${esc(mod.title)}</div>
      <div class="h-1.5 rounded-full bg-ink-700 overflow-hidden mt-2"><div class="h-full bg-sky-400" style="width:${(100 * done) / mod.steps.length}%"></div></div>
    </div>
    <article class="panel panel-pad lesson space-y-4">${body}</article>
    <div class="flex items-center justify-between gap-3">
      ${prevHref ? `<a href="${prevHref}" class="btn">${icon('back', 'w-4 h-4')} Back</a>` : '<span></span>'}
      <a href="${nextHref}" id="next" class="btn btn-primary ${step.type === 'q' && !answered ? 'opacity-60' : ''}">${si === mod.steps.length - 1 ? 'Finish module' : 'Next'} ${icon('next', 'w-4 h-4')}</a>
    </div>
  </div>`;

  wireSeg(container, (name, v) => {
    if (name === 'tier') { saveSettings({ ...settings(), tier: v }); render(container, [mStr, sStr]); }
  });
  container.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
    const k = Number(b.dataset.opt);
    const l = loadRaw(KEYS.learn, { done: {}, answers: {} });
    l.answers = l.answers || {};
    if (l.answers[id] == null) l.answers[id] = k;
    l.done[id] = 1;
    save(KEYS.learn, l);
    render(container, [mStr, sStr]);
  }));

  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = (e) => {
    if (e.key === 'ArrowRight') container.querySelector('#next')?.click();
    else if (e.key === 'ArrowLeft' && prevHref) window.location.hash = prevHref.slice(1);
    else if (/^[1-4]$/.test(e.key)) container.querySelector(`[data-opt="${Number(e.key) - 1}"]`)?.click();
  };
  window.addEventListener('keydown', keyHandler);
  return () => { window.removeEventListener('keydown', keyHandler); keyHandler = null; };
}

function conceptHtml(step, tier) {
  const t = ['feel', 'formula', 'proof'].includes(tier) ? tier : 'feel';
  const callouts = [...(step.callouts || []), ...(step.callout ? [step.callout] : [])]
    .map(c => (typeof c === 'string' ? { kind: 'intu', text: c } : c))
    .map(c => `<div class="rounded-xl px-3.5 py-2.5 text-sm ${c.kind === 'trap' ? 'bg-rose-500/10 border border-rose-500/30 text-rose-100' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-50'}">
      <b>${c.kind === 'trap' ? 'Trap' : 'Insight'}.</b> ${c.text}</div>`).join('');
  const grid = step.grid ? gridHtml(step.grid, step.gridLabel) : '';
  return `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <span class="tag text-sky-200 border-sky-500/40 bg-sky-500/10">${esc(step.tag || 'Concept')}</span>
      ${seg('tier', [{ v: 'feel', label: 'Feel' }, { v: 'formula', label: 'Formula' }, { v: 'proof', label: 'Proof' }], t)}
    </div>
    <h1 class="text-2xl font-semibold text-white leading-tight">${step.title}</h1>
    <div class="text-[15px] text-ink-100 leading-relaxed">${step[t] || step.feel || ''}</div>
    ${grid}
    ${callouts}
    ${step.memorize ? `<div class="rounded-xl bg-amber-400/10 border border-amber-400/30 px-4 py-3">
      <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300">Remember</div>
      <div class="text-[15px] text-amber-50 mt-1 font-medium">${step.memorize}</div></div>` : ''}`;
}

function questionHtml(step, answered) {
  const has = answered != null;
  const right = has && answered === step.correct;
  return `
    <span class="tag text-violet-200 border-violet-500/40 bg-violet-500/10">${esc(step.tag || 'Question')}</span>
    <h1 class="text-xl font-semibold text-white leading-snug">${step.prompt}</h1>
    ${sceneHtml(step)}
    <div class="grid sm:grid-cols-2 gap-2">
      ${step.options.map((o, i) => {
        let cls = 'bg-ink-800 border-ink-600 hover:bg-ink-700';
        if (has && i === step.correct) cls = 'bg-emerald-500/15 border-emerald-500/60 text-emerald-100';
        else if (has && i === answered) cls = 'bg-rose-500/15 border-rose-500/60 text-rose-100';
        else if (has) cls = 'bg-ink-850 border-ink-700 text-ink-400';
        return `<button data-opt="${i}" class="text-left rounded-xl border px-4 py-3 text-[15px] font-medium transition ${cls}" ${has ? 'disabled' : ''}>
          <span class="text-ink-400 mr-2 text-xs">${i + 1}</span>${o}</button>`;
      }).join('')}
    </div>
    ${has ? `${verdict(right ? 'best' : 'mistake', right ? 'Correct' : 'Not quite')}
      <div class="text-[15px] text-ink-100 leading-relaxed">${step.explain}</div>` : ''}`;
}

function gridHtml(tokens, label) {
  const set = expand(tokens.join(','));
  return `<div class="space-y-2">${label ? `<div class="text-sm font-semibold text-ink-200">${label}</div>` : ''}
    ${rangeGrid(GRID.map(l => ({ label: l, bg: set.has(l) ? 'rgba(16,185,129,.55)' : '#121821' })))}</div>`;
}

function sceneHtml(step) {
  const sc = step.scene;
  if (sc && Array.isArray(sc.seats)) {
    const hero = sc.seats.find(s => s.role === 'hero');
    const vil = sc.seats.find(s => s.role === 'villain') || sc.seats.find(s => s.role !== 'hero' && s.role !== 'fold');
    const folded = sc.seats.filter(s => s.role === 'fold').map(s => s.pos);
    return `<div class="space-y-1">${pokerTable({
      top: vil ? { name: vil.pos, sub: vil.bet || '', stack: `$${vil.stack}`, cards: 'back' } : null,
      bottom: hero ? { name: `You · ${hero.pos}`, stack: `$${hero.stack}`, cards: Array.isArray(hero.cards) ? hero.cards : null } : null,
      board: sc.board || [],
      pot: null,
      note: sc.pot != null ? `Pot $${sc.pot}${vil?.bet ? ` · villain ${vil.bet}` : ''}` : '',
    })}${folded.length ? `<div class="text-xs text-ink-400 text-center">${folded.join(', ')} folded</div>` : ''}</div>`;
  }
  if (sc && (sc.hero || sc.card)) {
    return `<div class="flex items-center justify-center gap-6 py-2 flex-wrap">
      ${sc.hero ? `<div class="text-center"><div class="text-xs text-ink-400 mb-1">You</div><div class="flex gap-1">${cards(sc.hero, 'lg')}</div></div>` : ''}
      ${sc.card ? `<div class="text-center"><div class="text-xs text-ink-400 mb-1">Board</div><div class="flex gap-1">${cards(sc.card, 'lg')}</div></div>` : ''}
    </div>`;
  }
  // compact format: your cards in btm/bl, the board in top/tr/br
  const hero = ['btm', 'bl'].filter(k => step[k]?.card).map(k => step[k].card);
  const bd = ['top', 'tr', 'br'].filter(k => step[k]?.card).map(k => step[k].card);
  if (hero.length || bd.length) {
    return `<div class="flex items-center justify-center gap-6 py-2 flex-wrap">
      ${hero.length ? `<div class="text-center"><div class="text-xs text-ink-400 mb-1">You</div><div class="flex gap-1">${cards(hero, 'lg')}</div></div>` : ''}
      ${bd.length ? `<div class="text-center"><div class="text-xs text-ink-400 mb-1">Board</div><div class="flex gap-1">${cards(bd, 'lg')}</div></div>` : ''}
    </div>`;
  }
  return '';
}
