/**
 * Bucket views: your range as a handful of kinds of hand, each with one plan, and his range the
 * same way. Used by the Play coach, the puzzles and the Buckets drill.
 */
import { esc } from './kit.js';
import { pct } from '../engine/potmath.js';
import { BUCKET, boardLine } from '../engine/buckets.js';

export const ACT_COL = { fold: '#64748b', check: '#38bdf8', call: '#0ea5e9', bet: '#10b981', raise: '#f59e0b', allin: '#f43f5e' };

/** A colour per option: bets get lighter → darker green by size. */
export function optionColors(options) {
  const bets = options.filter(o => o.type === 'bet');
  return options.map(o => {
    if (o.type === 'bet') return bets.indexOf(o) === 0 ? '#34d399' : '#059669';
    if (o.type === 'raise' && options.filter(x => x.type === 'raise').indexOf(o) > 0) return '#d97706';
    return ACT_COL[o.type] || '#64748b';
  });
}

/** Short action names for chips: "Bet 75%", "Raise", "Call". */
export function shortLabel(o) {
  if (!o) return '';
  const m = o.label.match(/^Bet [\d.]+ \((\d+)%\)$/);
  if (m) return `Bet ${m[1]}%`;
  if (/^Raise to/.test(o.label)) return o.label.replace('Raise to', 'Raise to');
  if (/^Call/.test(o.label)) return 'Call';
  if (/^All-in/.test(o.label)) return 'All-in';
  return o.label.replace(/^bet /i, 'Bet ');
}

const chip = (o, col) => `<span class="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[13px] font-semibold text-white whitespace-nowrap" style="background:${col}33;border:1px solid ${col}aa">${esc(shortLabel(o))}</span>`;

/**
 * Plan by bucket. view: { rows, options, hero?, board? }. opts: { title, note, hero (bucket key),
 * guess: { picks: {key: optionIdx} } to mark a drill's answers }.
 */
export function bucketPlanHtml(view, { hero = view.hero, note = '' } = {}) {
  if (!view?.rows?.length) return '<div class="text-sm text-ink-400">Not available here.</div>';
  const cols = optionColors(view.options);
  const mine = view.rows.find(r => r.key === hero);
  const head = mine ? `<div class="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-ink-100">
      You have <b class="text-amber-200">${esc(mine.name)}</b>${mine.desc ? ` <span class="text-ink-300">(${esc(mine.desc)})</span>` : ''}. With these here: ${chip(view.options[mine.best], cols[mine.best])}${mine.agree < 0.9 ? ` <span class="text-ink-300">for ${pct(mine.agree)} of them</span>` : ''}.</div>` : '';
  const rows = view.rows.map(r => {
    const me = r.key === hero;
    const mix = r.mix.map((x, j) => (x > 0.005 ? `<i style="width:${100 * x}%;background:${cols[j]}" title="${esc(view.options[j].label)}: ${pct(x)}"></i>` : '')).join('');
    return `<div class="rounded-lg px-3 py-2 ${me ? 'bg-amber-500/5 ring-1 ring-amber-400/50' : 'bg-ink-850'}">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1"><div class="text-sm font-semibold text-white truncate">${esc(r.name)}${me ? ' <span class="text-[10px] uppercase tracking-wider text-amber-300 font-bold ml-1">you</span>' : ''}</div>
          <div class="text-[11px] text-ink-400 truncate">${pct(r.share)} of your range${r.examples?.length ? ` · ${r.examples.map(esc).join(' ')}` : ''}</div></div>
        ${chip(view.options[r.best], cols[r.best])}
      </div>
      <div class="flex h-1.5 rounded-full overflow-hidden mt-1.5 gap-[2px] bg-ink-800">${mix}</div>
      ${r.desc ? `<div class="text-[11px] text-ink-400 mt-1">${esc(r.desc)}</div>` : ''}
    </div>`;
  }).join('');
  const used = [...new Set(view.rows.flatMap(r => r.mix.map((x, j) => (x > 0.005 ? j : -1)).filter(j => j >= 0)))].sort((a, b) => a - b);
  const legend = used.map(j => `<span class="inline-flex items-center gap-1 mr-3"><i class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${cols[j]}"></i>${esc(view.options[j].label)}</span>`).join('');
  return `<div class="space-y-2">${head}
    ${view.board?.length ? `<div class="text-xs text-ink-400">Board: ${esc(boardLine(view.board))}</div>` : ''}
    <div class="space-y-1.5">${rows}</div>
    <div class="text-[11px] text-ink-400 leading-5">${legend}</div>
    ${note ? `<div class="text-[11px] text-ink-400">${note}</div>` : ''}</div>`;
}

const BCOL = { nutted: '#f43f5e', vulnerable: '#fb923c', strong: '#f59e0b', medium: '#eab308', weak: '#84cc16', fdraw: '#38bdf8', sdraw: '#818cf8', draw: '#38bdf8', air: '#64748b' };

/** His range by bucket, as bars with examples. */
export function bucketBarsHtml(rows) {
  if (!rows?.length) return '';
  return `<div class="space-y-1.5">${rows.filter(r => r.share >= 0.005).map(r => `
    <div class="grid items-center gap-2 text-sm" style="grid-template-columns: 124px 1fr 44px">
      <span class="text-ink-200 truncate" title="${esc(r.desc || '')}">${esc(r.name)}</span>
      <div class="evbar"><i style="width:${Math.max(2, 100 * r.share)}%;background:${BCOL[r.key] || '#64748b'}"></i></div>
      <span class="text-right num text-ink-200">${pct(r.share)}</span></div>
    ${r.examples?.length ? `<div class="text-[11px] text-ink-400 -mt-1" style="padding-left:132px">${r.examples.map(esc).join(' · ')}</div>` : ''}`).join('')}</div>`;
}

/** "Medium pairs" for a bucket key. */
export const bucketName = (key) => BUCKET[key]?.name ?? key;
