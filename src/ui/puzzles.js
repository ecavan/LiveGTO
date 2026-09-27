/**
 * Puzzles: a real solved spot, your real cards, one right answer, rated like chess puzzles.
 * Graded by EV against the villain's node-locked strategy (or GTO for the baseline).
 */
import {
  PROFILES, candidates, families, pickPuzzle, key, grade, updateRating, explain,
  cellLabel, cellOf, loadStats, saveStats, queueMiss, queueResult, dueItems, dailyPick, dailyStreak, today, dayRand, INTERVALS,
} from '../engine/puzzles.js';
import { getIndex, getRecord } from '../engine/library.js';
import { pct } from '../engine/potmath.js';
import { flopTexture, textureLabel, boardTags, randomSuitMap, remapCard, isCard } from '../engine/texture.js';
import { pokerTable, icon, esc, verdict, disc, rangeGrid, fmtBB, lossKind } from './kit.js';
import { puzzleTabs } from './puzzles/tabs.js';
import { navigate } from '../router.js';

let index = null;
let stats = loadStats();
let filters = { street: '', profile: '', decision: '', family: '', suits: '', connect: '', paired: '', height: '' };
let mode = 'rated'; // rated | daily | review
const cur = { rated: null, daily: null, review: null }; // { cand, record, puzzle, view, answered, gridTab }
let current = null;
let practiceAll = false;
let keyHandler = null;

export async function render(container, params = []) {
  const m = params[0] || '';
  if (m === 'ranges') return (await import('./puzzles/ranges.js')).render(container, params.slice(1));
  if (m === 'flop' || m === 'multiway') return (await import('./puzzles/generated.js')).render(container, m);
  mode = m === 'daily' || m === 'review' ? m : 'rated';
  stats = loadStats();
  container.innerHTML = `<div class="page text-ink-400">Loading puzzles…</div>`;
  try {
    index = await getIndex();
  } catch (e) {
    container.innerHTML = `<div class="page text-rose-300">${esc(e.message)}. Build it with <code>npm run library</code>.</div>`;
    return undefined;
  }
  if (mode === 'daily') { if (!cur.daily || cur.daily.date !== today()) await next(); }
  else if (!cur[mode] || cur[mode].answered || cur[mode].gen) await next();
  current = cur[mode];
  if (current?.gen) {
    // a missed Flop / Multiway spot: that module shows it
    const it = current.gen;
    return (await import('./puzzles/generated.js')).render(container, it.id.slice(4), { review: it });
  }
  draw(container);
  keyHandler = (e) => {
    if (!container.isConnected) return;
    if (/^[1-9]$/.test(e.key)) container.querySelector(`[data-act="${Number(e.key) - 1}"]`)?.click();
    if (e.key === 'Enter' || e.key === ' ') { const b = container.querySelector('#pz-next'); if (b) { e.preventDefault(); b.click(); } }
  };
  window.addEventListener('keydown', keyHandler);
  return () => window.removeEventListener('keydown', keyHandler);
}

async function load(cand, rand = Math.random) {
  const record = await getRecord(cand);
  const puzzle = record.puzzles[cand.i];
  const m = randomSuitMap(rand);
  const view = {
    board: record.board.map(c => remapCard(c, m)),
    cards: remapCard(puzzle.cards, m),
    prior: record.history.prior.map(x => (isCard(x) ? remapCard(x, m) : x)),
  };
  return { cand, record, puzzle, view, answered: null, gridTab: 'villain' };
}

async function next() {
  if (mode === 'daily') {
    const date = today();
    const cand = dailyPick(index, date);
    cur.daily = cand ? { ...(await load(cand, dayRand(date))), date } : null;
    const done = stats.daily?.[date];
    if (cur.daily && done) cur.daily.answered = { g: grade(cur.daily.puzzle, cur.daily.record, done.choice), choice: done.choice };
  } else if (mode === 'review') {
    const due = dueItems(stats);
    const pool = due.length ? due : practiceAll ? [...(stats.queue || [])].sort((a, b) => a.due - b.due) : [];
    const skip = cur.review?.cand ? key(cur.review.cand) : null;
    const it = pool.find(x => x.k !== skip) || pool[0];
    cur.review = !it ? null : it.id.startsWith('gen:') ? { gen: it, cand: { id: it.id, i: it.i } } : await load({ id: it.id, file: it.file, i: it.i, rating: it.rating });
  } else {
    const cands = candidates(index, filters);
    const cand = pickPuzzle(cands, stats.rating, new Set(stats.seen));
    cur.rated = cand ? await load(cand) : null;
  }
  current = cur[mode];
}

// ------------------------------------------------------------------ pieces

function filterPanel() {
  const opt = (v, label, sel) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${label}</option>`;
  const active = Object.values(filters).filter(Boolean).length;
  return disc(`Filters${active ? ` <span class="pill ml-2">${active} on</span>` : ''}`, `<div class="grid sm:grid-cols-2 gap-2">
    <select data-f="profile">${opt('', 'All villain types', filters.profile)}
      ${Object.entries(PROFILES).filter(([k]) => k !== 'gto').map(([k, v]) => opt(k, `vs ${v}`, filters.profile)).join('')}
      ${opt('gto', 'vs GTO (baseline)', filters.profile)}${opt('all', 'Everything', filters.profile)}</select>
    <select data-f="family">${opt('', 'All pot types', filters.family)}${families(index).map(f => opt(f.id, f.name, filters.family)).join('')}</select>
    <select data-f="street">${opt('', 'Turn + river', filters.street)}${opt('turn', 'Turn', filters.street)}${opt('river', 'River', filters.street)}</select>
    <select data-f="decision">${opt('', 'All spots', filters.decision)}${opt('facing', 'Facing a bet', filters.decision)}${opt('betting', 'Bet or check', filters.decision)}</select>
    <select data-f="suits">${opt('', 'Flop: any suits', filters.suits)}${opt('rainbow', 'Rainbow', filters.suits)}${opt('two-tone', 'Two-tone', filters.suits)}${opt('monotone', 'Monotone', filters.suits)}</select>
    <select data-f="connect">${opt('', 'Any connectedness', filters.connect)}${opt('connected', 'Connected', filters.connect)}${opt('semi', 'Semi-connected', filters.connect)}${opt('dry', 'Dry', filters.connect)}</select>
    <select data-f="paired">${opt('', 'Paired or not', filters.paired)}${opt('unpaired', 'Unpaired', filters.paired)}${opt('paired', 'Paired', filters.paired)}</select>
    <select data-f="height">${opt('', 'Any high card', filters.height)}${opt('ace', 'A-high', filters.height)}${opt('big', 'K/Q-high', filters.height)}${opt('mid', 'J–8-high', filters.height)}${opt('low', '7-high or lower', filters.height)}</select>
  </div>`);
}

function tableHtml(r, view) {
  const potBefore = r.pot - r.to_call;
  return pokerTable({
    top: { name: r.villain.name, sub: r.villain.pos, stack: fmtBB(r.stack - r.to_call), cards: 'back', dealer: r.villain.pos === 'BTN' },
    bottom: { name: 'You', sub: r.hero.pos, stack: fmtBB(r.stack), cards: [view.cards.slice(0, 2), view.cards.slice(2, 4)], dealer: r.hero.pos === 'BTN' },
    board: view.board,
    pot: potBefore,
    bets: { top: r.to_call > 0 ? r.to_call : 0 },
    note: esc(r.decision_desc),
  });
}

function lineHtml(r, view) {
  const street = r.street === 'turn' ? 'Turn' : 'River';
  return `<div class="text-sm space-y-1">
    <div class="flex gap-2"><span class="text-ink-400 w-16 shrink-0">Preflop</span><span class="text-ink-200">${esc(r.history.preflop)}</span></div>
    <div class="flex gap-2"><span class="text-ink-400 w-16 shrink-0">Before</span><span class="text-ink-200">${esc(view.prior.join(', '))}</span></div>
    <div class="flex gap-2"><span class="text-ink-400 w-16 shrink-0">${street}</span><span class="text-ink-200">${esc(r.history.street.join(', ') || '—')}</span></div>
    <div class="flex gap-2 flex-wrap text-xs text-ink-400 pt-1"><span>Flop: ${textureLabel(flopTexture(view.board))}</span>${boardTags(view.board).map(t => `<span class="tag">${t}</span>`).join('')}</div>
  </div>`;
}

function actionButtons(r) {
  return `<div class="grid gap-2" style="grid-template-columns: repeat(${Math.min(r.actions_short.length, 4)}, minmax(0,1fr))">
    ${r.actions_short.map((a, i) => {
      const cls = /fold/.test(a) ? 'act-fold' : /check|call/.test(a) ? 'act-pass' : /all-in/.test(a) ? 'act-shove' : 'act-aggr';
      const detail = r.actions[i] !== a ? r.actions[i].replace(/^(bet|raise to|call|all-in)\s*/i, '') : '';
      return `<button data-act="${i}" class="act ${cls}">${esc(a)}${detail ? `<small>${esc(detail)}</small>` : ''}<span class="absolute top-1.5 right-2 text-[10px] text-ink-400 hidden lg:block">${i + 1}</span></button>`;
    }).join('')}</div>`;
}

function feedback(r, p, g, choice) {
  const a = r.actions_short;
  const kind = g.verdict === 'best' ? 'best' : g.verdict === 'fine' ? 'fine' : lossKind(g.loss_bb, r.pot);
  const head = g.verdict === 'best' ? verdict('best', `Best move: ${esc(a[p.answer])}`)
    : g.verdict === 'fine' ? verdict('fine', `Good: ${esc(a[choice])}`, `Best was ${esc(a[p.answer])}.`)
      : verdict(kind, `${kind === 'blunder' ? 'Blunder' : 'Mistake'}: ${esc(a[choice])} costs ${fmtBB(g.loss_bb)}`, `${pct(g.loss_pct, 1)} of the pot. Best: <b>${esc(a[p.answer])}</b>.`);
  const opts = a.map((label, i) => ({ label, ev: p.ev[i] }));
  const points = explain(r, p).map(pt => `<p><b class="text-white">${pt.title}.</b> ${pt.body}</p>`).join('');
  return `<div class="space-y-3 fade-up">
    ${head}
    ${evBarsFromLoss(opts, p, choice)}
    ${disc('Why', `<div class="space-y-2">${points}</div>`, g.verdict !== 'best')}
    ${disc('Ranges', rangePanel(r, p))}
    ${nextButton()}
  </div>`;
}

function nextButton() {
  if (mode === 'daily') return `<div class="text-sm text-ink-300 text-center">Streak: <b class="text-amber-200">${dailyStreak(stats)} day${dailyStreak(stats) === 1 ? '' : 's'}</b>. A new puzzle tomorrow.</div>
    <a href="#puzzles" class="btn btn-primary btn-lg btn-block">Rated puzzles ${icon('next', 'w-5 h-5')}</a>`;
  if (mode === 'review') return `<button id="pz-next" class="btn btn-primary btn-lg btn-block">Next missed puzzle ${icon('next', 'w-5 h-5')}</button>`;
  return `<button id="pz-next" class="btn btn-primary btn-lg btn-block">Next puzzle ${icon('next', 'w-5 h-5')}</button>`;
}

function evBarsFromLoss(opts, p, choice) {
  const maxLoss = Math.max(0.01, ...p.ev.map(x => -x));
  return `<div class="space-y-2">${opts.map((o, i) => {
    const loss = -p.ev[i];
    const w = Math.max(3, 100 * (1 - loss / maxLoss));
    const col = i === p.answer ? 'bg-emerald-400' : p.fine.includes(i) ? 'bg-sky-400' : 'bg-ink-400';
    return `<div class="evrow"><div class="truncate ${i === choice ? 'text-white font-semibold' : 'text-ink-300'}">${i === choice ? '▸ ' : ''}${esc(o.label)}</div>
      <div class="evbar"><i class="${col}" style="width:${w}%"></i></div>
      <div class="text-right num text-xs ${loss < 0.005 ? 'text-emerald-300 font-semibold' : 'text-ink-300'}">${loss < 0.005 ? 'best' : `−${loss.toFixed(2)}`}</div></div>`;
  }).join('')}</div>`;
}

function rangePanel(r, p) {
  const tabs = [
    ['villain', r.villain.profile === 'gto' ? 'His range' : `His (${r.villain.name})`],
    ...(r.villain.profile === 'gto' ? [] : [['villain_gto', 'His (solver)']]),
    ['hero', 'Yours'],
  ];
  const t = current.gridTab;
  const data = t === 'hero' ? r.grid.hero : t === 'villain_gto' ? r.grid.villain_gto
    : (r.villain.profile === 'gto' ? r.grid.villain_gto : r.grid.villain_profile);
  const heroCell = cellOf(p.cards);
  const cells = data.freq.map((f, i) => {
    const eq = data.eq[i];
    const hue = Math.round(120 * eq);
    return {
      label: cellLabel(i), me: t === 'hero' && i === heroCell,
      bg: f > 0 ? `hsla(${hue}, 70%, 38%, ${0.25 + 0.75 * f})` : '#121821',
      title: f > 0 ? `${cellLabel(i)}: ${pct(f)} in range, equity ${pct(eq)}` : cellLabel(i),
    };
  });
  return `<div class="space-y-2">
    <div class="seg">${tabs.map(([k, lab]) => `<button data-grid="${k}" class="${k === t ? 'on' : ''}">${lab}</button>`).join('')}</div>
    ${rangeGrid(cells)}
    <div class="text-xs text-ink-400">Colour = equity against the other range (red → green). Brightness = how much of that hand is in the range here.</div>
  </div>`;
}

// ------------------------------------------------------------------ page

function draw(container) {
  const acc = stats.played ? Math.round((100 * stats.solved) / stats.played) : 0;
  const title = { rated: 'Find the best play', daily: 'Daily puzzle', review: 'Your missed puzzles' }[mode];
  const q = stats.queue || [];
  const statsHtml = mode === 'daily'
    ? `<div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Streak</div><div class="text-2xl font-semibold num text-amber-200">${dailyStreak(stats)}<span class="text-sm text-ink-400"> days</span></div></div>`
    : mode === 'review'
      ? `<div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Due</div><div class="text-2xl font-semibold num text-rose-200">${dueItems(stats).length}</div></div>
         <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">In queue</div><div class="text-2xl font-semibold num">${q.length}</div></div>`
      : `<div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Rating</div><div class="text-2xl font-semibold num text-emerald-300">${stats.rating}</div></div>
         <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Solved</div><div class="text-2xl font-semibold num">${acc}%</div></div>`;
  const header = `<div class="flex items-end justify-between gap-4 flex-wrap">
    <div><div class="h-sec">Puzzles</div><h1 class="h-title">${title}</h1></div>
    <div class="flex gap-5 text-right items-end">
      ${statsHtml}
      ${current ? `<div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Puzzle</div><div class="text-2xl font-semibold num text-ink-200">${current.puzzle.rating}</div></div>` : ''}
    </div></div>
    <div>${puzzleTabs(mode === 'rated' ? '' : mode)}</div>
    ${mode === 'review' && current ? `<p class="text-sm text-ink-400">Missed puzzles come back after ${INTERVALS.join(', ')} days. Solve one each time and it leaves the queue. Not rated.</p>` : ''}
    ${mode === 'daily' ? `<p class="text-sm text-ink-400">One spot a day, the same for everyone. Not rated: it counts toward your streak.</p>` : ''}`;
  if (!current) {
    const empty = mode === 'review'
      ? `<div class="panel panel-pad text-center py-10 space-y-3">
          <div class="text-lg font-semibold text-white">${q.length ? 'Nothing due right now' : 'No missed puzzles'}</div>
          <p class="text-sm text-ink-300 max-w-md mx-auto">${q.length ? `${q.length} puzzle${q.length > 1 ? 's' : ''} will come back over the next days.` : 'Every puzzle you miss comes back here the next day, then after 3 and 7 days, until you get it right.'}</p>
          ${q.length ? '<button id="practice-all" class="btn btn-primary">Practise them now anyway</button>' : '<a href="#puzzles" class="btn btn-primary">Rated puzzles</a>'}</div>`
      : `<p class="text-ink-400 pt-6">No puzzles match these filters.</p>`;
    container.innerHTML = `<div class="page space-y-4">${header}${mode === 'rated' ? filterPanel() : ''}${empty}</div>`;
    wire(container);
    return;
  }
  const { record: r, puzzle: p, answered } = current;
  const villainCard = `<div class="panel panel-pad space-y-1.5">
    <div class="flex items-center gap-2"><span class="w-8 h-8 rounded-lg ${r.villain.profile === 'gto' ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'} flex items-center justify-center">${icon('bot', 'w-5 h-5')}</span>
      <div><div class="font-semibold text-white">vs ${esc(r.villain.name)} <span class="text-ink-400 font-normal">· ${r.villain.pos}</span></div>
      <div class="text-xs text-ink-400">${esc(r.family_name)}</div></div></div>
    ${disc('How he plays', `<p>${esc(r.villain.desc)}</p>${(r.villain.notes || []).length ? `<ul class="list-disc pl-5 space-y-0.5 text-ink-300">${r.villain.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`)}
  </div>`;
  container.innerHTML = `<div class="page space-y-4">
    ${header}
    <div class="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:grid-flow-dense items-start">
      <div class="space-y-4 min-w-0">
        ${tableHtml(r, current.view)}
        <div class="text-center text-ink-200">You have <b class="text-white">${esc(p.hand)}</b>. What's your play?</div>
        ${answered ? '' : actionButtons(r)}
      </div>
      <div class="space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        ${answered ? `<div class="panel panel-pad">${feedback(r, p, answered.g, answered.choice)}</div>` : ''}
        ${villainCard}
      </div>
      <div class="space-y-4 min-w-0">
        <div class="panel panel-pad">${lineHtml(r, current.view)}</div>
        ${mode === 'rated' ? filterPanel() : ''}
      </div>
    </div>
  </div>`;
  wire(container);
}

function wire(container) {
  container.querySelectorAll('select[data-f]').forEach(sel => sel.addEventListener('change', async () => {
    filters[sel.dataset.f] = sel.value;
    await next();
    draw(container);
  }));
  container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => answer(container, Number(btn.dataset.act))));
  container.querySelectorAll('[data-grid]').forEach(btn => btn.addEventListener('click', () => {
    current.gridTab = btn.dataset.grid;
    const open = [...container.querySelectorAll('details')].map(d => d.open);
    draw(container);
    container.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
  }));
  container.querySelector('#pz-next')?.addEventListener('click', async () => {
    if (mode === 'review') { navigate('puzzles/review'); return; }
    await next(); draw(container); window.scrollTo(0, 0);
  });
  container.querySelector('#practice-all')?.addEventListener('click', async () => { practiceAll = true; cur.review = null; navigate('puzzles/review'); });
}

function answer(container, choice) {
  if (!current || current.answered) return;
  const { record: r, puzzle: p, cand } = current;
  const g = grade(p, r, choice);
  const k = key(cand);
  if (mode === 'rated') {
    const before = stats.rating;
    stats.rating = updateRating(stats.rating, p.rating, g.correct, stats.played);
    stats.played += 1;
    if (g.correct) stats.solved += 1;
    stats.seen = [...stats.seen, k].slice(-300);
    stats.history = [...stats.history, { id: k, v: g.verdict, loss: +g.loss_bb.toFixed(2), d: stats.rating - before }].slice(-500);
    if (!g.correct) queueMiss(stats, cand);
  } else if (mode === 'daily') {
    stats.daily = { ...(stats.daily || {}), [current.date]: { choice, v: g.verdict } };
    if (!g.correct) queueMiss(stats, cand);
  } else {
    queueResult(stats, k, g.correct);
  }
  saveStats(stats);
  current.answered = { g, choice };
  window.dispatchEvent(new Event('livegto:ratings'));
  draw(container);
}
