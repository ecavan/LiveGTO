/**
 * Buckets: play your range, not your hand. A real spot (heads-up on any street, or multiway), your
 * whole range split into kinds of hand (monsters, vulnerable monsters, strong / medium / weak pairs,
 * flush draws, straight draws, air) and one action to choose for each. Graded against the coach's
 * best play for every hand in the bucket, weighted by how much of your range it is.
 */
import { loadSet } from './generated.js';
import { statesOf, viewOf, posName } from '../../engine/history.js';
import { AGENTS } from '../../engine/hu/agents.js';
import { cardStr } from '../../engine/hu/hand.js';
import { boardLine } from '../../engine/buckets.js';
import { loadRaw, save, KEYS } from '../../store.js';
import { ringTable, fmtBB, icon, esc, handText, verdict, sprOf } from '../kit.js';
import { optionColors, shortLabel } from '../buckets.js';
import { pct } from '../../engine/potmath.js';
import { puzzleTabs } from './tabs.js';

const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
let st = { street: 0, players: '', cur: null, streak: 0 };

export async function render(container) {
  container.innerHTML = `<div class="page text-ink-400">Loading a spot…</div>`;
  let spots;
  try { spots = await loadSet('buckets'); } catch (e) {
    container.innerHTML = `<div class="page text-rose-300">${esc(e.message)}. Build it with <code>npx vite-node scripts/gen-spots.mjs</code>.</div>`;
    return undefined;
  }
  if (!st.cur || st.cur.checked) next(spots);
  draw(container, spots);
  return undefined;
}

function next(spots) {
  const pool = spots.filter(x => (!st.street || x.street === st.street) && (!st.players || (st.players === 'multiway') === (x.kind === 'table')));
  const seen = new Set(loadRaw(KEYS.drills, {}).bucketsSeen || []);
  const fresh = pool.filter(x => !seen.has(x.id));
  const from = fresh.length ? fresh : pool;
  const spot = from[Math.floor(Math.random() * from.length)];
  if (!spot) { st.cur = null; return; }
  const rows = spot.plan.rows.filter(r => r.share >= 0.03);
  st.cur = { spot, rows, s: statesOf(spot).at(-1), picks: {}, checked: false };
}

const ok = (r, pick) => pick === r.best || (r.mix[pick] ?? 0) >= 0.4;

function tableHtml(spot, s) {
  const v = viewOf(spot, s);
  const order = Array.from({ length: v.n }, (_, j) => (spot.hero + j) % v.n);
  const names = spot.names || (spot.hero === 0 ? ['You', AGENTS[spot.opp]?.name ?? 'Villain'] : [AGENTS[spot.opp]?.name ?? 'Villain', 'You']);
  const seats = order.map(i => ({
    name: names[i],
    sub: `${posName(spot, i)}${spot.styles?.[i] ? ` · ${esc(spot.styles[i])}` : ''}`,
    stack: fmtBB(v.stacks[i]),
    cards: v.folded[i] ? null : 'back', // your range, not your hand
    folded: v.folded[i], dealer: i === v.btn, bet: v.streetBet[i], acting: i === spot.hero, hero: i === spot.hero,
  }));
  const spr = sprOf({ street: v.street, stacks: v.stacks, streetBet: v.streetBet, pot: v.pot + v.streetBet.reduce((a, b) => a + b, 0), live: order.filter(i => !v.folded[i]), seat: spot.hero });
  return ringTable({ seats, board: v.board, pot: v.pot, spr });
}

function lineHtml(spot) {
  const names = spot.names || (spot.hero === 0 ? ['You', AGENTS[spot.opp]?.name ?? 'He'] : [AGENTS[spot.opp]?.name ?? 'He', 'You']);
  const rows = [];
  let street = -1;
  for (const e of spot.log) {
    if (e.street !== street) { street = e.street; rows.push({ head: STREET[street], cards: street === 0 ? [] : street === 1 ? spot.runout.slice(0, 3) : [spot.runout[street + 1]], acts: [] }); }
    if (e.type === 'fold' && e.street === 0 && e.seat !== spot.hero) continue;
    const you = e.seat === spot.hero;
    const a = e.type === 'fold' ? 'folds' : e.type === 'check' ? 'checks' : e.type === 'call' ? `calls ${e.amount}` : e.type === 'bet' ? `bets ${e.amount ?? e.to}` : e.type === 'raise' ? `raises to ${e.to}` : e.callAllIn ? 'calls all-in' : `all-in ${e.to}`;
    rows.at(-1).acts.push(`<span class="${you ? 'text-ink-100' : 'text-amber-200/90'}">${esc(names[e.seat])} ${a}</span>`);
  }
  if (spot.street > street) rows.push({ head: STREET[spot.street], cards: spot.street === 1 ? spot.runout.slice(0, 3) : [spot.runout[spot.street + 1]], acts: [] });
  return `<div class="space-y-1 text-sm">${rows.map(l => `<div class="flex gap-2 flex-wrap items-baseline">
    <span class="text-ink-400 w-14 shrink-0">${l.head}</span>${l.cards.length ? `<span class="mr-1">${handText(l.cards.map(cardStr))}</span>` : ''}
    <span class="text-ink-300">${l.acts.join(', ') || '<span class="text-ink-500">your decision</span>'}</span></div>`).join('')}</div>`;
}

function draw(container, spots) {
  const all = loadRaw(KEYS.drills, {});
  const rec = all.buckets || { n: 0, good: 0, best: 0 };
  const filt = `<div class="flex gap-2 flex-wrap">
    <select id="bk-street"><option value="0">Every street</option>${[1, 2, 3].map(k => `<option value="${k}" ${st.street === k ? 'selected' : ''}>${STREET[k]}</option>`).join('')}</select>
    <select id="bk-players"><option value="">Heads-up and multiway</option><option value="hu" ${st.players === 'hu' ? 'selected' : ''}>Heads-up</option><option value="multiway" ${st.players === 'multiway' ? 'selected' : ''}>Multiway</option></select></div>`;
  const header = `<div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Puzzles</div><h1 class="h-title">Buckets</h1>
        <p class="muted mt-1 text-sm max-w-2xl">Play your range, not your hand. Pick one action for each kind of hand you can have here: the monsters, the pairs, the draws, the air.</p></div>
      <div class="flex gap-5 text-right">
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Streak</div><div class="text-2xl font-semibold num text-emerald-300">${st.streak}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Spots</div><div class="text-2xl font-semibold num">${rec.good}/${rec.n}</div></div>
      </div></div>
    <div class="flex items-center justify-between gap-3 flex-wrap">${puzzleTabs('buckets')}${filt}</div>`;
  if (!st.cur) {
    container.innerHTML = `<div class="page space-y-4">${header}<p class="text-ink-400">No spots match.</p></div>`;
    wire(container, spots);
    return;
  }
  const { spot, rows, s, picks, checked } = st.cur;
  const opts = spot.plan.options;
  const cols = optionColors(opts);
  const bd = spot.runout.slice(0, [0, 3, 4, 5][spot.street]);
  let score = 0, wsum = 0;
  for (const r of rows) { wsum += r.share; if (checked && ok(r, picks[r.key])) score += r.share; }
  const frac = wsum ? score / wsum : 0;
  const who = spot.kind === 'hu' ? `vs ${esc(AGENTS[spot.opp]?.name ?? spot.opp)}: <span class="text-ink-300">${esc(AGENTS[spot.opp]?.blurb ?? '')}</span>`
    : `Multiway: ${spot.names.map((n, i) => (i !== spot.hero && !s.folded[i] ? `${esc(n)} <span class="text-ink-400">(${esc(spot.styles[i])})</span>` : '')).filter(Boolean).join(', ')}`;
  const rowHtml = (r) => {
    const p = picks[r.key];
    const good = checked && ok(r, p);
    const mix = r.mix.map((x, j) => (x > 0.005 ? `<i style="width:${100 * x}%;background:${cols[j]}" title="${esc(opts[j].label)}: ${pct(x)}"></i>` : '')).join('');
    return `<div class="panel px-4 py-3 ${checked ? (good ? 'border-emerald-600/50' : 'border-rose-600/50') : ''}">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-[200px] flex-1"><div class="font-semibold text-white">${esc(r.name)} <span class="text-ink-400 font-normal text-sm">· ${pct(r.share)} of your range</span></div>
          <div class="text-xs text-ink-400">${esc(r.desc)}${r.examples?.length ? ` · e.g. ${r.examples.map(esc).join(' ')}` : ''}</div></div>
        <div class="flex gap-1.5 flex-wrap">${opts.map((o, i) => {
          let cls = p === i ? 'bg-sky-500/20 border-sky-400 text-white' : 'bg-ink-800 border-ink-600 text-ink-200 hover:bg-ink-700';
          if (checked && i === r.best) cls = 'bg-emerald-500/20 border-emerald-400 text-emerald-100';
          else if (checked && p === i) cls = ok(r, i) ? 'bg-sky-500/20 border-sky-400 text-sky-100' : 'bg-rose-500/20 border-rose-400 text-rose-100';
          return `<button data-b="${r.key}" data-a="${i}" class="rounded-lg border px-3 py-2 text-sm font-semibold transition ${cls}" ${checked ? 'disabled' : ''}>${esc(shortLabel(o))}</button>`;
        }).join('')}</div>
      </div>
      ${checked ? `<div class="flex h-1.5 rounded-full overflow-hidden mt-2 gap-[2px] bg-ink-800">${mix}</div>
        <div class="mt-1.5 text-xs text-ink-300">Best: <b class="text-emerald-300">${esc(opts[r.best].label)}</b>${r.agree < 0.95 ? ` for ${pct(r.agree)} of these hands` : ''}${p !== r.best && ok(r, p) ? `; ${esc(shortLabel(opts[p]))} is right for ${pct(r.mix[p])} of them too` : ''}.</div>` : ''}
    </div>`;
  };
  container.innerHTML = `<div class="page space-y-4">
    ${header}
    <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5 items-start">
      <div class="space-y-3 min-w-0">
        ${tableHtml(spot, s)}
        <div class="panel panel-pad space-y-2">
          <div class="text-sm">${who}</div>
          ${lineHtml(spot)}
          <div class="text-xs text-ink-400">Board: ${esc(boardLine(bd))} · pot ${fmtBB(spot.pot)}${spot.toCall > 0 ? ` · ${fmtBB(spot.toCall)} to call` : ''}</div>
        </div>
      </div>
      <div class="space-y-2">
        ${rows.map(rowHtml).join('')}
        ${checked ? verdict(frac >= 0.85 ? 'best' : frac >= 0.6 ? 'fine' : 'mistake', `You played ${pct(frac)} of your range right`, 'Weighted by how much of your range each bucket is. The bar under each bucket shows how its hands split across the plays.')
          + `<button id="bk-next" class="btn btn-primary btn-lg btn-block">Next spot ${icon('next', 'w-5 h-5')}</button>`
          : `<button id="bk-check" class="btn btn-primary btn-lg btn-block" ${rows.every(r => picks[r.key] != null) ? '' : 'disabled'}>Check my plan</button>`}
      </div>
    </div>
  </div>`;
  wire(container, spots);
}

function wire(container, spots) {
  container.querySelector('#bk-street')?.addEventListener('change', (e) => { st.street = Number(e.target.value); next(spots); draw(container, spots); });
  container.querySelector('#bk-players')?.addEventListener('change', (e) => { st.players = e.target.value; next(spots); draw(container, spots); });
  container.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => { st.cur.picks[b.dataset.b] = Number(b.dataset.a); draw(container, spots); }));
  container.querySelector('#bk-check')?.addEventListener('click', () => {
    const c = st.cur;
    c.checked = true;
    let sc = 0, w = 0;
    for (const r of c.rows) { w += r.share; if (ok(r, c.picks[r.key])) sc += r.share; }
    const good = w && sc / w >= 0.85;
    st.streak = good ? st.streak + 1 : 0;
    const all = loadRaw(KEYS.drills, {});
    const rec = all.buckets || { n: 0, good: 0, best: 0 };
    rec.n++; if (good) rec.good++;
    rec.best = Math.max(rec.best, st.streak);
    all.buckets = rec;
    all.bucketsSeen = [...(all.bucketsSeen || []), c.spot.id].slice(-150);
    save(KEYS.drills, all);
    draw(container, spots);
  });
  container.querySelector('#bk-next')?.addEventListener('click', () => { next(spots); draw(container, spots); window.scrollTo(0, 0); });
}
