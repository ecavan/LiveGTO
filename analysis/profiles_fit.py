"""Villain profiles fitted to real players (solver/profiles/*.toml → profiles.json).

Each profile keeps its character rules (the notes the app shows: "never folds a pair", "size
tells", …) with their old strengths, then a block of calibration rules whose strengths are
fitted so that the bots' stats match real players of that type (targets.json):

  fold_flop / fold_turn / fold_river   facing a bet: fold more or less      → Fold to bet, by street
  air_fold_river                       facing a river bet with air           → share of air among his river calls
  raise                                facing a bet: raise more or less      → Raise vs c-bet (flop)
  cbet_flop / cbet_later               as last street's aggressor: bet       → C-bet flop / turn
  donk                                 into last street's aggressor: bet     → Donk flop
  probe                                checked to / no aggressor: bet        → Probe turn
  bluff_river                          river, not facing a bet, weak or air  → share of air among his called river bets

Every calibration rule is a `scale` (do it k times as often as the baseline would), so the fit
is a set of multipliers k; the update is k ← k · (target / measured)^0.7 on the rate it drives.

  python3 -I profiles_fit.py write <knobs.json> <out dir>        writes the .toml files
  python3 -I profiles_fit.py json <knobs.json> <out.json>        profiles.json for a simulation
"""
import json
import os
import sys

FISH = ['whale', 'station', 'nit', 'maniac', 'reg']

CHARACTER = {
    'whale': {
        'name': 'Whale',
        'description': 'The recreational player who is there to gamble. Calls far too much, raises his draws, bets\ninto the raiser, and sizes his bets by hand strength (big = strong, small = not).',
        'rules': [
            {'note': 'raises his draws', 'facing': 'bet', 'streets': ['flop', 'turn'], 'hands': ['draw'], 'set': {'raise': 0.7, 'call': 0.3}},
            {'note': 'otherwise just calls', 'facing': 'bet', 'hands': ['strong', 'medium', 'weak', 'air'], 'scale': {'raise': 0.3}},
            {'note': 'size tell: big bet = big hand', 'facing': 'none', 'hands': ['monster', 'strong'], 'scale': {'bet_large': 3.0, 'bet_small': 0.5}},
            {'note': 'size tell: small bet = weak or drawing', 'facing': 'none', 'hands': ['medium', 'weak', 'draw', 'air'], 'scale': {'bet_large': 0.2, 'bet_small': 1.5}},
        ],
    },
    'station': {
        'name': 'Station',
        'description': 'Loose-passive calling station. Plays too many hands and calls a lot before the flop; after it he\nfolds a little less than most and checks hands he should bet. When he bets the river he usually\nhas it. The most common profitable opponent at $1/$2.',
        'rules': [
            {'note': 'hates folding a pair to a normal bet', 'facing_size': ['small', 'large'], 'hands': ['strong', 'medium', 'weak'], 'scale': {'fold': 0.5}},
            {'note': 'checks his medium hands', 'facing': 'none', 'hands': ['medium'], 'scale': {'aggressive': 0.5}},
            {'note': 'bets smaller than he should with value', 'facing': 'none', 'hands': ['monster', 'strong'], 'scale': {'bet_small': 1.5}},
        ],
    },
    'nit': {
        'name': 'Nit',
        'description': 'Tight and scared. Folds to pressure more than anyone, rarely bets when checked to, and his\nriver bets are almost never bluffs. Respect his aggression, attack his checks.',
        'rules': [
            {'note': 'folds his weaker hands to pressure', 'facing': 'bet', 'hands': ['medium', 'weak', 'draw', 'air'], 'scale': {'fold': 1.5}},
            {'note': 'checks his medium hands', 'facing': 'none', 'hands': ['medium'], 'scale': {'aggressive': 0.6}},
        ],
    },
    'maniac': {
        'name': 'Maniac',
        'description': 'Loose-aggressive to a fault. Bets and raises far too often, especially with air and draws,\nand folds too little. Call him down lighter; let him bluff.',
        'rules': [
            {'note': 'bluffs big with nothing', 'facing': 'none', 'hands': ['weak', 'draw', 'air'], 'scale': {'bet_large': 1.5}},
        ],
    },
    'reg': {
        'name': 'Reg',
        'description': 'A typical online regular (tight-aggressive): c-bets a lot, gives up when called, folds\nwhen he is beaten. Solid, but more predictable than an expert.',
        'rules': [],
    },
}

# knob: (rule fields, action class it scales)
KNOBS = {
    'fold_flop': ({'facing': 'bet', 'streets': ['flop']}, 'fold'),
    'fold_turn': ({'facing': 'bet', 'streets': ['turn']}, 'fold'),
    'fold_river': ({'facing': 'bet', 'streets': ['river']}, 'fold'),
    'air_fold_river': ({'facing': 'bet', 'streets': ['river'], 'hands': ['air']}, 'fold'),
    'raise': ({'facing': 'bet'}, 'raise'),
    'cbet_flop': ({'role': ['aggr'], 'streets': ['flop']}, 'aggressive'),
    'cbet_later': ({'role': ['aggr'], 'streets': ['turn', 'river']}, 'aggressive'),
    'donk': ({'role': ['donk']}, 'aggressive'),
    'probe': ({'role': ['free']}, 'aggressive'),
    'bluff_river': ({'facing': 'none', 'streets': ['river'], 'hands': ['weak', 'air']}, 'aggressive'),
}


# What the calibration rules add up to for each type, compared with the average low-stakes player,
# from the real players' stats (shown in puzzles under "How he plays"). A knob's own size isn't
# a trait: it also undoes or sharpens the character rules above it, so the notes come from the data.
NOTES = {
    'whale': {'fold_flop': 'calls flop and turn bets more than most players',
              'donk': 'bets into the preflop raiser often (about 1 flop in 5)',
              'bluff_river': 'about 1 in 5 of his called river bets is a bluff'},
    'station': {'fold_turn': 'folds to bets a little less than most players',
                'donk': 'bets into the preflop raiser more than most (about 1 flop in 6)',
                'bluff_river': 'does bluff the river sometimes: about 1 in 7 of his called river bets'},
    'nit': {'fold_flop': 'folds to bets more than anyone: 7 flop bets in 10',
            'probe': 'rarely bets when checked to',
            'bluff_river': 'almost never bluffs the river: about 1 in 20 called river bets'},
    'maniac': {'fold_flop': 'folds to flop bets less than most players',
               'donk': 'bets into the preflop raiser more than anyone (more than 1 flop in 4)',
               'probe': 'bets most times he is checked to',
               'bluff_river': 'a quarter of his called river bets are bluffs'},
    'reg': {'cbet_flop': 'c-bets the flop two times in three',
            'fold_turn': 'folds to turn and river bets more than most players',
            'bluff_river': 'bluffs the river rarely: about 1 in 10 called river bets'},
}


def profile(name, knobs):
    c = CHARACTER[name]
    rules = [dict(r) for r in c['rules']]
    for k, (fields, act) in KNOBS.items():
        v = knobs.get(k, 1.0)
        if abs(v - 1.0) < 1e-3:
            continue
        r = dict(fields)
        if NOTES.get(name, {}).get(k):
            r['note'] = NOTES[name][k]
        r['scale'] = {act: round(v, 3)}
        rules.append(r)
    return {'name': c['name'], 'description': c['description'], 'rules': rules}


def toml_value(v):
    if isinstance(v, str):
        return '"' + v.replace('"', '\\"') + '"'
    if isinstance(v, list):
        return '[' + ', '.join(toml_value(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{k} = {toml_value(x)}' for k, x in v.items()) + ' }'
    return repr(v)


def to_toml(p):
    out = [f'name = "{p["name"]}"', 'description = """', p['description'] + '"""', '']
    for r in p['rules']:
        out.append('[[rules]]')
        if 'note' not in r:
            out.append('# calibration (fitted to real players)')
        for k in ['note', 'streets', 'facing', 'facing_size', 'role', 'hands', 'scale', 'set']:
            if k in r:
                out.append(f'{k} = {toml_value(r[k])}')
        out.append('')
    return '\n'.join(out)


if __name__ == '__main__':
    mode, knobs_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    K = json.load(open(knobs_path))
    profs = {n: profile(n, K.get(n, {})) for n in FISH}
    if mode == 'write':
        for n, p in profs.items():
            open(os.path.join(out, f'{n}.toml'), 'w').write(to_toml(p))
    else:
        json.dump(profs, open(out, 'w'), indent=1)
