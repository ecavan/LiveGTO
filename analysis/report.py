"""Before / after / real, per archetype, as Markdown tables (for docs/CALIBRATION.md).

Usage: python3 -I report.py <targets.json> <sd_targets.json> <old bots dir> <new bots dir>
(each bots dir holds ps-phh output: players.tsv, showdowns.tsv)
"""
import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import hud  # noqa: E402
import showdown  # noqa: E402

T = json.load(open(sys.argv[1]))
SD = json.load(open(sys.argv[2]))
SRC = T.get('_source', {})


def bots(d):
    st = {r['player']: r for r in hud.stats(hud.load(f'{d}/players.tsv'), 'player').to_dicts()}
    comp = showdown.composition(showdown.load(f'{d}/showdowns.tsv'), 'bet_called')
    for row in comp.to_dicts():
        if row['type'] in st:
            st[row['type']]['air_in_river_bets'] = row.get('air', 0.0)
    return st


OLD, NEW = bots(sys.argv[3]), bots(sys.argv[4])
ROWS = [
    ('VPIP', 'Plays (VPIP)'), ('PFR', 'Raises preflop (PFR)'), ('OpenLimp', 'Open-limps'), ('RFI_UTG', 'Opens UTG'),
    ('RFI_BTN', 'Opens on the button'), ('3Bet', '3-bets'), ('ColdCall', 'Cold-calls an open'), ('BBFold', 'BB folds to an open'),
    ('FoldTo3Bet', 'Folds to a 3-bet'), ('CBetFlop', 'C-bets the flop'), ('DonkFlop', 'Donk-bets the flop'),
    ('FoldToCBetFlop', 'Folds to a flop c-bet'), ('FoldToStabFlop', 'Folds to another flop bet'),
    ('FoldToBetFlop', 'Folds to a flop bet'), ('FoldToBetTurn', 'Folds to a turn bet'), ('FoldToBetRiver', 'Folds to a river bet'),
    ('CheckRaiseFlop', 'Check-raises the flop'), ('WTSD', 'Goes to showdown (WTSD)'), ('AFq', 'Aggression (AFq)'),
    ('air_in_river_bets', 'Air in his called river bets'),
]
for a in ['whale', 'station', 'passive', 'nit', 'maniac', 'reg', 'shark', 'pro']:
    print(f'### {a.capitalize()} (vs {SRC.get(a, "?")})\n')
    print('| Stat | Before | After | Real |')
    print('|---|---|---|---|')
    for k, label in ROWS:
        real = SD.get(a, {}).get(k) if k == 'air_in_river_bets' else T[a].get(k)
        o, n = OLD.get(a, {}).get(k), NEW.get(a, {}).get(k)
        f = lambda x: '—' if x is None else f'{x:.0f}%'
        print(f'| {label} | {f(o)} | {f(n)} | {f(real)} |')
    print()
