/**
 * Play it out: a decision walked through step by step, the way a chess review steps through a
 * line. Poker has no single line (you don't see his cards and the next card is random), so the
 * steps are the branches: the spot, what happens after your play, what happens after the better
 * play, what the next card does to your hand, and the one thing to take away.
 *
 *   spotOfDecision(d)        a graded decision from Play, the live table, Review or a flop /
 *                            multiway puzzle (the coach's options carry the numbers)
 *   spotOfLibrary(r, p, i)   a solver-library puzzle (EVs measured from the best play)
 *   playoutHtml(spot, opts)  the stepper; Back / Next are wired once for the whole document
 */
import { fmtBB, esc, handText, icon, optionLabel } from './kit.js';
import { pct } from '../engine/potmath.js';
import { bucketOf, bucketWhy, BUCKET, BUCKET_PLAN, boardKind, BOARD_KINDS, CLASS_AS_BUCKET } from '../engine/buckets.js';
import { planFor, planText, PLAN_VILLAINS } from '../engine/plans.js';
import { cardStr, cardId } from '../engine/hu/hand.js';
import { getLevel } from '../engine/level.js';

const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
const NEXT = ['flop', 'turn', 'river'];
const RANKED = { nuts: 5, value: 4, catcher: 3, draw: 3, eqair: 2, air: 1 };
const cap = (s) => String(s).replace(/^\w/, c => c.toUpperCase());
const bb = (x, sign = true) => fmtBB(Math.abs(x) < 0.005 ? 0 : x, { sign });
const verb = (o) => (o.type === 'fold' ? 'fold' : o.type === 'check' ? 'check' : o.type === 'call' ? 'call' : o.type === 'bet' ? 'bet' : o.type === 'allin' ? 'go all-in' : 'raise');

// ------------------------------------------------------------------ the spot, from either source

/** A graded decision (hu/session.js, ring/session.js, a generated puzzle, a stored hand). */
export function spotOfDecision(d, { botName = null, fmt = null } = {}) {
  if (!d || d.preflop || !d.options?.length || !(d.street > 0)) return null;
  const top = (d.buckets?.length ? d.buckets.map(b => ({ name: BUCKET[b.key]?.name ?? b.key, share: b.share ?? b.p ?? 0 }))
    : d.range ? Object.entries(d.range).map(([k, v]) => ({ name: CLASS_AS_BUCKET[k]?.name ?? k, share: v })) : [])
    .filter(x => x.share >= 0.05).sort((a, b) => b.share - a.share).slice(0, 3);
  const multiway = (d.opponents ?? 1) > 1;
  const src = d.solid?.source;
  return {
    key: `d|${d.hole?.join('.')}|${d.board?.join('.')}|${d.pot}|${d.chosen}`,
    street: d.street, board: d.board || [], hole: d.hole || null, pot: d.pot, toCall: d.toCall || 0,
    options: d.options.map((o, i) => ({ type: o.type, label: optionLabel(o.label, fmt || fmtBB), ev: o.ev, cost: d.losses?.[i] ?? null, info: o.info || {} })),
    chosen: d.chosen, best: d.best, fine: d.fine || [], verdict: d.verdict, loss: d.loss,
    bucket: d.heroBucket || (d.hole && d.board?.length >= 3 ? bucketOf(d.hole, d.board) : null),
    equity: d.equity, his: top, who: multiway ? 'they' : (botName || 'he'), multiway,
    rule: d.solid?.text || null, exactEv: d.street === 3 && !multiway,
    planLevel: d.level === 2 && PLAN_VILLAINS[src] ? src : 'gto', level: d.level ?? getLevel(), relative: false,
  };
}

/** A library puzzle: record `r`, puzzle `p`, the action you chose. EVs are measured from the best play (0). */
export function spotOfLibrary(r, p, choice) {
  const typeOf = (a) => (/^fold/i.test(a) ? 'fold' : /^check/i.test(a) ? 'check' : /^call/i.test(a) ? 'call' : /^all-in/i.test(a) ? 'allin' : /^raise/i.test(a) ? 'raise' : 'bet');
  const board = r.board.map(cardId);
  const hole = [p.cards.slice(0, 2), p.cards.slice(2, 4)].map(cardId);
  const prof = r.villain.profile;
  // villain_range rows: [class, share in the GTO solve, share against this villain]
  const shares = (r.villain_range || []).map(([cls, g, x]) => ({ class: cls, share: prof === 'gto' ? g : (x ?? g) }));
  const his = shares.filter(x => typeof x.share === 'number' && x.share >= 0.05).map(x => ({ name: CLASS_AS_BUCKET[x.class]?.name ?? x.class, share: x.share }))
    .sort((a, b) => b.share - a.share).slice(0, 3);
  const street = { flop: 1, turn: 2, river: 3 }[r.street] ?? 1;
  return {
    key: `l|${r.id}|${p.cards}|${choice}`,
    street, board, hole, pot: r.pot, toCall: r.to_call || 0,
    options: r.actions.map((a, i) => {
      const m = a.match(/([\d.]+)bb/);
      const to = m ? Number(m[1]) : null;
      const info = {};
      if (typeOf(a) === 'call') { info.eq = p.eq; info.need = r.to_call / (r.pot + r.to_call); }
      else if (to && typeOf(a) !== 'fold' && typeOf(a) !== 'check') { info.risk = to; info.breakEven = to / (r.pot + to); }
      return { type: typeOf(a), label: cap(r.actions_short[i]), ev: p.ev[i], cost: -p.ev[i], info };
    }),
    chosen: choice, best: p.answer, fine: p.fine || [], verdict: null, loss: -p.ev[choice],
    bucket: bucketOf(hole, board), equity: p.eq, his, who: r.villain.name, multiway: false,
    rule: null, exactEv: street === 3, planLevel: PLAN_VILLAINS[prof] ? prof : 'gto', level: prof === 'gto' ? 1 : 2, relative: true,
  };
}

// ------------------------------------------------------------------ one play, as branches

/** The branches after one play: [{ p, title, sub, bb }] and what it comes to. */
function branches(sp, i) {
  const o = sp.options[i], f = o.info || {}, P = sp.pot, C = sp.toCall;
  const he = sp.multiway ? 'everyone' : sp.who === 'he' ? 'he' : esc(sp.who);
  const He = cap(he);
  const rows = [];
  let foot = '';
  if (o.type === 'fold') {
    rows.push({ p: null, title: 'The hand is over', sub: `The ${bb(P, false)} in the middle goes to ${sp.multiway ? 'them' : 'him'}. You lose nothing more.`, bb: 0 });
    if (sp.equity != null && C > 0) foot = `You had <b>${pct(sp.equity)}</b> against ${sp.multiway ? 'their ranges' : 'his range'}; a call needed <b>${pct(C / (P + C))}</b>.`;
  } else if (o.type === 'call') {
    const eq = f.eq ?? sp.equity;
    if (eq != null) {
      rows.push({ p: eq, title: 'You have the best hand at the end', sub: `You win the ${bb(P, false)} in the middle.`, bb: P });
      rows.push({ p: 1 - eq, title: `${sp.multiway ? 'Someone' : He} has you beat`, sub: `You lose the ${bb(C, false)} you put in.`, bb: -C });
      foot = `The price: ${bb(C, false)} to win ${bb(P, false)} needs <b>${pct(f.need ?? C / (P + C))}</b>; you have <b>${pct(eq)}</b>.${sp.street < 3 ? ' With cards to come you don\'t always get to showdown, so the coach counts a little less than the raw number.' : ''}`;
    }
  } else if (o.type === 'check') {
    if (f.botBets != null && f.botBets > 0.02) {
      rows.push({ p: f.botBets, title: `${He} bets`, sub: 'Now you are the one facing a bet: call with what beats bluffs, fold the rest.', bb: null });
      rows.push({ p: 1 - f.botBets, title: `${He} checks behind`, sub: sp.street === 3 ? 'Showdown: the best hand wins the pot as it is.' : `A free ${NEXT[sp.street]}: your hand keeps its share of the pot.`, bb: null });
    } else {
      rows.push({ p: null, title: sp.street === 3 ? 'Showdown' : `A free ${NEXT[sp.street] ?? 'card'}`, sub: sp.equity != null ? `No more money goes in; your <b>${pct(sp.equity)}</b> share of the ${bb(P, false)} pot is worth about ${bb(sp.equity * P, false)}.` : 'No more money goes in.', bb: null });
    }
  } else if (f.fold != null) {
    const F = f.fold;
    const rest = F < 0.995 && o.ev != null && !sp.relative ? (o.ev - F * P) / (1 - F) : null;
    rows.push({ p: F, title: `${He} folds`, sub: `You take the ${bb(P, false)} pot right now.`, bb: P });
    rows.push({ p: 1 - F, title: `${sp.multiway ? 'Someone continues' : `${He} continues`}`, sub: f.eqCalled != null ? `Against the hands that continue you have <b>${pct(f.eqCalled)}</b>, in a bigger pot.` : 'The pot grows and you play on.', bb: rest });
    if (f.breakEven != null) foot = `As a pure bluff this needs a fold <b>${pct(f.breakEven)}</b> of the time; ${sp.multiway ? 'they fold' : `${he} folds`} <b>${pct(F)}</b>.`;
  } else if (f.breakEven != null) {
    rows.push({ p: null, title: `You put ${bb(f.risk, false)} in to win ${bb(P, false)}`, sub: `With a hand that wants a fold, ${he} has to fold <b>${pct(f.breakEven)}</b> of the time. With a hand that wants a call, worse hands have to pay it.`, bb: null });
  }
  return { rows, foot };
}

function treeHtml(sp, i, tone) {
  const o = sp.options[i];
  const { rows, foot } = branches(sp, i);
  const total = sp.relative ? (o.cost > 0.005 ? `${bb(-o.cost)} against the best play` : 'the best play here') : o.ev != null ? `${bb(o.ev)} on average` : '';
  return `<div class="po-tree">
    <div class="po-root ${tone}">You ${o.type === 'allin' ? 'go ' : ''}${esc(o.label.replace(/^\w/, c => c.toLowerCase()))}</div>
    ${rows.map(r => `<div class="po-br${r.p == null ? ' nop' : ''}">
      ${r.p != null ? `<div class="po-p"><b class="num">${pct(r.p)}</b><i style="height:${Math.max(6, Math.round(100 * r.p))}%"></i></div>` : ''}
      <div class="min-w-0"><div class="font-semibold text-ink-100">${r.title}</div><div class="text-sm text-ink-300">${r.sub}</div></div>
      <div class="po-bb num ${r.bb == null ? '' : r.bb > 0.005 ? 'text-emerald-300' : r.bb < -0.005 ? 'text-rose-300' : 'text-ink-300'}">${r.bb == null ? '' : bb(r.bb)}</div>
    </div>`).join('')}
    ${total ? `<div class="po-sum">Comes to <b class="num ${sp.relative ? (o.cost > 0.005 ? 'text-rose-300' : 'text-emerald-300') : o.ev > 0.005 ? 'text-emerald-300' : o.ev < -0.005 ? 'text-rose-300' : 'text-ink-100'}">${total}</b></div>` : ''}
    ${foot ? `<div class="text-sm text-ink-300">${foot}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ the next card

/** What each card still to come does to your hand: groups by the bucket it leaves you in. */
export function nextCards(hole, board) {
  if (!hole || board.length < 3 || board.length > 4) return null;
  const used = new Set([...hole, ...board]);
  const now = bucketOf(hole, board);
  const groups = new Map();
  let n = 0;
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    n++;
    const nb = [...board, c];
    const k = bucketOf(hole, nb);
    const g = groups.get(k) || { key: k, cards: [], kinds: {} };
    g.cards.push(c);
    const kind = boardKind(nb);
    g.kinds[kind] = (g.kinds[kind] || 0) + 1;
    groups.set(k, g);
  }
  const list = [...groups.values()].map(g => ({
    ...g, n: g.cards.length, dir: g.key === now ? 0 : Math.sign(RANKED[g.key] - RANKED[now]),
    kind: Object.entries(g.kinds).sort((a, b) => b[1] - a[1])[0][0],
  })).sort((a, b) => (b.dir - a.dir) || (b.n - a.n));
  return { now, n, groups: list };
}

function nextHtml(sp) {
  const nc = nextCards(sp.hole, sp.board);
  if (!nc) return '';
  const act = sp.options[sp.best];
  const role = ['bet', 'raise', 'allin'].includes(act.type) ? 'aggr' : act.type === 'call' ? 'vs_cbet' : 'free';
  const lead = role === 'aggr' ? `You ${verb(act)} and get called. On the ${NEXT[sp.street]} you act with the betting lead:`
    : role === 'vs_cbet' ? `You call. If ${sp.multiway ? 'the bettor' : 'he'} bets the ${NEXT[sp.street]} again:` : `It checks through. On the ${NEXT[sp.street]}, if it is checked to you:`;
  const then = (g) => {
    if (sp.multiway) return BUCKET_PLAN[g.key]?.mw ?? '';
    const pl = planFor(sp.planLevel, g.kind, role, g.key, 'later') || planFor(sp.planLevel, g.kind, role === 'vs_cbet' ? 'facing' : 'bet', g.key, 'later');
    const t = pl ? planText(pl) : null;
    return t ? `<b class="text-ink-100">${esc(t)}</b>` : esc(BUCKET_PLAN[g.key]?.hu ?? '');
  };
  const sample = (g) => {
    if (g.dir === 0 && g.key === nc.now && g.n > 12) return '<span class="text-ink-400">every other card</span>';
    const shown = g.cards.slice().sort((a, b) => b - a).slice(0, 12);
    return `${handText(shown.map(cardStr))}${g.n > shown.length ? ` <span class="text-ink-400">+${g.n - shown.length}</span>` : ''}`;
  };
  const tone = (g) => (g.dir > 0 ? 'text-emerald-300' : g.dir < 0 ? 'text-rose-300' : 'text-ink-200');
  const word = (g) => (g.dir > 0 ? 'you improve to' : g.dir < 0 ? 'you drop to' : g.key === nc.now ? 'you are still' : 'it becomes');
  return `<div class="space-y-2">
    <p class="text-sm text-ink-300">${lead}</p>
    ${nc.groups.map(g => `<div class="po-next">
      <div class="po-n num ${tone(g)}">${g.n}<small>of ${nc.n}</small></div>
      <div class="min-w-0">
        <div class="text-ink-200">${word(g)} <b class="${tone(g)}">${esc(BUCKET[g.key].name)}</b> <span class="text-ink-400">→</span> ${then(g)}</div>
        <div class="text-sm tracking-wide">${sample(g)}</div>
      </div></div>`).join('')}
    <p class="text-xs text-ink-400">The plan after each card is the one for that kind of hand on that kind of board${sp.multiway ? ', multiway' : ''}. Know it before the card comes, so the scary one doesn't surprise you.</p>
  </div>`;
}

// ------------------------------------------------------------------ the steps

function steps(sp) {
  const out = [];
  const you = sp.options[sp.chosen], best = sp.options[sp.best];
  const same = sp.chosen === sp.best;
  const kind = sp.board.length >= 3 ? BOARD_KINDS[boardKind(sp.board)]?.name?.toLowerCase() : null;
  const why = sp.hole && sp.board.length >= 3 ? bucketWhy(sp.hole, sp.board) : '';
  const his = sp.his.length ? sp.his.map(x => `${esc(x.name.toLowerCase())} ${pct(x.share)}`).join(' · ') : '';
  // 1. the spot
  out.push({
    title: 'The spot',
    body: `<div class="space-y-2 text-ink-200">
      <p>${STREET[sp.street]} <b>${handText(sp.board.map(cardStr))}</b>${kind ? `, a ${kind} board` : ''}. The pot is <b class="num">${bb(sp.pot, false)}</b>${sp.toCall > 0 ? ` and it costs <b class="num">${bb(sp.toCall, false)}</b> to call` : sp.multiway ? ', and it is on you' : ', and it is checked to you (or you are first)'}.</p>
      ${sp.bucket ? `<p>Your ${sp.hole ? handText(sp.hole.map(cardStr)) : 'hand'} is <b class="text-amber-200">${esc(BUCKET[sp.bucket].name)}</b>${why ? `: ${esc(why)}` : ''}.${why && why.toLowerCase() === BUCKET[sp.bucket].desc.toLowerCase() ? '' : ` <span class="text-ink-400">(${esc(cap(BUCKET[sp.bucket].name))}: ${esc(BUCKET[sp.bucket].desc)}.)</span>`}</p>` : ''}
      ${his ? `<p>${sp.multiway ? 'Their ranges are' : `${esc(cap(sp.who))}'s range is`} mostly: <b>${his}</b>${sp.equity != null ? `. You have <b class="num">${pct(sp.equity)}</b> against ${sp.multiway ? 'them' : 'it'}` : ''}.</p>` : sp.equity != null ? `<p>You have <b class="num">${pct(sp.equity)}</b> against ${sp.multiway ? 'their ranges' : 'his range'}.</p>` : ''}
      <p class="text-sm text-ink-400">One question decides it: with this kind of hand, on this kind of board, what is the play you make every time?</p>
    </div>`,
  });
  // 2. your play, when it was not the best
  if (!same) out.push({ title: `Your play: ${esc(you.label)}`, body: treeHtml(sp, sp.chosen, sp.fine.includes(sp.chosen) ? 'fine' : 'bad') });
  // 3. the better play (or yours, when it was the best)
  out.push({ title: same ? `Your play: ${esc(best.label)}` : `The better play: ${esc(best.label)}`, body: treeHtml(sp, sp.best, 'good') });
  // 3b. you were right: the play you might have been tempted by
  if (same && sp.options.length > 1) {
    const alt = sp.options.map((o, i) => ({ o, i })).filter(x => x.i !== sp.best && !sp.fine.includes(x.i))
      .sort((a, b) => (sp.relative || a.o.cost != null ? (a.o.cost ?? 0) - (b.o.cost ?? 0) : b.o.ev - a.o.ev))[0];
    if (alt) out.push({ title: `Why not ${esc(alt.o.label.toLowerCase())}?`, body: treeHtml(sp, alt.i, 'bad') });
  }
  // 4. the next card
  if (sp.street < 3 && best.type !== 'fold' && sp.hole) {
    const nx = nextHtml(sp);
    if (nx) out.push({ title: `Then the ${NEXT[sp.street]} comes`, body: nx });
  }
  // 5. the bottom line
  const gap = sp.relative ? you.cost : (you.cost ?? (best.ev != null && you.ev != null ? best.ev - you.ev : sp.loss));
  const modelLikesYours = !sp.relative && !same && you.ev != null && best.ev != null && you.ev > best.ev + 0.05;
  const base = sp.bucket && !sp.multiway && sp.board.length >= 3 ? planFor(sp.planLevel, boardKind(sp.board), sp.toCall > 0 ? 'facing' : 'bet', sp.bucket, sp.street === 1 ? 'flop' : 'later') : null;
  const ruleLine = sp.rule ? esc(sp.rule) : sp.multiway && sp.bucket ? `${esc(BUCKET[sp.bucket].name)} multiway: ${esc(BUCKET_PLAN[sp.bucket].mw)}` : '';
  out.push({
    title: 'What to take away',
    body: `<div class="space-y-2 text-ink-200">
      <div class="po-take">${sp.bucket ? `<span class="text-amber-200 font-semibold">${esc(BUCKET[sp.bucket].name)}</span>` : 'This hand'}${kind ? ` on a ${kind} board` : ''}${sp.toCall > 0 ? ', facing a bet' : ''}: <b class="text-white">${esc(best.label)}</b>.</div>
      ${ruleLine ? `<p>${ruleLine}</p>` : ''}
      ${same ? '<p class="text-emerald-300">That is what you did.</p>' : gap != null && gap > 0.005 ? `<p>Yours gave up about <b class="num text-rose-300">${bb(gap, false)}</b>${sp.pot ? ` (${pct(gap / Math.max(1, sp.pot))} of the pot)` : ''}.</p>` : '<p>Yours is close enough to count as fine.</p>'}
      ${modelLikesYours ? '<p class="text-sm text-ink-400">The numbers on the last two steps like your play against this exact range. That range is one guess at how he plays; the plan is the play that still holds up when the guess is off, which is why the verdict follows the plan.</p>' : ''}
      ${base && sp.relative && planText(base) && !new RegExp(`^${planText(base).split(' ')[0]}`, 'i').test(best.label) ? `<p class="text-sm text-ink-400">The rule of thumb for this bucket on ${kind} boards is ${esc(planText(base).toLowerCase())}; this spot is one of the exceptions the solver finds, which is why it is a puzzle.</p>` : ''}
    </div>`,
  });
  return out;
}

// ------------------------------------------------------------------ the stepper

const at = new Map(); // spot key → the step you are on (kept across a redraw of the page)
const remember = (k, i) => { if (at.size > 40) at.clear(); at.set(k, i); };

/**
 * The walkthrough. `open`: start on step 1 (after a mistake); otherwise a "Walk me through it"
 * button, so a play you got right is one line and a button.
 */
export function playoutHtml(sp, { open = false } = {}) {
  if (!sp) return '';
  const st = steps(sp);
  const saved = at.get(sp.key);
  const cur = saved ?? (open ? 0 : -1);
  const dots = st.map((_, i) => `<button type="button" class="po-dot${i === cur ? ' on' : ''}" data-po-go="${i}" aria-label="Step ${i + 1}"></button>`).join('');
  return `<div class="po" data-po="${esc(sp.key)}" data-po-n="${st.length}" data-po-at="${cur}">
    <button type="button" class="btn btn-block po-open${cur >= 0 ? ' hidden' : ''}" data-po-go="0">${icon('play', 'w-4 h-4')} Walk me through it <span class="text-ink-400 font-normal">· ${st.length} steps</span></button>
    <div class="po-body${cur < 0 ? ' hidden' : ''}">
      <div class="po-head"><span class="po-count">Step <b data-po-i>${Math.max(1, cur + 1)}</b> of ${st.length}</span><span class="po-dots">${dots}</span></div>
      ${st.map((s, i) => `<section class="po-step${i === cur ? '' : ' hidden'}" data-po-step="${i}"><h3 class="po-title">${s.title}</h3>${s.body}</section>`).join('')}
      <div class="po-nav">
        <button type="button" class="btn" data-po-go="prev" ${cur <= 0 ? 'disabled' : ''}>${icon('back', 'w-4 h-4')} Back</button>
        <button type="button" class="btn btn-primary flex-1" data-po-go="next" ${cur >= st.length - 1 ? 'disabled' : ''}>Next ${icon('next', 'w-4 h-4')}</button>
      </div>
    </div>
  </div>`;
}

function go(root, to) {
  const n = Number(root.dataset.poN);
  const cur = Number(root.dataset.poAt);
  const i = to === 'next' ? Math.min(n - 1, cur + 1) : to === 'prev' ? Math.max(0, cur - 1) : Math.max(0, Math.min(n - 1, Number(to)));
  root.dataset.poAt = String(i);
  remember(root.dataset.po, i);
  root.querySelector('.po-open')?.classList.add('hidden');
  root.querySelector('.po-body')?.classList.remove('hidden');
  root.querySelectorAll('[data-po-step]').forEach(s => s.classList.toggle('hidden', Number(s.dataset.poStep) !== i));
  root.querySelectorAll('.po-dot').forEach((d, j) => d.classList.toggle('on', j === i));
  const lab = root.querySelector('[data-po-i]'); if (lab) lab.textContent = String(i + 1);
  const prev = root.querySelector('[data-po-go="prev"]'), next = root.querySelector('[data-po-go="next"]');
  if (prev) prev.disabled = i <= 0;
  if (next) next.disabled = i >= n - 1;
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-po-go]');
    if (!b || b.disabled) return;
    const root = b.closest('[data-po]');
    if (root) { e.preventDefault(); go(root, b.dataset.poGo); }
  });
}
