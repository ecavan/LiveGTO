/**
 * Preflop range tables — hand-curated GTO approximations for 6-max 100bb cash.
 */

export const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];

export const RFI_RANGES = {
  UTG: new Set([
    'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66',
    'AKs', 'AQs', 'AJs', 'ATs', 'A5s', 'A4s',
    'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s',
    'AKo', 'AQo',
  ]),
  MP: new Set([
    'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55',
    'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'A4s', 'A3s',
    'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s', 'T9s', '98s', '87s',
    'AKo', 'AQo', 'AJo',
  ]),
  CO: new Set([
    'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
    'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s',
    'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'J8s',
    'T9s', 'T8s', '98s', '97s', '87s', '86s',
    '76s', '75s', '65s', '64s', '54s',
    'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo',
  ]),
  BTN: new Set([
    'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
    'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s',
    'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s',
    'JTs', 'J9s', 'J8s', 'J7s', 'T9s', 'T8s', 'T7s',
    '98s', '97s', '96s', '87s', '86s', '85s',
    '76s', '75s', '65s', '64s', '54s', '53s', '43s',
    'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o',
    'KQo', 'KJo', 'KTo', 'K9o', 'QJo', 'QTo',
    'JTo', 'J9o', 'T9o', '98o',
  ]),
  SB: new Set([
    'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
    'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s',
    'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s',
    'JTs', 'J9s', 'J8s', 'J7s', 'T9s', 'T8s', 'T7s',
    '98s', '97s', '96s', '87s', '86s',
    '76s', '75s', '65s', '64s', '54s', '53s', '43s',
    'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'A6o',
    'KQo', 'KJo', 'KTo', 'K9o', 'QJo', 'QTo', 'Q9o',
    'JTo', 'J9o', 'T9o', '98o',
  ]),
};

// Facing open: key is 'hero|opener', value is {raise: Set, call: Set}
export const FACING_OPEN = {
  'BTN|UTG': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']),
    call: new Set(['JJ', 'TT', '99', '88', '77', 'AQs', 'AJs', 'ATs', 'KQs', 'QJs', 'JTs', 'T9s', '98s', 'AQo']),
  },
  'BTN|MP': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs']),
    call: new Set(['JJ', 'TT', '99', '88', '77', '66', 'AJs', 'ATs', 'A5s', 'KQs', 'KJs', 'QJs', 'JTs', 'T9s', '98s', '87s', 'AQo', 'AJo']),
  },
  'BTN|CO': {
    raise: new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AQs', 'AKo', 'A5s', 'A4s']),
    call: new Set(['TT', '99', '88', '77', '66', '55', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'J9s', 'T9s', '98s', '87s', '76s', '65s', 'AQo', 'AJo', 'KQo']),
  },
  'CO|UTG': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']),
    call: new Set(['JJ', 'TT', '99', '88', '77', 'AQs', 'AJs', 'ATs', 'KQs', 'QJs', 'JTs', 'T9s', 'AQo']),
  },
  'CO|MP': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs']),
    call: new Set(['JJ', 'TT', '99', '88', '77', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs', 'JTs', 'T9s', '98s', 'AQo', 'AJo']),
  },
  'BB|UTG': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']),
    call: new Set(['JJ', 'TT', '99', '88', '77', '66', '55', '44', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'A4s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', 'T8s', '98s', '97s', '87s', '86s', '76s', '75s', '65s', '54s', 'AQo', 'AJo', 'KQo']),
  },
  'BB|MP': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs']),
    call: new Set(['JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', 'AJs', 'ATs', 'A9s', 'A8s', 'A5s', 'A4s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'J8s', 'T9s', 'T8s', '98s', '97s', '87s', '86s', '76s', '75s', '65s', '64s', '54s', '53s', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo']),
  },
  'BB|CO': {
    raise: new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AQs', 'AKo', 'A5s', 'A4s']),
    call: new Set(['TT', '99', '88', '77', '66', '55', '44', '33', '22', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'QJs', 'QTs', 'Q9s', 'Q8s', 'JTs', 'J9s', 'J8s', 'T9s', 'T8s', 'T7s', '98s', '97s', '96s', '87s', '86s', '85s', '76s', '75s', '65s', '64s', '54s', '53s', '43s', 'AQo', 'AJo', 'ATo', 'A9o', 'KQo', 'KJo', 'KTo', 'QJo', 'QTo', 'JTo', 'T9o']),
  },
  'BB|BTN': {
    raise: new Set(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AQs', 'AJs', 'AKo', 'AQo', 'A5s', 'A4s']),
    call: new Set(['99', '88', '77', '66', '55', '44', '33', '22', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'JTs', 'J9s', 'J8s', 'J7s', 'T9s', 'T8s', 'T7s', '98s', '97s', '96s', '87s', '86s', '85s', '76s', '75s', '65s', '64s', '54s', '53s', '43s', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'KQo', 'KJo', 'KTo', 'K9o', 'QJo', 'QTo', 'Q9o', 'JTo', 'J9o', 'T9o', 'T8o', '98o', '97o', '87o', '86o', '76o']),
  },
  'SB|UTG': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']),
    call: new Set(['JJ', 'TT', '99', 'AQs', 'AJs', 'KQs', 'AQo']),
  },
  'SB|MP': {
    raise: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs']),
    call: new Set(['JJ', 'TT', '99', '88', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs', 'JTs', 'AQo', 'AJo']),
  },
  'SB|CO': {
    raise: new Set(['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AQs', 'AKo', 'A5s', 'A4s']),
    call: new Set(['TT', '99', '88', '77', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', 'AQo', 'AJo', 'KQo']),
  },
  'SB|BTN': {
    raise: new Set(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AQs', 'AJs', 'ATs', 'AKo', 'AQo', 'A5s', 'A4s']),
    call: new Set(['99', '88', '77', '66', 'A9s', 'A8s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', 'AJo', 'KQo']),
  },
  'BB|SB': {
    raise: new Set(['AA', 'KK', 'QQ', 'JJ', 'TT', '99', 'AKs', 'AQs', 'AJs', 'ATs', 'AKo', 'AQo', 'A5s', 'A4s', 'A3s']),
    call: new Set(['88', '77', '66', '55', '44', '33', '22', 'A9s', 'A8s', 'A7s', 'A6s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'JTs', 'J9s', 'J8s', 'J7s', 'T9s', 'T8s', 'T7s', '98s', '97s', '96s', '87s', '86s', '85s', '76s', '75s', '65s', '64s', '54s', '53s', '43s', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'KQo', 'KJo', 'KTo', 'K9o', 'QJo', 'QTo', 'Q9o', 'JTo', 'J9o', 'T9o', 'T8o', '98o', '97o', '87o', '76o']),
  },
};

// List of FACING_OPEN matchups as [hero, opener] pairs
export const FACING_OPEN_KEYS = Object.keys(FACING_OPEN).map(k => k.split('|'));

const RANKS_DISPLAY = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

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
