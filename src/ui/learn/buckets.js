/**
 * Learn → Hand buckets: sort your hand after the flop into one of six buckets, then play the plan
 * for that bucket on that kind of board. Level 1 shows the baseline plan (the solver), Level 2 how
 * it changes against each villain type. The plans come from the solved library (plans.json); the
 * examples from the same bucket code the coach and the puzzles use.
 */
import { icon, esc, cards, handText, levelSwitch, wireLevel } from '../kit.js';
import { BUCKETS, BUCKET_PLAN, composition, bucketOf, bucketWhy, BUCKET, boardDangers, BOARD_KINDS } from '../../engine/buckets.js';
import { planFor, planSpots, PLAN_VILLAINS, ACT_NAME, ACT_TIP } from '../../engine/plans.js';
import { getLevel } from '../../engine/level.js';
import { ids, cardStr } from '../../engine/hu/hand.js';
import { N } from '../../engine/hu/equity.js';
import { pct } from '../../engine/potmath.js';

const c = (s) => ids(s.match(/../g));
const BOARDS = {
  dry: { label: 'K♠ 7♥ 2♦', cards: 'Ks7h2d', note: 'Dry: no flush draw, hardly any straight draws. Most hands are pairs or air, and your strong hands stay strong.' },
  wet: { label: 'J♥ T♥ 8♣', cards: 'JhTh8c', note: 'Wet: flush and straight draws everywhere; two pair and sets can be outdrawn, so they are Value, not Nuts.' },
  paired: { label: '9♣ 9♦ 4♠', cards: '9c9d4s', note: 'Paired: few strong hands. Trips and full houses are the nuts; any pocket pair is a decent bluff-catcher.' },
  monotone: { label: '8♣ 7♣ 2♣', cards: '8c7c2c', note: 'Monotone: a flush is already possible. Only flushes are the nuts; a set or an overpair without a club is Value.' },
};
const BCOL = { nuts: '#f43f5e', value: '#f59e0b', catcher: '#eab308', draw: '#38bdf8', eqair: '#a78bfa', air: '#64748b' };
const ACOL = { check: '#38bdf8', fold: '#64748b', call: '#0ea5e9', 'bet small': '#34d399', 'bet big': '#059669', raise: '#f59e0b' };
let kind = 'dry';
let villain = 'station';

export function render(container) {
  draw(container);
}

/** One plan cell: the play, and the second play when it is close to a mix. */
function cell(pl, base = null) {
  if (!pl) return '<span class="text-ink-500">—</span>';
  const second = Object.entries(pl.dist).filter(([k]) => k !== pl.act).sort((a, b) => b[1] - a[1])[0];
  const mixed = pl.p < 0.55 && second && second[1] >= 0.25;
  const chip = (a) => `<span class="inline-block rounded-md px-2 py-0.5 text-[13px] font-semibold text-white whitespace-nowrap" title="${esc(ACT_TIP[a] ?? '')}" style="background:${ACOL[a]}33;border:1px solid ${ACOL[a]}aa">${ACT_NAME[a] ?? a}</span>`;
  const changed = base && base.act !== pl.act;
  return `<div class="flex items-center gap-1 flex-wrap">${chip(pl.act)}${mixed ? `<span class="text-ink-400 text-xs">or</span>${chip(second[0])}` : ''}
    ${changed ? `<span class="text-[11px] text-amber-200">was ${esc(ACT_NAME[base.act] ?? base.act)}</span>` : ''}</div>`;
}

function planTable(level) {
  const lv = level === 1 ? 'gto' : villain;
  const rows = BUCKETS.map(B => {
    const bet = planFor(lv, kind, 'bet', B.key), fac = planFor(lv, kind, 'facing', B.key);
    const bBet = level === 2 ? planFor('gto', kind, 'bet', B.key) : null, bFac = level === 2 ? planFor('gto', kind, 'facing', B.key) : null;
    return `<tr class="border-t border-ink-700/60">
      <td class="py-2 pr-2"><div class="flex items-center gap-2"><i class="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style="background:${BCOL[B.key]}"></i><b class="text-white">${esc(B.name)}</b></div></td>
      <td class="py-2 pr-2">${cell(bet, bBet)}</td>
      <td class="py-2">${cell(fac, bFac)}</td></tr>`;
  }).join('');
  return `<table class="w-full text-sm">
    <thead><tr class="text-left text-[11px] uppercase tracking-wide text-ink-400"><th class="pb-1 font-semibold">Bucket</th><th class="pb-1 font-semibold">Checked to you, or first in</th><th class="pb-1 font-semibold">Facing a bet</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function boardView(b) {
  const board = c(b.cards);
  const rows = composition(new Float64Array(N).fill(1), board, 0.001);
  return `<div class="space-y-1.5">
    <div class="text-xs text-ink-400">${esc(b.note)}${boardDangers(board).length ? ` <span class="text-ink-300">(${esc(boardDangers(board).join(', '))})</span>` : ''}</div>
    ${rows.map(r => `<div class="grid items-center gap-2 text-sm" style="grid-template-columns: 130px 1fr 48px">
      <span class="text-ink-100 truncate">${esc(r.name)}</span>
      <div class="evbar"><i style="width:${Math.max(2, 100 * r.share)}%;background:${BCOL[r.key]}"></i></div>
      <span class="text-right num text-ink-200">${pct(r.share)}</span></div>
      ${r.examples?.length ? `<div class="text-[11px] text-ink-400 -mt-1" style="padding-left:138px">e.g. ${r.examples.map(esc).join(', ')}</div>` : ''}`).join('')}
    <div class="text-[11px] text-ink-400 pt-1">Share of all two-card hands. A real range is narrower (you won't have 72o after raising), but the order is the same.</div>
  </div>`;
}

function journey() {
  const hole = c('JsTs');
  const steps = [['As7h2d', 'Flop'], ['As7h2dKs', 'Turn K♠'], ['As7h2d4c', 'Turn 4♣']];
  return `<div class="space-y-2">${steps.map(([b, lab]) => {
    const board = c(b);
    const k = bucketOf(hole, board);
    return `<div class="flex items-center gap-3 flex-wrap rounded-lg bg-ink-850 px-3 py-2">
      <span class="text-ink-400 w-16 text-sm">${lab}</span><span>${handText(board.map(cardStr))}</span>
      <span class="text-sm"><b style="color:${BCOL[k]}">${esc(BUCKET[k].name)}</b> <span class="text-ink-300">${esc(bucketWhy(hole, board))}</span></span></div>`;
  }).join('')}
  <p class="text-sm text-ink-300">J♠T♠ on A♠7♥2♦ has no pair and no draw, but it isn't dead: two backdoor draws make it a good c-bet. The K♠ gives it a flush draw and a gutshot (a double barrel); the 4♣ leaves it with nothing (give up).</p></div>`;
}

function draw(container) {
  const level = getLevel();
  const b = BOARDS[kind];
  container.innerHTML = `<div class="page max-w-3xl space-y-5 fade-up">
    <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
    <div><div class="h-sec">Hand reading</div><h1 class="h-title">Hand buckets</h1>
      <p class="text-ink-300 mt-1">After the flop, don't think "I have J♠T♠". Think "I have air with equity". Every hand falls into one of six buckets, and each bucket has a plan that depends on the board. Sort your hand first; the play follows.</p></div>

    <section class="panel panel-pad space-y-3">
      <h2 class="text-lg font-semibold text-white">The six buckets, strongest first</h2>
      <div class="space-y-2">${BUCKETS.map(B => `<div class="rounded-lg bg-ink-850 px-3 py-2">
        <div class="flex items-center gap-2 flex-wrap"><i class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${BCOL[B.key]}"></i><b class="text-white">${esc(B.name)}</b><span class="text-xs text-ink-400">${esc(B.desc)}</span></div>
        <div class="text-sm text-ink-200 mt-1">${esc(BUCKET_PLAN[B.key].hu)}</div></div>`).join('')}</div>
    </section>

    <section class="panel panel-pad space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <h2 class="text-lg font-semibold text-white">The plan, by board</h2>
        ${levelSwitch({ blurb: false })}
      </div>
      <p class="text-sm text-ink-300">${level === 1
        ? 'Level 1, the baseline: what the solver does with each bucket against a solid player. Learn this first; it is also the right default against someone you haven\'t read yet.'
        : 'Level 2, the exploit: the best play with each bucket against this type of player. Amber marks what changes from the baseline.'}</p>
      <div class="flex gap-2 flex-wrap">${Object.entries(BOARD_KINDS).map(([k, K]) => `<button data-kind="${k}" class="btn ${k === kind ? 'btn-primary' : 'btn-quiet'} text-sm">${K.name}</button>`).join('')}</div>
      ${level === 2 ? `<div class="flex gap-2 flex-wrap items-center"><span class="text-xs text-ink-400">Against</span>${Object.entries(PLAN_VILLAINS).map(([k, n]) => `<button data-vil="${k}" class="btn ${k === villain ? 'btn-primary' : 'btn-quiet'} text-sm">${n}</button>`).join('')}</div>` : ''}
      <div class="flex items-center gap-3 flex-wrap"><div class="flex gap-1">${cards(c(b.cards), 'sm')}</div><span class="text-xs text-ink-400">${esc(BOARD_KINDS[kind].name)}: ${esc(BOARD_KINDS[kind].desc)}</span></div>
      ${planTable(level)}
      <p class="text-[11px] text-ink-400">Heads-up, from ${planSpots().toLocaleString()} solved turn and river spots, grouped by the kind of flop. Bet small is under half the pot, bet big half the pot or more. "Or" means the solver splits those hands between two plays.</p>
      <details class="disc"><summary>Multiway (two or more opponents)</summary><div class="body space-y-1.5">
        ${BUCKETS.map(B => `<div class="text-sm"><b class="text-white">${esc(B.name)}:</b> <span class="text-ink-200">${esc(BUCKET_PLAN[B.key].mw)}</span></div>`).join('')}
        <p class="text-xs text-ink-400 pt-1">With more players someone usually has something: bluff much less, bet your value bigger, and a bluff-catcher against one player is a fold against three.</p></div></details>
    </section>

    <section class="panel panel-pad space-y-3">
      <h2 class="text-lg font-semibold text-white">The board decides the bucket</h2>
      <p class="text-sm text-ink-300">The same hand is Nuts on one board and Value on the next. A set on K♠7♥2♦ is close to the nuts; on J♥T♥8♣ a flush or a straight comes on many turns. Here is how all hands split on each kind of flop:</p>
      <div class="flex gap-2 flex-wrap">${Object.entries(BOARDS).map(([k, x]) => `<button data-kind="${k}" class="btn ${k === kind ? 'btn-primary' : 'btn-quiet'} text-sm">${esc(x.label)}</button>`).join('')}</div>
      <div class="flex justify-center gap-1">${cards(c(b.cards), 'md')}</div>
      ${boardView(b)}
    </section>

    <section class="panel panel-pad space-y-3">
      <h2 class="text-lg font-semibold text-white">Air isn't all the same</h2>
      <p class="text-sm text-ink-300">"Air with equity" means no pair and no real draw, but cards that can still win: a gutshot, two overcards, or on the flop a backdoor flush or straight draw. Those are your bluffs: they win sometimes when called and can turn into a draw. Plain "Air" has none of that: check and fold unless the player folds far too much.</p>
      ${journey()}
    </section>

    <section class="space-y-2">
      <h2 class="text-lg font-semibold text-white">Practise</h2>
      <div class="grid sm:grid-cols-3 gap-3">
        <a href="#learn/drill/bucket" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Bucket your hand</b><div class="text-xs text-ink-300 mt-1">A hand you'd really have and a board: name the bucket, then see the plan. Endless.</div></a>
        <a href="#puzzles" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Puzzles</b><div class="text-xs text-ink-300 mt-1">Every postflop puzzle asks for your bucket before your play.</div></a>
        <a href="#puzzles/buckets" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Range buckets</b><div class="text-xs text-ink-300 mt-1">Your whole range in a real spot: one plan for each bucket.</div></a>
      </div>
    </section>
  </div>`;
  container.querySelectorAll('[data-kind]').forEach(el => el.addEventListener('click', () => { kind = el.dataset.kind; draw(container); }));
  container.querySelectorAll('[data-vil]').forEach(el => el.addEventListener('click', () => { villain = el.dataset.vil; draw(container); }));
  wireLevel(container, () => draw(container));
}
