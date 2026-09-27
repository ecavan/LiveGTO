/**
 * Settings: offline download, data reset, about.
 */
import { icon } from './kit.js';

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

export async function render(container) {
  container.innerHTML = `<div class="page max-w-2xl space-y-5 fade-up">
    <div><div class="h-sec">Settings</div><h1 class="h-title">LiveGTO</h1></div>
    <div class="panel panel-pad space-y-3">
      <div class="flex items-center gap-3">${icon('download', 'w-6 h-6 text-emerald-300')}<div class="font-semibold text-white">Offline</div></div>
      <p class="text-sm text-ink-300">Add LiveGTO to your home screen (Share → Add to Home Screen), then download the puzzle library once. After that everything works with no connection: Learn, Puzzles and Play.</p>
      <div id="off-status" class="text-sm text-ink-300">Checking…</div>
      <div class="h-2 rounded-full bg-ink-700 overflow-hidden"><div id="off-bar" class="h-full bg-emerald-400" style="width:0%"></div></div>
      <button id="off-go" class="btn btn-primary">${icon('download', 'w-4 h-4')} Download puzzle library (~36 MB)</button>
    </div>
    <div class="panel panel-pad space-y-3">
      <div class="font-semibold text-white">Your data</div>
      <p class="text-sm text-ink-300">Ratings, lesson progress and sessions are stored on this device only.</p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn" data-reset="livegto.puzzles.v1">Reset puzzle rating</button>
        <button class="btn" data-reset="livegto.play.v2">Reset Play sessions</button>
        <button class="btn" data-reset="livegto.learn.v1">Reset lesson progress</button>
      </div>
    </div>
  </div>`;
  const status = container.querySelector('#off-status');
  const bar = container.querySelector('#off-bar');
  const show = (st) => {
    if (!st) { status.textContent = 'Could not read the library (are you offline?).'; return; }
    status.textContent = st.have >= st.files.length ? `Downloaded: all ${st.files.length} files are available offline.` : `${st.have} of ${st.files.length} files available offline.`;
    bar.style.width = `${(100 * st.have) / st.files.length}%`;
  };
  show(await offlineStatus());
  container.querySelector('#off-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const st = await offlineStatus();
    if (!st || !('caches' in window)) { btn.disabled = false; return; }
    const c = await caches.open(LIB_CACHE);
    let have = 0;
    for (const f of st.files) {
      const url = `/library/${f}`;
      if (!(await c.match(url))) {
        try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) await c.put(url, r.clone()); } catch { /* keep going */ }
      }
      have++;
      status.textContent = `Downloading… ${have} / ${st.files.length}`;
      bar.style.width = `${(100 * have) / st.files.length}%`;
    }
    show(await offlineStatus());
    btn.disabled = false;
  });
  container.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => {
    if (!window.confirm('Reset this data on this device?')) return;
    try { localStorage.removeItem(b.dataset.reset); } catch { /* ignore */ }
    window.dispatchEvent(new Event('livegto:ratings'));
    b.textContent = 'Done';
  }));
}
