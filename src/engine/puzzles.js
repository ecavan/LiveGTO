/**
 * Puzzle engine: pick a puzzle, grade an answer, update ratings, explain the answer.
 * Pure functions (no DOM) so they can be unit-tested. Data comes from the solver library
 * (public/library/*.json, built by `solver/ ps library`).
 *
 * Grading is by EV, never by frequency:
 *   - "best"    the one-action answer (highest EV vs this villain)
 *   - "fine"    within 1% of the pot of the best (the solver is indifferent)
 *   - "mistake" anything else; the cost is shown in bb and % of the pot
 */
import { requiredEquity, alpha, mdf, pct } from './potmath.js';
import { flopTexture } from './texture.js';
import { getLevel } from './level.js';

export const PROFILES = {
  gto: 'GTO',
  station: 'Station',
  nit: 'Nit',
  maniac: 'Maniac',
  whale: 'Whale',
};

const CLASS_LABELS = {
  monster: 'monsters', strong: 'strong hands', medium: 'medium hands',
  weak: 'weak pairs', draw: 'draws', air: 'air',
};

// ---------------------------------------------------------------- selection

const FACING = new Set(['oop_vs_bet', 'ip_vs_bet']);

/**
 * Flatten the index into puzzle candidates matching the filters.
 * filters: {
 *   level?: 1 → only the GTO villain (baseline) · 2 → only the exploitable ones (profile narrows it)
 *   profile?: ''  → every exploitative villain (the default: this isn't a GTO trainer)
 *             'all' → including GTO,  or one profile id ('gto', 'station', …)
 *   street?: 'turn' | 'river'
 *   decision?: 'facing' (you face a bet) | 'betting' (checked to you / first to act)
 *   family?: family id, e.g. '3bp_bb_btn'
 *   suits?, connect?, paired?, height?: flop texture classes (see texture.js); paired accepts
 *     'paired' (paired or trips) or 'unpaired'
 * }
 */
export function candidates(index, filters = {}) {
  const out = [];
  for (const r of index.records) {
    // Level 1 (baseline): the spots against GTO. Level 2 (exploit): against the villain types.
    const prof = filters.level === 1 ? 'gto' : filters.level === 2 && (!filters.profile || filters.profile === 'gto' || filters.profile === 'all') ? '' : filters.profile || '';
    if (prof === '' && r.profile === 'gto') continue;
    if (prof !== '' && prof !== 'all' && r.profile !== prof) continue;
    if (filters.street && r.street !== filters.street) continue;
    if (filters.decision === 'facing' && !FACING.has(r.decision)) continue;
    if (filters.decision === 'betting' && FACING.has(r.decision)) continue;
    if (filters.family && r.family !== filters.family) continue;
    if (!textureMatches(r, filters)) continue;
    (r.ratings || []).forEach((rating, i) => out.push({ id: r.id, file: r.file, i, rating }));
  }
  return out;
}

/**
 * Pick a puzzle near the player's rating (like chess puzzles), avoiding recent ones.
 * Widens the window until something is found.
 */
export function pickPuzzle(cands, rating, seen = new Set(), rand = Math.random) {
  if (!cands.length) return null;
  for (const window of [150, 300, 500, 5000]) {
    const pool = cands.filter(c => Math.abs(c.rating - rating) <= window && !seen.has(key(c)));
    if (pool.length) return pool[Math.floor(rand() * pool.length)];
  }
  return cands[Math.floor(rand() * cands.length)];
}

export const key = (c) => `${c.id}#${c.i}`;

/** Flop texture of an index record (cached on the record). */
export function recordTexture(r) {
  if (!r._tex) r._tex = flopTexture(r.board);
  return r._tex;
}

export function textureMatches(r, f) {
  if (!f.suits && !f.connect && !f.paired && !f.height) return true;
  const t = recordTexture(r);
  if (f.suits && t.suits !== f.suits) return false;
  if (f.connect && t.connect !== f.connect) return false;
  if (f.height && t.height !== f.height) return false;
  if (f.paired === 'unpaired' && t.paired !== 'unpaired') return false;
  if (f.paired === 'paired' && t.paired === 'unpaired') return false;
  return true;
}

/** Spot families present in the library: [{ id, name }]. */
export function families(index) {
  const seen = new Map();
  for (const r of index.records) if (r.family && !seen.has(r.family)) seen.set(r.family, r.family_name || r.family);
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ---------------------------------------------------------------- grading

export function grade(puzzle, record, choice) {
  const loss = -puzzle.ev[choice]; // ev is relative to the best action (best = 0)
  const verdict = choice === puzzle.answer ? 'best' : puzzle.fine.includes(choice) ? 'fine' : 'mistake';
  return {
    verdict,
    correct: verdict !== 'mistake',
    loss_bb: Math.max(0, loss),
    loss_pct: Math.max(0, loss) / record.pot,
  };
}

// ---------------------------------------------------------------- rating (Elo, as chess puzzles)

export function expectedScore(user, puzzle) {
  return 1 / (1 + Math.pow(10, (puzzle - user) / 400));
}

/** K = 40 for the first 20 puzzles, then 24. Returns the new rating (rounded). */
export function updateRating(user, puzzle, correct, played = 100) {
  const k = played < 20 ? 40 : 24;
  return Math.round(user + k * ((correct ? 1 : 0) - expectedScore(user, puzzle)));
}

// ---------------------------------------------------------------- explanation

const VALUE = new Set(['monster', 'strong']);
const BLUFFY = new Set(['air', 'draw']);

function shares(record) {
  const s = { value: [0, 0], bluffy: [0, 0] };
  for (const [cls, g, p] of record.villain_range) {
    if (VALUE.has(cls)) { s.value[0] += g; s.value[1] += p; }
    if (BLUFFY.has(cls)) { s.bluffy[0] += g; s.bluffy[1] += p; }
  }
  return s;
}

/** Plain-English points explaining the answer. Each: { title, body }. */
export function explain(record, puzzle) {
  const pts = [];
  const a = record.actions_short;
  const best = a[puzzle.answer];
  const gto = a[puzzle.gto_answer];
  const isGto = record.villain.profile === 'gto';
  const facing = record.to_call > 0;
  const vname = record.villain.name;

  // 1. The price
  if (facing) {
    const need = requiredEquity(record.pot, record.to_call);
    const potBefore = record.pot - record.to_call;
    pts.push({
      title: 'The price',
      body: `Calling ${record.to_call}bb into ${record.pot}bb needs ${pct(need)} equity. `
        + `${puzzle.hand} has ${pct(puzzle.eq)} against his range here`
        + (record.street === 'river' ? '.' : ' (before it has to realise that equity on later streets).')
        + ` To stop any-two-cards bluffing you'd defend ${pct(mdf(potBefore, record.to_call))} of the hands that beat a bluff (MDF) — a guide, not a rule, against real players.`,
    });
  } else if (best.startsWith('bet') || best === 'all-in') {
    const m = best.match(/(\d+)%/);
    if (m && BLUFFY.has(puzzle.class)) {
      const s = Number(m[1]) / 100;
      pts.push({
        title: 'The price of a bluff',
        body: `A ${m[1]}% pot bluff needs him to fold ${pct(alpha(1, s))} of the time to break even (α).`,
      });
    }
  }

  // 2. What his range looks like
  const sh = shares(record);
  if (isGto) {
    pts.push({
      title: 'His range',
      body: `Value (monsters + strong) ${pct(sh.value[0])}, draws + air ${pct(sh.bluffy[0])}.`,
    });
  } else {
    pts.push({
      title: `His range: solver vs ${vname}`,
      body: `Value ${pct(sh.value[0])} → ${pct(sh.value[1])}; draws + air ${pct(sh.bluffy[0])} → ${pct(sh.bluffy[1])}.`,
    });
  }

  // 3. Solver vs this villain
  if (!isGto) {
    if (puzzle.fine.includes(puzzle.gto_answer)) {
      pts.push({ title: 'Same as GTO', body: `A solver plays this hand the same way. ${vname}'s leaks don't change this one.` });
    } else {
      const lossIfGto = -puzzle.ev[puzzle.gto_answer];
      pts.push({
        title: `The exploit`,
        body: `A solver would ${gto} here. Against ${vname} that costs ${lossIfGto.toFixed(2)}bb: ${best} is better.`,
      });
    }
    if (record.villain.notes?.length) {
      pts.push({ title: `How ${vname} plays`, body: record.villain.notes.join(' · ') });
    }
  }

  // 4. Your range, not just your hand
  const row = record.classes.find(c => c.class === puzzle.class);
  if (row) {
    const plan = isGto ? row.gto : row.exploit;
    const parts = plan.pure
      .map((w, i) => [w, a[i]])
      .filter(([w]) => w >= 0.05)
      .sort((x, y) => y[0] - x[0])
      .map(([w, lab]) => `${lab} ${pct(w)}`);
    if (parts.length) {
      pts.push({
        title: `Your ${CLASS_LABELS[puzzle.class]} here`,
        body: `One action each: ${parts.join(', ')} of the combos.`,
      });
    }
  }
  return pts;
}

// ---------------------------------------------------------------- 13×13 grid helpers

const RANKS = 'AKQJT98765432';

export function cellLabel(i) {
  const r = Math.floor(i / 13), c = i % 13;
  if (r === c) return RANKS[r] + RANKS[c];
  return r < c ? RANKS[r] + RANKS[c] + 's' : RANKS[c] + RANKS[r] + 'o';
}

/** Cell index of two cards ("AhKd"). Suited above the diagonal, offsuit below. */
export function cellOf(cards) {
  const r1 = RANKS.indexOf(cards[0]), r2 = RANKS.indexOf(cards[2]);
  const hi = Math.min(r1, r2), lo = Math.max(r1, r2);
  if (r1 === r2) return r1 * 13 + r1;
  return cards[1] === cards[3] ? hi * 13 + lo : lo * 13 + hi;
}

// ---------------------------------------------------------------- persistence (per viewer)

const STORE = 'livegto.puzzles.v1';

/**
 * Puzzle stats. Each level has its own rating: `rating`, `played` and `solved` are the current
 * level's (stats.level), kept per level in `levels`. Ratings from before levels existed were
 * earned against the exploitable villains, so they become Level 2's.
 */
export function loadStats(level = getLevel()) {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch { /* storage unavailable */ }
  if (!s || typeof s.rating !== 'number') s = { rating: 1000, played: 0, solved: 0, seen: [], history: [], levels: {} };
  if (!s.levels) s.levels = s.played ? { 2: { rating: s.rating, played: s.played, solved: s.solved } } : {};
  return Object.assign(s, s.levels[level] || { rating: 1000, played: 0, solved: 0 }, { level });
}

export function saveStats(stats) {
  if (stats.level) stats.levels = { ...stats.levels, [stats.level]: { rating: stats.rating, played: stats.played, solved: stats.solved } };
  try {
    localStorage.setItem(STORE, JSON.stringify(stats));
  } catch { /* storage unavailable: keep in memory only */ }
}

// ---------------------------------------------------------------- review queue (spaced repetition)

const DAY = 86400000;
export const INTERVALS = [1, 3, 7]; // days until the next try after a miss, then after each solve

/**
 * A puzzle you missed comes back tomorrow, then after 3 and 7 more days if you solve it each time.
 * Miss it again and it starts over. Items: { k, file, id, i, due, step, misses }.
 */
export function queueMiss(stats, cand, now = Date.now()) {
  const q = (stats.queue ||= []);
  const k = key(cand);
  const it = q.find(x => x.k === k);
  if (it) { it.step = 0; it.due = now + INTERVALS[0] * DAY; it.misses = (it.misses || 0) + 1; }
  else q.push({ k, file: cand.file, id: cand.id, i: cand.i, rating: cand.rating, due: now + INTERVALS[0] * DAY, step: 0, misses: 1 });
  stats.queue = q.slice(-200);
  return stats;
}

/** A review attempt: solved → next interval (or done after the last); missed → start over. */
export function queueResult(stats, k, correct, now = Date.now()) {
  const q = stats.queue || [];
  const it = q.find(x => x.k === k);
  if (!it) return stats;
  if (!correct) { it.step = 0; it.due = now + INTERVALS[0] * DAY; it.misses = (it.misses || 0) + 1; return stats; }
  it.step += 1;
  if (it.step >= INTERVALS.length) stats.queue = q.filter(x => x !== it);
  else it.due = now + INTERVALS[it.step] * DAY;
  return stats;
}

export const dueItems = (stats, now = Date.now()) => (stats.queue || []).filter(x => x.due <= now).sort((a, b) => a.due - b.due);

// ---------------------------------------------------------------- daily puzzle

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Seeded generator for a date (same puzzle, same suits, for everyone on that day). */
export function dayRand(date) {
  let a = hashStr(`livegto:${date}`);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The daily puzzle at a level (vs GTO at Level 1, a villain type at 2), middling difficulty, fixed by the date. */
export function dailyPick(index, date = today(), level = getLevel()) {
  const all = candidates(index, { level });
  const pool = all.filter(c => c.rating >= 1150 && c.rating <= 1750);
  const list = (pool.length ? pool : all).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  if (!list.length) return null;
  return list[hashStr(date) % list.length];
}

/**
 * Your answer to the daily at a level: stats.daily[date].byLevel[level] = { choice, v }. Days saved
 * before levels existed ({ choice, v }) were Level 2 dailies.
 */
export function dailyAt(stats, date, level = getLevel()) {
  const e = stats.daily?.[date];
  if (!e) return null;
  return e.byLevel?.[level] ?? (level === 2 && e.choice != null ? { choice: e.choice, v: e.v } : null);
}
export function setDaily(stats, date, level, ans) {
  const e = stats.daily?.[date] || {};
  const byLevel = { ...(e.byLevel || (e.choice != null ? { 2: { choice: e.choice, v: e.v } } : {})), [level]: ans };
  stats.daily = { ...(stats.daily || {}), [date]: { byLevel } };
}

/** Consecutive days (ending today, or yesterday if today isn't done yet) with a daily played (either level). */
export function dailyStreak(stats, now = new Date()) {
  const done = stats.daily || {};
  let n = 0;
  const d = new Date(now);
  if (!done[today(d)]) d.setDate(d.getDate() - 1);
  while (done[today(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---------------------------------------------------------------- leak drills

const actType = (a) => (a.startsWith('bet') ? 'bet' : a.startsWith('raise') ? 'raise' : a === 'all-in' ? 'allin' : a);
const aggressive = (t) => t === 'bet' || t === 'raise' || t === 'allin';

/**
 * Drills for the leaks in the hand-history report (history.js LEAKS): which library spots train
 * each, and what a "target" spot looks like (one where the right play is the one the leak gets
 * wrong). A drill mixes target spots with others from the same decision, and its blurb doesn't say
 * which way most of them go, so the answer isn't given away. Preflop leaks are trained in the preflop trainer instead.
 */
export const LEAK_DRILLS = {
  overfold: { decision: 'facing', want: 'You face a bet. Compare the price with his range before you let it go.', target: (p, r) => actType(r.actions_short[p.answer]) !== 'fold' },
  overcall: { decision: 'facing', want: 'You face a bet. Ask what he bets here with, not what you hope he has.', target: (p, r) => actType(r.actions_short[p.answer]) === 'fold' },
  'missed-raise': { decision: 'facing', want: 'You face a bet with a hand that might be worth more than a call.', target: (p, r) => ['raise', 'allin'].includes(actType(r.actions_short[p.answer])) },
  overraise: { decision: 'facing', want: 'You face a bet with a hand you might raise. Raise only if worse hands call or better ones fold.', target: (p, r) => actType(r.actions_short[p.answer]) === 'call' },
  'missed-value': { decision: 'betting', want: 'Checked to you with a decent hand. Bet if worse hands call.', target: (p, r) => aggressive(actType(r.actions_short[p.answer])) && p.eq >= 0.5 },
  'missed-bluff': { decision: 'betting', want: 'Checked to you with a weak hand. Bet if he folds enough.', target: (p, r) => aggressive(actType(r.actions_short[p.answer])) && p.eq < 0.5 },
  'thin-value': { decision: 'betting', want: 'Checked to you with a medium hand. Bet only if worse hands call.', target: (p, r) => actType(r.actions_short[p.answer]) === 'check' && p.eq >= 0.5 },
  'bad-bluff': { decision: 'betting', want: 'Checked to you with a weak hand. Bluff only if he folds enough.', target: (p, r) => actType(r.actions_short[p.answer]) === 'check' && p.eq < 0.5 },
  sizing: { decision: '', want: 'Spots where the size of your bet or raise matters.', target: (p, r) => aggressive(actType(r.actions_short[p.answer])) && r.actions_short.some((a, i) => i !== p.answer && aggressive(actType(a)) && !p.fine.includes(i)) },
};
export const TARGET_SHARE = 0.65;

/**
 * The next drill puzzle for a leak: candidates near your rating from the spots the drill uses,
 * loaded until one is a target (about 65% of the time) or a non-target. loadRecord(cand) → record.
 */
export async function pickDrill(index, leak, { level, rating, seen = new Set(), loadRecord, rand = Math.random }) {
  const d = LEAK_DRILLS[leak];
  if (!d) return null;
  const cands = candidates(index, { level, decision: d.decision || undefined });
  if (!cands.length) return null;
  const wantTarget = rand() < TARGET_SHARE;
  const tried = new Set(seen);
  let fallback = null;
  for (let t = 0; t < 40; t++) {
    const c = pickPuzzle(cands, rating, tried, rand);
    if (!c) break;
    tried.add(key(c));
    const r = await loadRecord(c);
    const p = r?.puzzles?.[c.i];
    if (!p) continue;
    const isT = d.target(p, r);
    if (isT === wantTarget) return c;
    // the record is loaded anyway: look for a match among its other hands
    const j = r.puzzles.findIndex((q, i) => i !== c.i && !tried.has(key({ ...c, i })) && d.target(q, r) === wantTarget && Math.abs(q.rating - rating) < 500);
    if (j >= 0) return { ...c, i: j, rating: r.puzzles[j].rating };
    fallback ||= c;
  }
  return fallback;
}
