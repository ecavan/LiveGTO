/**
 * "Who continues?" Think in ranges: a solved spot, your whole range split into hand classes,
 * and you choose one play per class. Graded against the exploitative solution for this villain.
 */
import { getIndex, getRecord } from '../../engine/library.js';
import { randomSuitMap, remapCard, isCard, boardTags } from '../../engine/texture.js';
import { icon, cards, verdict, esc, disc } from '../kit.js';
import { pct } from '../../engine/potmath.js';
import { loadRaw, save, KEYS } from '../../store.js';

const CLASS = {
  monster: ['Monsters', 'Sets, straights, flushes, top two pair'],
  strong: ['Strong', 'Overpairs, top pair good kicker, bottom two pair'],
  medium: ['Medium', 'Top pair weak kicker, second pair, middle pocket pairs'],
  weak: ['Weak pairs', 'Third pair, small pocket pairs'],
  draw: ['Draws', 'Flush draws, open-enders (turn only)'],
  air: ['Air', 'No pair, no draw'],
};

let cur = null;
let filter = { street: '', decision: '' };

export async function render(container) {
  container.innerHTML = `<div class="page text-ink-400">Loading a spot…</div>`;
  await nextSpot();
  draw(container);
}

async function nextSpot() {
  const idx = await getIndex();
  const pool = idx.records.filter(r => r.profile !== 'gto' && (!filter.street || r.street === filter.street)
    && (!filter.decision || (filter.decision === 'facing' ? /vs_bet/.test(r.decision) : !/vs_bet/.test(r.decision))));
  for (let t = 0; t < 20; t++) {
    const cand = pool[Math.floor(Math.random() * pool.length)];
    const r = await getRecord(cand);
    const rows = r.classes.filter(c => c.exploit.weight >= 0.03);
    if (rows.length < 3) continue;
    const m = randomSuitMap();
    cur = {
      r, rows,
      board: r.board.map(c => remapCard(c, m)),
      prior: r.history.prior.map(x => (isCard(x) ? remapCard(x, m) : x)),
      picks: {}, checked: false,
    };
    return;
  }
}

const best = (pure) => pure.reduce((a, x, i) => (x > pure[a] ? i : a), 0);

function draw(container) {
  const { r, rows, picks, checked } = cur;
  const acts = r.actions_short;
  const all = rows.every(c => picks[c.class] != null);
  let score = 0, wsum = 0;
  if (checked) for (const c of rows) { wsum += c.exploit.weight; if ((c.exploit.pure[picks[c.class]] ?? 0) >= 0.5 || picks[c.class] === best(c.exploit.pure)) score += c.exploit.weight; }
  const street = r.street === 'turn' ? 'Turn' : 'River';
  container.innerHTML = `<div class="page max-w-4xl space-y-4 fade-up">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
      <div class="flex gap-2">
        <select id="f-street"><option value="">Turn + river</option><option value="turn" ${filter.street === 'turn' ? 'selected' : ''}>Turn</option><option value="river" ${filter.street === 'river' ? 'selected' : ''}>River</option></select>
        <select id="f-dec"><option value="">All spots</option><option value="facing" ${filter.decision === 'facing' ? 'selected' : ''}>Facing a bet</option><option value="betting" ${filter.decision === 'betting' ? 'selected' : ''}>Bet or check</option></select>
      </div>
    </div>
    <div><div class="h-sec">Range drill</div><h1 class="h-title">Who continues?</h1>
      <p class="muted text-sm mt-1">Don't play your hand: play your range. Choose one action for each kind of hand you can have here.</p></div>
    <div class="panel panel-pad space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="text-sm text-ink-300">${esc(r.family_name)} · you are <b class="text-white">${r.hero.pos}</b></div>
          <div class="text-sm text-amber-200 mt-0.5">vs ${esc(r.villain.name)}: <span class="text-ink-300">${esc((r.villain.notes || [])[0] || '')}</span></div>
        </div>
        <div class="flex gap-1">${cards(cur.board, 'md')}</div>
      </div>
      <div class="text-sm text-ink-300 space-y-0.5">
        <div><span class="text-ink-400">Preflop</span> ${esc(r.history.preflop)}</div>
        <div><span class="text-ink-400">Before</span> ${esc(cur.prior.join(', '))}</div>
        <div><span class="text-ink-400">${street}</span> ${esc(r.history.street.join(', ') || '—')} · <b class="text-white">${esc(r.decision_desc)}</b> · pot ${r.pot.toFixed(1)}bb${r.to_call > 0 ? ` · ${r.to_call}bb to call` : ''}</div>
        <div class="text-xs text-ink-400">${boardTags(cur.board).join(' · ')}</div>
      </div>
    </div>
    <div class="space-y-2">
      ${rows.map(c => {
        const [name, def] = CLASS[c.class];
        const b = best(c.exploit.pure);
        const g = best(c.gto.pure);
        const p = picks[c.class];
        const ok = checked && (p === b || (c.exploit.pure[p] ?? 0) >= 0.5);
        return `<div class="panel px-4 py-3 ${checked ? (ok ? 'border-emerald-600/50' : 'border-rose-600/50') : ''}">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="min-w-[180px]"><div class="font-semibold text-white">${name} <span class="text-ink-400 font-normal text-sm">· ${pct(c.exploit.weight)} of your range</span></div>
              <div class="text-xs text-ink-400">${def}</div></div>
            <div class="flex gap-1.5 flex-wrap">${acts.map((a, i) => {
              let cls = p === i ? 'bg-sky-500/20 border-sky-400 text-white' : 'bg-ink-800 border-ink-600 text-ink-200 hover:bg-ink-700';
              if (checked && i === b) cls = 'bg-emerald-500/20 border-emerald-400 text-emerald-100';
              else if (checked && p === i) cls = 'bg-rose-500/20 border-rose-400 text-rose-100';
              return `<button data-cls="${c.class}" data-a="${i}" class="rounded-lg border px-3 py-2 text-sm font-semibold transition ${cls}" ${checked ? 'disabled' : ''}>${esc(a)}</button>`;
            }).join('')}</div>
          </div>
          ${checked ? `<div class="mt-2 text-xs text-ink-300">Best: <b class="text-emerald-300">${esc(acts[b])}</b>${c.exploit.pure[b] < 0.999 ? ` for ${pct(c.exploit.pure[b])} of these hands` : ''}${g !== b ? ` · vs a solver you'd ${esc(acts[g])}: the exploit changes this one` : ''}.</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${checked ? verdict(score / wsum >= 0.8 ? 'best' : score / wsum >= 0.5 ? 'fine' : 'mistake', `You played ${pct(score / wsum)} of your range right`, 'Weighted by how much of your range each class is.')
      + disc('What changes against this villain?', `<ul class="list-disc pl-5 space-y-1">${(r.villain.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>`)
      + `<button id="rg-next" class="btn btn-primary btn-lg btn-block">Next spot ${icon('next', 'w-5 h-5')}</button>`
      : `<button id="rg-check" class="btn btn-primary btn-lg btn-block" ${all ? '' : 'disabled'}>Check my range</button>`}
  </div>`;
  container.querySelectorAll('[data-cls]').forEach(bt => bt.addEventListener('click', () => { cur.picks[bt.dataset.cls] = Number(bt.dataset.a); draw(container); }));
  container.querySelector('#rg-check')?.addEventListener('click', () => {
    cur.checked = true;
    const st = loadRaw(KEYS.drills, {});
    const s = st.range || { n: 0, right: 0, best: 0 };
    s.n++;
    draw(container);
    let sc = 0, w = 0;
    for (const c of cur.rows) { w += c.exploit.weight; if ((c.exploit.pure[cur.picks[c.class]] ?? 0) >= 0.5 || cur.picks[c.class] === best(c.exploit.pure)) sc += c.exploit.weight; }
    if (sc / w >= 0.8) s.right++;
    st.range = s;
    save(KEYS.drills, st);
  });
  container.querySelector('#rg-next')?.addEventListener('click', async () => { await nextSpot(); draw(container); });
  container.querySelector('#f-street').addEventListener('change', async (e) => { filter.street = e.target.value; await nextSpot(); draw(container); });
  container.querySelector('#f-dec').addEventListener('change', async (e) => { filter.decision = e.target.value; await nextSpot(); draw(container); });
}
