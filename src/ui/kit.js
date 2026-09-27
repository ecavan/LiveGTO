/**
 * UI kit: playing cards, the table, buttons, bars, disclosures, icons.
 * Everything returns HTML strings; views wire events after rendering.
 */
import { cardStr } from '../engine/hu/hand.js';

export const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const toStr = (c) => (typeof c === 'number' ? cardStr(c) : c);

/** One playing card. `c` is "Ah" or a card id. size: sm | md | lg | xl. */
export function card(c, size = 'md', extra = '') {
  const s = toStr(c);
  const r = s[0] === 'T' ? '10' : s[0];
  return `<div class="pc ${size} suit-${s[1]} ${extra}"><span class="r">${r}</span><span class="s">${SUIT_SYM[s[1]]}</span></div>`;
}
export const back = (size = '') => `<div class="pc-back ${size}"></div>`;
export const slot = (size = 'lg') => `<div class="pc-slot ${size}"></div>`;
export const cards = (list, size = 'md', extra = '') => list.map(c => card(c, size, extra)).join('');

/** Inline cards for text: A♠K♦ with suit colours. */
export function cardText(c) {
  const s = toStr(c);
  return `<span class="font-semibold whitespace-nowrap">${s[0]}<span class="ts-${s[1]}">${SUIT_SYM[s[1]]}</span></span>`;
}
export const handText = (list) => list.map(cardText).join('');

/**
 * Heads-up table. top/bottom: { name, sub, stack, cards: [ids] | 'back' | null, folded, dealer }
 * bets: { top, bottom } amounts (bb). acting: 'top' | 'bottom' | null.
 */
export function pokerTable({ top, bottom, board = [], pot = null, note = '', bets = {}, acting = null, dim = [] }) {
  const pod = (p, where) => {
    if (!p) return '';
    const cs = p.cards === 'back' ? back('') + back('')
      : Array.isArray(p.cards) ? p.cards.map(c => card(c, where === 'bottom' ? 'xl' : 'lg', 'deal')).join('') : '';
    const plate = `<div class="pod-plate">
      <div class="flex items-center gap-2 w-full"><span class="pod-name">${esc(p.name)}</span>${p.dealer ? '<span class="dealer ml-auto">D</span>' : ''}</div>
      ${p.sub ? `<div class="pod-sub">${p.sub}</div>` : ''}
      <div class="pod-stack">${p.stack}</div></div>`;
    const inner = where === 'top' ? `${plate}<div class="pod-cards">${cs}</div>` : `<div class="pod-cards">${cs}</div>${plate}`;
    return `<div class="pod ${where} ${acting === where ? 'acting' : ''} ${p.folded ? 'folded' : ''}">${inner}</div>`;
  };
  const bet = (amt, where) => (amt > 0 ? `<div class="bet ${where}"><span class="chipstack"></span><b>${fmtBB(amt)}</b></div>` : '');
  const slots = [];
  for (let i = 0; i < 5; i++) slots.push(board[i] != null ? card(board[i], 'lg', `deal ${dim.includes(i) ? 'dim' : ''}`) : slot('lg'));
  return `<div class="tbl">
    <div class="tbl-rail"></div><div class="tbl-felt"></div>
    <div class="tbl-center">
      ${pot != null ? `<div class="tbl-pot">Pot ${fmtBB(pot)}</div>` : ''}
      <div class="tbl-board">${slots.join('')}</div>
      ${note ? `<div class="tbl-note">${note}</div>` : ''}
    </div>
    ${bet(bets.top, 'top')}${bet(bets.bottom, 'bottom')}
    ${pod(top, 'top')}${pod(bottom, 'bottom')}
  </div>`;
}

export function fmtBB(x, { sign = false } = {}) {
  const v = Math.round(x * 100) / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) >= 10 ? 1 : 2).replace(/\.?0+$/, '');
  return `${sign && v > 0 ? '+' : ''}${s}bb`;
}

/** Segmented control. items: [{ v, label }] */
export function seg(name, items, value) {
  return `<div class="seg" data-seg="${name}">${items.map(it => `<button data-v="${it.v}" class="${String(it.v) === String(value) ? 'on' : ''}">${it.label}</button>`).join('')}</div>`;
}

/** Wire every segmented control in `root`: onChange(name, value). */
export function wireSeg(root, onChange) {
  root.querySelectorAll('[data-seg]').forEach(el => {
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => onChange(el.dataset.seg, b.dataset.v)));
  });
}

export const disc = (title, body, open = false, extra = '') =>
  `<details class="disc ${extra}" ${open ? 'open' : ''}><summary>${title}</summary><div class="body">${body}</div></details>`;

export const stat = (k, v, s = '', tone = '') =>
  `<div class="stat"><div class="k">${k}</div><div class="v ${tone}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

/** EV bars for a set of options: [{ label, ev }], index of best, fine indices, chosen index. */
export function evBars(options, { best, fine = [], chosen = -1 }) {
  const evs = options.map(o => o.ev);
  const mx = Math.max(...evs), mn = Math.min(...evs, 0);
  return `<div class="space-y-2">${options.map((o, i) => {
    const w = Math.max(3, (100 * (o.ev - mn)) / Math.max(0.01, mx - mn));
    const col = i === best ? 'bg-emerald-400' : fine.includes(i) ? 'bg-sky-400' : 'bg-ink-400';
    const loss = mx - o.ev;
    return `<div class="evrow">
      <div class="truncate ${i === chosen ? 'text-white font-semibold' : 'text-ink-300'}">${i === chosen ? '▸ ' : ''}${esc(o.label)}</div>
      <div class="evbar"><i class="${col}" style="width:${w}%"></i></div>
      <div class="text-right num text-xs ${i === best ? 'text-emerald-300 font-semibold' : 'text-ink-300'}">${i === best ? 'best' : `−${loss.toFixed(loss >= 10 ? 1 : 2)}`}</div>
    </div>`;
  }).join('')}</div>`;
}

/** 13×13 grid. cells: array of 169 { label, bg, me, title } in AKQ… order (pairs on the diagonal). */
export function rangeGrid(cells) {
  return `<div class="rg">${cells.map(c => `<div class="${c.me ? 'me' : ''}" style="background:${c.bg}" title="${esc(c.title || c.label)}">${c.label}</div>`).join('')}</div>`;
}

const RANKS = 'AKQJT98765432';
/** Labels of the 169 grid cells, row-major: AA AKs AQs … / AKo KK KQs … */
export const GRID = (() => {
  const out = [];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    if (i === j) out.push(RANKS[i] + RANKS[j]);
    else if (i < j) out.push(RANKS[i] + RANKS[j] + 's');
    else out.push(RANKS[j] + RANKS[i] + 'o');
  }
  return out;
})();

const ICONS = {
  learn: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/>',
  puzzle: '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7Z"/>',
  play: '<path d="M12 2c3 4 8 6.5 8 11a4.5 4.5 0 0 1-7 3.7L14 22h-4l1-5.3A4.5 4.5 0 0 1 4 13c0-4.5 5-7 8-11Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 14h.01M16 14h.01"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/>',
};
export function icon(name, cls = 'w-5 h-5') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Verdict banner. kind: best | fine | mistake | blunder */
export function verdict(kind, title, sub = '') {
  const ic = kind === 'best' ? 'check' : kind === 'fine' ? 'check' : 'x';
  const col = { best: 'text-emerald-300', fine: 'text-sky-300', mistake: 'text-rose-300', blunder: 'text-red-300' }[kind];
  return `<div class="verdict v-${kind} fade-up">
    <div class="flex items-center gap-2 font-semibold ${col}">${icon(ic, 'w-5 h-5')}<span>${title}</span></div>
    ${sub ? `<div class="text-sm text-ink-200 mt-1">${sub}</div>` : ''}</div>`;
}

/** Tone for a loss in bb relative to the pot. */
export function lossKind(loss, potSize) {
  if (loss <= 0.005) return 'best';
  const rel = loss / Math.max(1, potSize);
  return rel >= 0.25 || loss >= 10 ? 'blunder' : 'mistake';
}
