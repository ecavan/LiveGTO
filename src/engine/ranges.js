/**
 * Preflop charts for live $1/$2–$2/$5 (9-handed, 100bb), from Ed Miller, *The Course*,
 * pp. 43–75 (see docs/theory-audit.md §4). Raise or fold when first in: no open-limping.
 *
 * Position mapping from 9-handed to the drill's six seats: UTG/MP = early position (~14%),
 * CO = cutoff (~22%), BTN = button (~33%), SB = steal vs the BB only (raise or fold).
 *
 * Facing an open (The Course pp. 60–73):
 *  - vs an early-position ("strong") raise: 3-bet AA–KK + A5s; call QQ–22, ATs+, KTs+, QTs+,
 *    JTs–76s, AKo.
 *  - vs a late-position ("loose") raise: 3-bet AA–QQ, AKs, A5s–A2s, T9s, 87s, AKo; call JJ–22,
 *    AQs–A6s, KTs+, QTs+, JTs, 98s, 76s, AQo.
 *  - Small blind: 3-bet or fold (out of position, and the BB still to act).
 *  - Big blind vs a steal: 3-bet ~16%, defend ~36% in total.
 */

export const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];

const R = 'AKQJT98765432';
const ri = (c) => R.indexOf(c);

/** Expands range notation: "22+", "A2s+", "KTs+", "JTs-76s", "T8s-53s", "AQo", "QQ-22". */
export function expand(str) {
  const out = new Set();
  const key = (a, b, suf) => (a === b ? R[a] + R[b] : R[Math.min(a, b)] + R[Math.max(a, b)] + suf);
  for (const tok of str.split(',').map(t => t.trim()).filter(Boolean)) {
    if (tok.includes('-')) {
      const [x, y] = tok.split('-');
      const [a1, b1, a2, b2] = [ri(x[0]), ri(x[1]), ri(y[0]), ri(y[1])];
      const suf = x[2] || '';
      if (a1 === b1) { // pairs QQ-22
        for (let r = a1; r <= a2; r++) out.add(key(r, r));
      } else if (a1 === a2) { // same top card: AQs-A6s
        for (let k = b1; k <= b2; k++) out.add(key(a1, k, suf));
      } else { // step both: JTs-76s, T8s-53s
        for (let d = 0; a1 + d <= a2; d++) out.add(key(a1 + d, b1 + d, suf));
      }
    } else if (tok.endsWith('+')) {
      const t = tok.slice(0, -1);
      const [a, b, suf] = [ri(t[0]), ri(t[1]), t[2] || ''];
      if (a === b) for (let r = a; r >= 0; r--) out.add(key(r, r));
      else for (let k = b; k > a; k--) out.add(key(a, k, suf));
    } else {
      const [a, b, suf] = [ri(tok[0]), ri(tok[1]), tok[2] || ''];
      out.add(key(a, b, suf));
    }
  }
  return out;
}

const EARLY = '22+, A2s+, KTs+, QTs+, JTs-76s, AQo+';
const CO = '22+, A2s+, K7s+, Q9s+, JTs-43s, J9s-53s, ATo+, KJo+';
const BUTTON = '22+, A2s+, K2s+, Q5s+, J7s+, T9s-43s, T8s-53s, T7s-96s, A7o+, K9o+, QTo+, JTo';
const SB_STEAL = '22+, A2s+, K6s+, Q8s+, J8s+, T9s-54s, T8s-64s, A8o+, KTo+, QJo';

export const RFI_RANGES = {
  UTG: expand(EARLY),
  MP: expand(EARLY + ', KQo, AJo, 65s'),
  CO: expand(CO),
  BTN: expand(BUTTON),
  SB: expand(SB_STEAL),
};

const VS_STRONG = { raise: 'KK+, A5s', call: 'QQ-22, ATs+, KTs+, QTs+, JTs-76s, AKo' };
const VS_LOOSE = { raise: 'QQ+, AKs, A5s-A2s, T9s, 87s, AKo', call: 'JJ-22, AQs-A6s, KTs+, QTs+, JTs, 98s, 76s, AQo' };
const SB_3BET_STRONG = { raise: 'QQ+, AKs, AKo, A5s', call: '' };
const SB_3BET_LOOSE = { raise: 'TT+, AJs+, KQs, A5s-A2s, AQo+, T9s, 87s', call: '' };
const BB_VS_STEAL = {
  raise: '99+, A2s+, KJs+, K7s-K5s, Q9s, 98s-54s, J9s-86s, AJo+, KQo',
  call: '88-22, KTs-K8s, K4s-K2s, QTs+, Q8s-Q6s, JTs, T9s, J8s, T7s, 97s, 96s, 85s, 75s, 64s, 53s, 43s, ATo-A7o, KJo-K9o, QTo+, JTo, T9o',
};
const BB_VS_EARLY = { raise: 'KK+, A5s', call: 'QQ-22, A6s+, A4s-A2s, KTs+, QTs+, JTs-54s, J9s-75s, AJo+, KQo' };

const mk = ({ raise, call }) => {
  const r = expand(raise);
  const c = expand(call);
  for (const k of r) c.delete(k);
  return { raise: r, call: c };
};

// key: 'hero|opener'
export const FACING_OPEN = {
  'BTN|UTG': mk(VS_STRONG),
  'BTN|MP': mk(VS_STRONG),
  'BTN|CO': mk(VS_LOOSE),
  'CO|UTG': mk(VS_STRONG),
  'CO|MP': mk(VS_STRONG),
  'SB|UTG': mk(SB_3BET_STRONG),
  'SB|MP': mk(SB_3BET_STRONG),
  'SB|CO': mk(SB_3BET_LOOSE),
  'SB|BTN': mk(SB_3BET_LOOSE),
  'BB|UTG': mk(BB_VS_EARLY),
  'BB|MP': mk(BB_VS_EARLY),
  'BB|CO': mk(BB_VS_STEAL),
  'BB|BTN': mk(BB_VS_STEAL),
  'BB|SB': mk(BB_VS_STEAL),
};

// List of FACING_OPEN matchups as [hero, opener] pairs
export const FACING_OPEN_KEYS = Object.keys(FACING_OPEN).map(k => k.split('|'));

const RANKS_DISPLAY = R.split('');

/** Return 13x13 list-of-lists of canonical hand keys */
export function buildGrid() {
  const grid = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      const r1 = RANKS_DISPLAY[i];
      const r2 = RANKS_DISPLAY[j];
      if (i === j) row.push(`${r1}${r2}`);
      else if (i < j) row.push(`${r1}${r2}s`);
      else row.push(`${r2}${r1}o`);
    }
    grid.push(row);
  }
  return grid;
}

/** Share of all 1326 combos in a set of hand keys. */
export function comboShare(set) {
  let n = 0;
  for (const k of set) n += k.length === 2 ? 6 : k.endsWith('s') ? 4 : 12;
  return n / 1326;
}
