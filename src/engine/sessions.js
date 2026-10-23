/**
 * Live session tracker: the sessions you play at the casino, for your results over time.
 *
 * session = { id, date: 'YYYY-MM-DD', casino, stakes: '1/2', bb, buyin, cashout, hours, notes }
 *   buyin is everything you put on the table (re-buys and add-ons included), cashout what you
 *   left with; money in dollars. bb is the big blind of the stakes ('2/5' → 5).
 * A session can also be running: { running: true, start: ms, ... } until you cash out; its hours
 * then come from the clock.
 */
import { loadRaw, save } from '../store.js';

export const KEY = 'livegto.sessions.v1';
const r2 = (x) => Math.round(x * 100) / 100;

export const loadSessions = () => loadRaw(KEY, { sessions: [] }).sessions || [];
export const saveSessions = (sessions) => save(KEY, { sessions });

/** The big blind of a stakes string: '1/2' → 2, '2/5' → 5, '1/2/5' → 5, '$5/$10' → 10. */
export function bbOf(stakes) {
  const nums = String(stakes || '').match(/\d+(\.\d+)?/g);
  return nums ? Number(nums[nums.length - 1]) : null;
}

const id = () => `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A clean session from form values (strings or numbers). Returns { session } or { error }. */
export function makeSession(v, prev = null) {
  const num = (x) => (x === '' || x == null ? NaN : Number(String(x).replace(/[$,\s]/g, '')));
  const buyin = num(v.buyin), cashout = num(v.cashout), hours = num(v.hours);
  const stakes = String(v.stakes || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) return { error: 'Pick a date.' };
  if (v.date > today()) return { error: 'That date is in the future.' };
  if (!stakes || !bbOf(stakes)) return { error: 'Enter the stakes, like 1/2 or 2/5.' };
  if (!(buyin > 0)) return { error: 'Enter what you bought in for.' };
  if (!(cashout >= 0)) return { error: 'Enter what you cashed out (0 if you lost it all).' };
  if (!(hours > 0 && hours <= 48)) return { error: 'Enter the hours you played (up to 48).' };
  return {
    session: {
      id: prev?.id || id(), date: v.date, casino: String(v.casino || '').trim(), stakes, bb: bbOf(stakes),
      buyin: r2(buyin), cashout: r2(cashout), hours: r2(hours), notes: String(v.notes || '').trim(),
    },
  };
}

/** Start a session now (the running one). */
export function startSession({ casino = '', stakes, buyin }) {
  return { id: id(), running: true, start: Date.now(), date: today(), casino: String(casino).trim(), stakes: String(stakes).trim(), bb: bbOf(stakes), buyin: r2(Number(buyin) || 0), notes: '' };
}
/** End the running session at `now` with this cash-out: a normal session. */
export function endSession(run, cashout, now = Date.now()) {
  const hours = Math.max(0.05, (now - run.start) / 3600000);
  const { running, start, ...rest } = run; // eslint-disable-line no-unused-vars
  return { ...rest, cashout: r2(Number(cashout) || 0), hours: r2(hours) };
}

export const profit = (s) => r2(s.cashout - s.buyin);

/**
 * Totals over finished sessions: profit, hours, $/hour, big blinds per hour (each session in its
 * own big blinds), win rate, best and worst, and the standard deviation per hour ($), which says
 * how far the $/hour can be from your real rate after this many hours.
 */
export function totals(sessions) {
  const done = sessions.filter(s => !s.running);
  const n = done.length;
  if (!n) return null;
  const hours = done.reduce((a, s) => a + s.hours, 0);
  const net = done.reduce((a, s) => a + profit(s), 0);
  const bbNet = done.reduce((a, s) => a + profit(s) / s.bb, 0);
  const perHour = net / hours;
  // hourly standard deviation, weighting each session by its hours
  const v = done.reduce((a, s) => a + s.hours * ((profit(s) / s.hours - perHour) ** 2), 0) / hours;
  const sdHour = n > 1 ? Math.sqrt(v) : null;
  return {
    n, hours: r2(hours), net: r2(net), perHour: r2(perHour), bbPerHour: r2(bbNet / hours),
    winRate: done.filter(s => profit(s) > 0).length / n,
    best: done.reduce((a, s) => (profit(s) > profit(a) ? s : a)),
    worst: done.reduce((a, s) => (profit(s) < profit(a) ? s : a)),
    sdHour: sdHour == null ? null : r2(sdHour),
    // 95% interval for your true $/hour (normal approximation)
    ci: sdHour == null ? null : r2(1.96 * sdHour / Math.sqrt(hours)),
  };
}

/** Totals grouped by a field ('stakes' or 'casino'), biggest by hours first. */
export function groupBy(sessions, field) {
  const g = {};
  for (const s of sessions.filter(x => !x.running)) (g[s[field] || '—'] ||= []).push(s);
  return Object.entries(g).map(([k, list]) => ({ key: k, ...totals(list) })).sort((a, b) => b.hours - a.hours);
}

/** Running total of profit after each finished session, oldest first: [{ date, total }]. */
export function curve(sessions) {
  let t = 0;
  return sessions.filter(s => !s.running).sort((a, b) => a.date.localeCompare(b.date) || 0)
    .map(s => ({ date: s.date, total: r2((t += profit(s))) }));
}

/** Sessions as CSV (oldest first). */
export function toCSV(sessions) {
  const q = (x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
  const rows = [['date', 'casino', 'stakes', 'buyin', 'cashout', 'profit', 'hours', 'notes']];
  for (const s of [...sessions].filter(x => !x.running).sort((a, b) => a.date.localeCompare(b.date))) rows.push([s.date, s.casino, s.stakes, s.buyin, s.cashout, profit(s), s.hours, s.notes]);
  return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}
