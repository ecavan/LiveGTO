/**
 * Learn → Hand buckets: how to sort your hand after the flop, and the default plan for each kind
 * of hand. The examples are computed from the same bucket code the coach and the puzzles use.
 */
import { icon, esc, cards, handText } from '../kit.js';
import { BUCKETS, BUCKET_PLAN, composition, bucketOf, bucketWhy, BUCKET, boardDangers } from '../../engine/buckets.js';
import { ids, cardStr } from '../../engine/hu/hand.js';
import { N } from '../../engine/hu/equity.js';
import { pct } from '../../engine/potmath.js';

const c = (s) => ids(s.match(/../g));
const BOARDS = [
  { id: 'dry', label: 'K♠ 7♥ 2♦', cards: 'Ks7h2d', note: 'Dry: no flush draw, hardly any straight draws. Most hands are pairs or air.' },
  { id: 'wet', label: 'J♥ T♥ 8♣', cards: 'JhTh8c', note: 'Wet: flush and straight draws everywhere, two pair and sets are vulnerable.' },
  { id: 'paired', label: '9♣ 9♦ 4♠', cards: '9c9d4s', note: 'Paired: few strong hands; trips are the monsters, a full house is possible.' },
];
const BCOL = { nutted: '#f43f5e', vulnerable: '#fb923c', strong: '#f59e0b', medium: '#eab308', weak: '#84cc16', fdraw: '#38bdf8', sdraw: '#818cf8', eqair: '#a78bfa', air: '#64748b' };
let pickBoard = 'dry';

export function render(container) {
  draw(container);
}

function boardView(b) {
  const board = c(b.cards);
  const rows = composition(new Float64Array(N).fill(1), board, 0.001);
  return `<div class="space-y-1.5">
    <div class="text-xs text-ink-400">${esc(b.note)}${boardDangers(board).length ? ` <span class="text-ink-300">(${esc(boardDangers(board).join(', '))})</span>` : ''}</div>
    ${rows.map(r => `<div class="grid items-center gap-2 text-sm" style="grid-template-columns: 150px 1fr 48px">
      <span class="text-ink-100 truncate">${esc(r.name)}</span>
      <div class="evbar"><i style="width:${Math.max(2, 100 * r.share)}%;background:${BCOL[r.key]}"></i></div>
      <span class="text-right num text-ink-200">${pct(r.share)}</span></div>
      <div class="text-[11px] text-ink-400 -mt-1" style="padding-left:158px">${esc(r.desc)}${r.examples?.length ? ` · e.g. ${r.examples.map(esc).join(', ')}` : ''}</div>`).join('')}
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
  const b = BOARDS.find(x => x.id === pickBoard) || BOARDS[0];
  container.innerHTML = `<div class="page max-w-3xl space-y-5 fade-up">
    <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
    <div><div class="h-sec">Hand reading</div><h1 class="h-title">Hand buckets</h1>
      <p class="text-ink-300 mt-1">After the flop, don't think "I have J♠T♠". Think "I have a backdoor hand with no pair". Every hand falls into one of nine buckets, and each bucket has a default plan. Sort your hand first; the play follows.</p></div>

    <section class="panel panel-pad space-y-3">
      <h2 class="text-lg font-semibold text-white">The nine buckets, strongest first</h2>
      <div class="space-y-2">${BUCKETS.map(B => `<div class="rounded-lg bg-ink-850 px-3 py-2">
        <div class="flex items-center gap-2"><i class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${BCOL[B.key]}"></i><b class="text-white">${esc(B.name)}</b><span class="text-xs text-ink-400">${esc(B.desc)}</span></div>
        <div class="text-sm text-ink-200 mt-1">${esc(BUCKET_PLAN[B.key].hu)}</div>
        <div class="text-xs text-ink-400 mt-0.5">Multiway: ${esc(BUCKET_PLAN[B.key].mw)}</div></div>`).join('')}</div>
      <p class="text-xs text-ink-400">These are defaults against a solid player. The puzzles and the coach show when a villain changes them: against a station you bet more value and bluff less, against a nit the other way round.</p>
    </section>

    <section class="panel panel-pad space-y-3">
      <h2 class="text-lg font-semibold text-white">The board decides the bucket</h2>
      <p class="text-sm text-ink-300">The same hand is a monster on one board and vulnerable on the next. A set on K♠7♥2♦ is close to the nuts; on J♥T♥8♣ a flush or straight comes on many turns. Here is how all hands split on three kinds of flop:</p>
      <div class="flex gap-2 flex-wrap">${BOARDS.map(x => `<button data-board="${x.id}" class="btn ${x.id === b.id ? 'btn-primary' : 'btn-quiet'} text-sm">${esc(x.label)}</button>`).join('')}</div>
      <div class="flex justify-center gap-1">${cards(c(b.cards), 'md')}</div>
      ${boardView(b)}
    </section>

    <section class="panel panel-pad space-y-3">
      <h2 class="text-lg font-semibold text-white">Air isn't all the same</h2>
      <p class="text-sm text-ink-300">"Air with equity" means no pair and no real draw, but cards that can still win: a gutshot, two overcards, or on the flop a backdoor flush or straight draw. Those are the hands you bluff with, because they win sometimes when called and can turn into a draw on the turn. "Dead air" has none of that: check and fold unless you have a real reason to bluff.</p>
      ${journey()}
    </section>

    <section class="panel panel-pad space-y-2">
      <h2 class="text-lg font-semibold text-white">Multiway</h2>
      <ul class="list-disc pl-5 text-sm text-ink-200 space-y-1">
        <li>With two or more opponents someone usually has something: bluff much less, and give up most air.</li>
        <li>Your medium and weak pairs lose value fast: they are bluff-catchers against one player, not three.</li>
        <li>Value hands bet bigger: more players means more people who can call.</li>
        <li>Draws like to call cheaply and win a big pot when they hit, rather than semi-bluff into several players.</li>
      </ul>
    </section>

    <section class="space-y-2">
      <h2 class="text-lg font-semibold text-white">Practise</h2>
      <div class="grid sm:grid-cols-3 gap-3">
        <a href="#learn/drill/bucket" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Bucket your hand</b><div class="text-xs text-ink-300 mt-1">A hand and a board: name the bucket, then see the plan. Endless.</div></a>
        <a href="#puzzles" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Puzzles</b><div class="text-xs text-ink-300 mt-1">Flop and multiway puzzles ask for your bucket before your play.</div></a>
        <a href="#puzzles/buckets" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Range buckets</b><div class="text-xs text-ink-300 mt-1">Your whole range in a real spot: one plan for each bucket.</div></a>
      </div>
    </section>
  </div>`;
  container.querySelectorAll('[data-board]').forEach(el => el.addEventListener('click', () => { pickBoard = el.dataset.board; draw(container); }));
}
