/**
 * Playbook: turn thousands of solved spots into rules you can remember.
 * For a filter (villain type, pot type, spot type, street, flop texture) it averages what each hand
 * class does, weighted by how much of your range that class is in each spot.
 */

export const CATEGORIES = ['fold', 'check', 'call', 'bet small', 'bet big', 'raise', 'all-in'];

/** "bet 33%" → "bet small" (< 50% pot), "bet 75%" → "bet big". */
export function actionCategory(label) {
  const m = label.match(/^bet (\d+)%/);
  if (m) return Number(m[1]) < 50 ? 'bet small' : 'bet big';
  return label; // fold, check, call, raise, all-in
}

export const CLASS_ORDER = ['monster', 'strong', 'medium', 'weak', 'draw', 'air'];

function matches(e, f) {
  const prof = f.profile || '';
  if (prof === '' ? e.v === 'gto' : prof !== 'all' && e.v !== prof) return false;
  if (f.family && e.f !== f.family) return false;
  if (f.street && e.s !== f.street) return false;
  if (f.decision && e.d !== f.decision) return false;
  const [suits, connect, paired, height] = e.t;
  if (f.suits && suits !== f.suits) return false;
  if (f.connect && connect !== f.connect) return false;
  if (f.height && height !== f.height) return false;
  if (f.paired === 'unpaired' && paired !== 'unpaired') return false;
  if (f.paired === 'paired' && paired === 'unpaired') return false;
  return true;
}

/**
 * Aggregate → { n, rows: [{ class, share, exploit: {cat: p}, gto: {cat: p} }] }
 * `share` is the class's average share of your range in these spots.
 */
export function aggregate(playbook, filters) {
  const acc = {};
  let n = 0;
  for (const e of playbook.entries) {
    if (!matches(e, filters)) continue;
    n++;
    for (const [cls, [we, ce, wg, cg]] of Object.entries(e.c)) {
      const a = (acc[cls] ||= { we: 0, wg: 0, e: {}, g: {} });
      a.we += we;
      a.wg += wg;
      for (const [k, p] of Object.entries(ce)) a.e[k] = (a.e[k] || 0) + we * p;
      for (const [k, p] of Object.entries(cg)) a.g[k] = (a.g[k] || 0) + wg * p;
    }
  }
  const norm = (m, w) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, w > 0 ? v / w : 0]));
  const rows = CLASS_ORDER.filter(c => acc[c] && (acc[c].we > 0 || acc[c].wg > 0)).map(c => ({
    class: c,
    share: n ? acc[c].we / n : 0,
    exploit: norm(acc[c].e, acc[c].we),
    gto: norm(acc[c].g, acc[c].wg),
  }));
  return { n, rows };
}

/** Most common actions, e.g. [["bet big", 0.71], ["check", 0.22]] (≥ 10% only). */
export function top(dist, min = 0.1) {
  return Object.entries(dist).filter(([, p]) => p >= min).sort((a, b) => b[1] - a[1]);
}

/** One-line rule for a class: "bet big (71%)" or "bet big 55% · check 40%". */
export function rule(dist) {
  const t = top(dist);
  if (!t.length) return '—';
  if (t[0][1] >= 0.8) return `${t[0][0]}`;
  return t.slice(0, 2).map(([k, p]) => `${k} ${Math.round(100 * p)}%`).join(' · ');
}
