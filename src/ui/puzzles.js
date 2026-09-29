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
import { pokerTable, icon, esc, verdict, disc, rangeGrid, fmtBB, lossKind, optionLabel } from './kit.js';
import { puzzleTabs } from './puzzles/tabs.js';
import { filters, filterPanel as sharedFilters, wireFilters, libraryOnly } from './puzzles/filters.js';
import { planFromClasses, CLASS_AS_BUCKET } from '../engine/buckets.js';
import { bucketPlanHtml } from './buckets.js';
import { navigate } from '../router.js';

let index = null;
let stats = loadStats();
let mode = 'rated'; // rated | daily | review
const cur = { rated: null, daily: null, review: null }; // { cand, record, puzzle, view, answered, gridTab }
let current = null;
let practiceAll = false;
let keyHandler = null;

export async function render(container, params = []) {
  const m = params[0] || '';
  if (m === 'ranges') return (await import('./puzzles/ranges.js')).render(container, params.slice(1));
  if (m === 'buckets') return (await import('./puzzles/bucketdrill.js')).render(container, params.slice(1));
  if (m === 'flop' || m === 'multiway') {
    // the old Flop / Multiway tabs are filters on the rated puzzles now
    filters.street = m === 'flop' ? 'flop' : '';
    filters.players = m === 'multiway' ? 'multiway' : '';
    cur.rated = null;
    navigate('puzzles');
    return undefined;
  }
  mode = m === 'daily' || m === 'review' ? m : 'rated';
  stats = loadStats();
  container.innerHTML = `<div class="page text-ink-400">Loading puzzles…</div>`;
  try {
    index = await getIndex();
  } catch (e) {
    container.innerHTML = `<div class="page text-rose-300">${esc(e.message)}. Build it with <code>npm run library</code>.</div>`;
    return undefined;
  }
  try {
    if (mode === 'daily') { if (!cur.daily || cur.daily.date !== today()) await next(); }
    else if (!cur[mode] || cur[mode].answered || (mode === 'review' && cur[mode].gen) || cur[mode].gen?.answered) await next();
  } catch (e) {
    return loadError(container, e);
  }
  current = cur[mode];
  if (current?.gen) {
    // a flop / multiway spot: that module shows it (rated, or a missed one in review)
    const gm = await import('./puzzles/generated.js');
    if (mode === 'review') return gm.render(container, current.gen.id.slice(4), { review: current.gen });
    return gm.render(container, current.gen.kind, { rated: current.gen });
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

/**
 * A puzzle that won't load: offline with that part of the library not downloaded, or (in Review)
 * a puzzle that no longer exists after a library rebuild. Say so, and offer a way on.
 */
function loadError(container, e) {
  const missing = e?.message === 'missing';
  const it = mode === 'review' ? reviewItem : null;
  container.innerHTML = `<div class="page space-y-4">
    <div><div class="h-sec">Puzzles</div><h1 class="h-title">${missing ? 'That puzzle is gone' : 'Couldn\'t load a puzzle'}</h1></div>
    <div>${puzzleTabs(mode === 'rated' ? '' : mode)}</div>
    <div class="panel panel-pad space-y-3">
      <p class="text-sm text-ink-200">${missing ? 'It was in your review queue, but the puzzle library has changed since.' : 'You may be offline, with this part of the puzzle library not downloaded yet. Settings → "Download puzzle library" makes every puzzle work offline.'}</p>
      <div class="flex gap-2 flex-wrap"><button id="pz-retry" class="btn btn-primary">Try again</button>
        ${it ? '<button id="pz-drop" class="btn">Remove it from the queue</button>' : ''}
        ${mode !== 'rated' ? '<a class="btn" href="#puzzles/buckets">Buckets drill (works offline)</a>' : ''}</div>
    </div></div>`;
  container.querySelector('#pz-retry').addEventListener('click', () => { cur[mode] = null; navigate(mode === 'rated' ? 'puzzles' : `puzzles/${mode}`); });
  container.querySelector('#pz-drop')?.addEventListener('click', () => {
    stats.queue = (stats.queue || []).filter(x => x.k !== it.k);
    saveStats(stats);
    cur.review = null;
    navigate('puzzles/review');
  });
  return undefined;
}

let reviewItem = null;

async function load(cand, rand = Math.random) {
  const record = await getRecord(cand);
  const puzzle = record?.puzzles?.[cand.i];
  if (!puzzle) throw new Error('missing');
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
    reviewItem = it || null;
    cur.review = !it ? null : it.id.startsWith('gen:') ? { gen: it, cand: { id: it.id, i: it.i } } : await load({ id: it.id, file: it.file, i: it.i, rating: it.rating });
  } else {
    cur.rated = await nextRated();
  }
  current = cur[mode];
}

/**
 * The next rated puzzle, from one of three sources: the solver library (turn and river, heads-up),
 * flop spots and multiway spots (from the Play engine). With no filter the source is drawn
 * 50 / 30 / 20 so the big library doesn't crowd out the others.
 */
async function nextRated() {
  const seen = new Set(stats.seen);
  const lib = () => {
    if (filters.street === 'flop' || filters.players === 'multiway') return [];
    return candidates(index, { ...filters, street: filters.street === 'flop' ? '' : filters.street });
  };
  const gm = await import('./puzzles/generated.js');
  const gen = async (kind) => {
    if (libraryOnly()) return [];
    if (kind === 'flop' && (filters.players === 'multiway' || (filters.street && filters.street !== 'flop'))) return [];
    if (kind === 'multiway' && filters.players === 'hu') return [];
    const spots = await gm.loadSet(kind).catch(() => []);
    const st = { flop: 1, turn: 2, river: 3 }[filters.street];
    return spots.filter(x => (!st || x.street === st) && (!filters.decision || (filters.decision === 'facing') === x.toCall > 0))
      .map(x => ({ gen: kind, id: x.id, i: 0, rating: x.rating, k: `gen:${kind}#${x.id}` }));
  };
  const pools = [['lib', lib(), 0.5], ['flop', await gen('flop'), 0.3], ['multiway', await gen('multiway'), 0.2]].filter(p => p[1].length);
  if (!pools.length) return null;
  let x = Math.random() * pools.reduce((a, p) => a + p[2], 0);
  let pick = pools[0];
  for (const p of pools) { x -= p[2]; if (x <= 0) { pick = p; break; } }
  const [src, cands] = pick;
  if (src === 'lib') {
    const cand = pickPuzzle(cands, stats.rating, seen);
    return cand ? load(cand) : null;
  }
  const fresh = cands.filter(c => !seen.has(c.k));
  const c = pickPuzzle(fresh.length ? fresh : cands, stats.rating);
  return { gen: { kind: src, id: c.id, answered: false }, cand: c };
}

// ------------------------------------------------------------------ pieces

const filterPanel = () => sharedFilters(index);

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
    ${disc('Your range by bucket: a plan for each kind of hand', libraryPlan(r, p), true)}
    ${disc('Ranges', rangePanel(r, p))}
    ${nextButton()}
  </div>`;
}

/** The solver's plan for each class of hand in your range (the exploit against this villain). */
function libraryPlan(r, p) {
  const typeOf = (a) => (/^fold/i.test(a) ? 'fold' : /^check/i.test(a) ? 'check' : /^call/i.test(a) ? 'call' : /^all-in/i.test(a) ? 'allin' : /^raise/i.test(a) ? 'raise' : 'bet');
  const options = r.actions.map((a, i) => ({ type: typeOf(a), label: r.actions_short[i].replace(/^\w/, c => c.toUpperCase()) }));
  const hero = CLASS_AS_BUCKET[p.class]?.key;
  return bucketPlanHtml({ rows: planFromClasses(r.classes), options, board: current.view.board.map(c => '23456789TJQKA'.indexOf(c[0]) * 4 + 'cdhs'.indexOf(c[1])) }, {
    hero, note: `From the solve: the share of each class that plays each way against ${esc(r.villain.name)}.`,
  });
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
    return `<div class="evrow"><div class="truncate ${i === choice ? 'text-white font-semibold' : 'text-ink-300'}">${i === choice ? '▸ ' : ''}${esc(optionLabel(o.label))}</div>
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
      bg: f > 0 ? `hsla(${hue}, 70%, 38%, ${0.25 + 0.75 * f})` : 'rgb(var(--ink-800))',
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
      : `<p class="text-ink-400 pt-6">No puzzles match these filters. The texture and villain filters only apply to turn and river spots, so try clearing one.</p>`;
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
  wireFilters(container, () => { cur.rated = null; navigate('puzzles'); });
  container.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => answer(container, Number(btn.dataset.act))));
  container.querySelectorAll('[data-grid]').forEach(btn => btn.addEventListener('click', () => {
    current.gridTab = btn.dataset.grid;
    const open = [...container.querySelectorAll('details')].map(d => d.open);
    draw(container);
    container.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
  }));
  container.querySelector('#pz-next')?.addEventListener('click', () => { navigate(mode === 'review' ? 'puzzles/review' : 'puzzles'); });
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
