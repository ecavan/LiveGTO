/**
 * Settings: appearance, offline download, data reset.
 */
import { icon } from './kit.js';
import { themePref, setTheme } from '../theme.js';

const LIB_CACHE = 'puzzle-library';

async function offlineStatus() {
  try {
    const idx = await (await fetch('/library/index.json')).json();
    const files = ['index.json', 'playbook.json', ...new Set(idx.records.map(s => s.file))];
    if (!('caches' in window)) return { files, have: 0 };
    const c = await caches.open(LIB_CACHE);
    let have = 0;
    for (const f of files) if (await c.match(`/library/${f}`)) have++;
    return { files, have };
  } catch {
    return null;
  }
}

let downloading = null; // one download at a time, even if you leave the page and come back

const RESETS = {
  puzzles: { label: 'Reset puzzle rating', what: 'your puzzle rating and history (your review queue, streak and range-builder bests stay)' },
  drills: { label: 'Reset drill stats', what: 'streaks and scores in the table-maths drills, the preflop trainer and the Buckets drill' },
  play: { label: 'Reset Play sessions', what: 'your Play rating, sessions, and what the bots remember about you' },
  learn: { label: 'Reset lesson progress', what: 'which course steps you have done' },
  hands: { label: 'Clear hand history', what: 'every stored hand (game review, leaks, your logged live hands)' },
};

function reset(kind) {
  try {
    if (kind === 'puzzles') {
      const st = JSON.parse(localStorage.getItem('livegto.puzzles.v1') || '{}');
      Object.assign(st, { rating: 1000, played: 0, solved: 0, history: [], seen: [] });
      localStorage.setItem('livegto.puzzles.v1', JSON.stringify(st));
    } else {
      localStorage.removeItem({ drills: 'livegto.drills.v1', play: 'livegto.play.v2', learn: 'livegto.learn.v1', hands: 'livegto.hands.v1' }[kind]);
    }
  } catch { /* ignore */ }
}

export async function render(container) {
  container.innerHTML = `<div class="page max-w-2xl space-y-5 fade-up">
    <div><div class="h-sec">Settings</div><h1 class="h-title">LiveGTO</h1></div>
    <div class="panel panel-pad flex items-center justify-between gap-3 flex-wrap">
      <div><div class="font-semibold text-white">Appearance</div><p class="text-sm text-ink-300">Auto follows your device's light or dark setting.</p></div>
      <div class="seg" id="theme-seg">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-theme-pick="${k}" class="${themePref() === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="panel panel-pad space-y-3">
      <div class="flex items-center gap-3">${icon('download', 'w-6 h-6 text-emerald-300')}<div class="font-semibold text-white">Offline</div></div>
      <p class="text-sm text-ink-300">Add LiveGTO to your home screen (Share → Add to Home Screen), then download the puzzle library once. After that everything works with no connection: Learn, Puzzles and Play.</p>
      <div id="off-status" class="text-sm text-ink-300">Checking…</div>
      <div class="h-2 rounded-full bg-ink-700 overflow-hidden"><div id="off-bar" class="h-full bg-emerald-400" style="width:0%"></div></div>
      <button id="off-go" class="btn btn-primary" ${downloading ? 'disabled' : ''}>${icon('download', 'w-4 h-4')} Download puzzle library (~36 MB)</button>
    </div>
    <div class="panel panel-pad space-y-3">
      <div class="font-semibold text-white">Your data</div>
      <p class="text-sm text-ink-300">Ratings, lesson progress and sessions are stored on this device only.</p>
      <div class="flex gap-2 flex-wrap">
        ${Object.entries(RESETS).map(([k, r]) => `<button class="btn" data-reset="${k}">${r.label}</button>`).join('')}
      </div>
    </div>
  </div>`;
  // live elements: a download started on an earlier visit keeps reporting to the page on screen
  const $ = (id) => document.getElementById(id);
  const show = (st) => {
    const status = $('off-status'), bar = $('off-bar');
    if (!status) return;
    if (!st) { status.textContent = 'Could not read the library (are you offline?).'; return; }
    status.textContent = st.have >= st.files.length ? `Downloaded: all ${st.files.length} files are available offline.` : `${st.have} of ${st.files.length} files available offline.`;
    bar.style.width = `${(100 * st.have) / st.files.length}%`;
  };
  container.querySelectorAll('[data-theme-pick]').forEach(b => b.addEventListener('click', () => {
    setTheme(b.dataset.themePick);
    container.querySelectorAll('[data-theme-pick]').forEach(x => x.classList.toggle('on', x === b));
  }));
  container.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => {
    const r = RESETS[b.dataset.reset];
    if (!window.confirm(`${r.label}? This clears ${r.what} on this device.`)) return;
    reset(b.dataset.reset);
    location.reload(); // every page starts clean
  }));
  container.querySelector('#off-go').addEventListener('click', () => {
    if (downloading) return;
    $('off-go').disabled = true;
    downloading = (async () => {
      const st = await offlineStatus();
      if (!st || !('caches' in window)) return;
      const c = await caches.open(LIB_CACHE);
      let have = 0;
      for (const f of st.files) {
        const url = `/library/${f}`;
        if (!(await c.match(url))) {
          try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) await c.put(url, r.clone()); } catch { /* keep going */ }
        }
        have++;
        const status = $('off-status'), bar = $('off-bar');
        if (status) { status.textContent = `Downloading… ${have} / ${st.files.length}`; bar.style.width = `${(100 * have) / st.files.length}%`; }
      }
    })().finally(async () => { downloading = null; show(await offlineStatus()); const b = $('off-go'); if (b) b.disabled = false; });
  });
  if (!downloading) show(await offlineStatus());
}
