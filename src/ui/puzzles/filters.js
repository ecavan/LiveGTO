/**
 * Rated-puzzle filters, shared by the library puzzles and the generated flop / multiway spots.
 * Street and players pick the source; the rest (villain type, pot type, texture) are library-only.
 */
import { PROFILES, families } from '../../engine/puzzles.js';
import { disc } from '../kit.js';

export const filters = { street: '', players: '', profile: '', decision: '', family: '', suits: '', connect: '', paired: '', height: '' };
export const LIBRARY_ONLY = ['profile', 'family', 'suits', 'connect', 'paired', 'height'];
export const libraryOnly = () => LIBRARY_ONLY.some(k => filters[k]);

export function filterPanel(index) {
  const opt = (v, label, sel) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${label}</option>`;
  const active = Object.values(filters).filter(Boolean).length;
  return disc(`Filters${active ? ` <span class="pill ml-2">${active} on</span>` : ''}`, `<div class="grid sm:grid-cols-2 gap-2">
    <select data-f="street">${opt('', 'Every street', filters.street)}${opt('flop', 'Flop', filters.street)}${opt('turn', 'Turn', filters.street)}${opt('river', 'River', filters.street)}</select>
    <select data-f="players">${opt('', 'Heads-up and multiway', filters.players)}${opt('hu', 'Heads-up', filters.players)}${opt('multiway', 'Multiway (3+ players)', filters.players)}</select>
    <select data-f="decision">${opt('', 'All spots', filters.decision)}${opt('facing', 'Facing a bet', filters.decision)}${opt('betting', 'Bet or check', filters.decision)}</select>
    <select data-f="profile">${opt('', 'All villain types', filters.profile)}
      ${Object.entries(PROFILES).filter(([k]) => k !== 'gto').map(([k, v]) => opt(k, `vs ${v}`, filters.profile)).join('')}
      ${opt('gto', 'vs GTO (baseline)', filters.profile)}${opt('all', 'Everything', filters.profile)}</select>
    ${index ? `<select data-f="family">${opt('', 'All pot types', filters.family)}${families(index).map(f => opt(f.id, f.name, filters.family)).join('')}</select>` : ''}
    <select data-f="suits">${opt('', 'Flop: any suits', filters.suits)}${opt('rainbow', 'Rainbow', filters.suits)}${opt('two-tone', 'Two-tone', filters.suits)}${opt('monotone', 'Monotone', filters.suits)}</select>
    <select data-f="connect">${opt('', 'Any connectedness', filters.connect)}${opt('connected', 'Connected', filters.connect)}${opt('semi', 'Semi-connected', filters.connect)}${opt('dry', 'Dry', filters.connect)}</select>
    <select data-f="paired">${opt('', 'Paired or not', filters.paired)}${opt('unpaired', 'Unpaired', filters.paired)}${opt('paired', 'Paired', filters.paired)}</select>
    <select data-f="height">${opt('', 'Any high card', filters.height)}${opt('ace', 'A-high', filters.height)}${opt('big', 'K/Q-high', filters.height)}${opt('mid', 'J–8-high', filters.height)}${opt('low', '7-high or lower', filters.height)}</select>
  </div>
  <p class="text-xs text-ink-400 mt-2">Flop and multiway spots come from the Play engine; villain type, pot type and texture filters apply to the solver library (turn and river).</p>`);
}

export function wireFilters(container, onChange) {
  container.querySelectorAll('select[data-f]').forEach(sel => sel.addEventListener('change', () => { filters[sel.dataset.f] = sel.value; onChange(); }));
}
