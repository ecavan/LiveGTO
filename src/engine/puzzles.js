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
    const prof = filters.profile || '';
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

export function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && typeof s.rating === 'number') return s;
  } catch { /* storage unavailable */ }
  return { rating: 1000, played: 0, solved: 0, seen: [], history: [] };
}

export function saveStats(stats) {
  try {
    localStorage.setItem(STORE, JSON.stringify(stats));
  } catch { /* storage unavailable: keep in memory only */ }
}
