"""Villain profiles fitted to real players (solver/profiles/*.toml → profiles.json).

Each profile keeps its character rules (the notes the app shows: "never folds a pair", "size
tells", …) with their old strengths, then a block of calibration rules whose strengths are
fitted so that the bots' stats match real players of that type (targets.json):

  fold_cbet                            facing a flop c-bet: fold             → Fold to c-bet (flop)
  fold_flop                            facing any other flop bet: fold       → Fold to a donk or stab bet (flop)
  fold_turn / fold_river               facing a first bet: fold              → Fold to bet, by street
  (facing a raise stays the baseline: the HUD's fold-to-bet stats don't count raises)
  raise                                facing a first bet: raise             → Raise vs c-bet and check-raise (flop)
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

FISH = ['whale', 'station', 'passive', 'nit', 'maniac', 'reg', 'shark', 'pro']

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
        'description': 'Loose-passive and sticky. Plays a third of his hands, calls a lot before the flop, and goes to\nshowdown more than anyone. He checks hands he should bet; when he bets the river he usually has it.\nThe most common profitable opponent at $1/$2.',
        'rules': [
            {'note': 'hates folding a pair to a normal bet', 'facing_size': ['small', 'large'], 'hands': ['strong', 'medium', 'weak'], 'scale': {'fold': 0.5}},
            {'note': 'checks his medium hands', 'facing': 'none', 'hands': ['medium'], 'scale': {'aggressive': 0.5}},
            {'note': 'bets smaller than he should with value', 'facing': 'none', 'hands': ['monster', 'strong'], 'scale': {'bet_small': 1.5}},
        ],
    },
    'passive': {
        'name': 'Passive',
        'description': 'Tight-passive. Plays a normal number of hands but rarely raises: limps, calls, and folds\nwhen he misses. When he bets or raises he has it.',
        'rules': [],
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
        'description': 'A modern regular (tight-aggressive): raises first in, 3-bets more than the old-school reg,\nc-bets often and folds when he meets resistance. Solid, but more predictable than an expert.',
        'rules': [],
    },
    'shark': {
        'name': 'Shark',
        'description': 'A strong human pro (the pros who played Pluribus): close to the baseline, a little more\naggressive and harder to push off a hand.',
        'rules': [],
    },
    'pro': {
        'name': 'Pro',
        'description': 'Plays like Pluribus, the poker AI: the baseline, calibrated to its stats.',
        'rules': [],
    },
}

# knob: (rule fields, action class it scales)
KNOBS = {
    'fold_cbet': ({'role': ['vs_cbet'], 'streets': ['flop']}, 'fold'),
    'fold_flop': ({'role': ['vs_bet'], 'streets': ['flop']}, 'fold'),
    'fold_turn': ({'role': ['vs_cbet', 'vs_bet'], 'streets': ['turn']}, 'fold'),
    'fold_river': ({'role': ['vs_cbet', 'vs_bet'], 'streets': ['river']}, 'fold'),
    'raise': ({'role': ['vs_cbet', 'vs_bet']}, 'raise'),
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
    'whale': {'fold_cbet': 'calls a flop c-bet about half the time',
              'fold_turn': 'calls turn bets more than anyone: folds 4 in 10',
              'donk': 'bets into the preflop raiser about 1 flop in 5',
              'bluff_river': 'about 1 in 5 of his called river bets is a bluff'},
    'station': {'fold_cbet': 'folds to a flop c-bet only about half the time',
                'fold_turn': 'calls turn bets more than most: folds 4 in 10',
                'donk': 'bets into the preflop raiser about 1 flop in 7',
                'bluff_river': 'rarely bluffs the river: about 1 in 7 called river bets'},
    'passive': {'fold_flop': 'folds to a donk bet or a stab 2 times in 3',
                'fold_turn': 'folds to turn bets half the time',
                'bluff_river': 'seldom bluffs the river: about 1 in 10 called river bets'},
    'nit': {'fold_cbet': 'folds to a flop c-bet 6 times in 10',
            'fold_flop': 'folds to other flop bets 3 times in 4',
            'probe': 'rarely bets when checked to',
            'bluff_river': 'almost never bluffs the river: about 1 in 20 called river bets'},
    'maniac': {'fold_cbet': 'calls flop c-bets more than most players',
               'donk': 'bets into the preflop raiser more than anyone (more than 1 flop in 4)',
               'probe': 'bets 4 times in 10 when checked to on the turn',
               'bluff_river': 'a quarter of his called river bets are bluffs'},
    'reg': {'cbet_flop': 'c-bets the flop 6 times in 10',
            'fold_turn': 'folds to turn and river bets more than most players',
            'bluff_river': 'about 1 in 6 of his called river bets is a bluff'},
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
