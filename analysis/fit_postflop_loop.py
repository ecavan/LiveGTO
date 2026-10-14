"""Fit the villain profiles' calibration rules (profiles_fit.py) by simulation.

Each round: write candidate profiles, play full bot tables, measure each archetype with the
same stats as the real players, and nudge every multiplier towards its target:
    k ← k · (target / measured)^0.7
What a caller had can't be a target: a caller who loses usually mucks, so the logs show his
hand mostly when he wins. The bettor's hand on a called river bet is always shown.

Usage: python3 -I fit_postflop_loop.py <targets.json> <showdown targets.json> <work dir> [rounds] [hands] [start knobs.json]
"""
import json
import os
import subprocess
import sys

import polars as pl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import hud  # noqa: E402
import profiles_fit  # noqa: E402
import showdown  # noqa: E402

T = json.load(open(sys.argv[1]))
SD = json.load(open(sys.argv[2]))
work = sys.argv[3]
ROUNDS = int(sys.argv[4]) if len(sys.argv) > 4 else 5
HANDS = int(sys.argv[5]) if len(sys.argv) > 5 else 40000
K = json.load(open(sys.argv[6])) if len(sys.argv) > 6 else {n: {} for n in profiles_fit.FISH}
os.makedirs(work, exist_ok=True)
POOL = {'reg': 0.26, 'nit': 0.18, 'station': 0.18, 'whale': 0.14, 'maniac': 0.12, 'pro': 0.12}
DRIVE = {  # knob → (stat, direction)
    'fold_flop': ('FoldToBetFlop', 1), 'fold_turn': ('FoldToBetTurn', 1), 'fold_river': ('FoldToBetRiver', 1),
    'raise': ('RaiseCBetFlop', 1),
    'cbet_flop': ('CBetFlop', 1), 'cbet_later': ('CBetTurn', 1), 'donk': ('DonkFlop', 1), 'probe': ('ProbeTurn', 1),
    'bluff_river': ('air_in_river_bets', 1),
}
REPORT = list(dict.fromkeys([v[0] for v in DRIVE.values()] + ['WTSD', 'AFq', 'FoldToCBetFlop', 'CheckRaiseFlop']))


def all_profiles(knobs):
    base = json.load(open(f'{ROOT}/src/engine/hu/profiles.json'))
    for n in profiles_fit.FISH:
        base[n] = profiles_fit.profile(n, knobs.get(n, {}))
    return base


def measure(knobs, tag):
    pj = f'{work}/{tag}_profiles.json'
    json.dump(all_profiles(knobs), open(pj, 'w'))
    half = HANDS // 2
    procs = [subprocess.Popen(['npx', 'vite-node', 'analysis/sim-phh.mjs', str(half), f'{work}/{tag}_{k}.phhs', str(200 + k), json.dumps(POOL), '--profiles', pj],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for k in (1, 2)]
    for p in procs:
        p.wait()
    subprocess.run([f'{ROOT}/solver/target/release/ps-phh', f'{work}/{tag}_1.phhs', f'{work}/{tag}_2.phhs', '--out', f'{work}/{tag}'],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    st = {r['player']: r for r in hud.stats(hud.load(f'{work}/{tag}/players.tsv'), 'player').to_dicts()}
    s = showdown.load(f'{work}/{tag}/showdowns.tsv')
    for role, key in [('bet_called', 'air_in_river_bets'), ('call', 'air_in_river_calls')]:
        comp = showdown.composition(s, role)
        for row in comp.to_dicts():
            if row['type'] in st:
                st[row['type']][key] = row.get('air', 0.0)
                st[row['type']][key + '_n'] = row['total']
    for f in (1, 2):
        os.remove(f'{work}/{tag}_{f}.phhs')
    return st


def target(name, stat):
    if stat.startswith('air_in'):
        return SD.get(name, {}).get(stat)
    return T[name].get(stat)


def report(M, label):
    print(label, flush=True)
    for n in profiles_fit.FISH:
        cells = []
        for stat in REPORT:
            t, m = target(n, stat), M.get(n, {}).get(stat)
            if t is None or m is None:
                continue
            cells.append(f'{stat} {m:.0f}/{t:.0f}')
        print(f'  {n:8s} ' + '  '.join(cells), flush=True)


for r in range(ROUNDS + 1):
    M = measure(K, f'p{r}')
    report(M, f'round {r} (bots/real)')
    json.dump({'knobs': K, 'measured': M}, open(f'{work}/round_{r}.json', 'w'), indent=1)
    if r == ROUNDS:
        break
    for n in profiles_fit.FISH:
        kn = dict(K.get(n, {}))
        for knob, (stat, sign) in DRIVE.items():
            t, m = target(n, stat), M.get(n, {}).get(stat)
            if t is None or m is None or t < 0.5 or m < 0.5:
                continue
            step = (t / m) ** (0.7 * sign)
            kn[knob] = max(0.05, min(20.0, kn.get(knob, 1.0) * max(0.5, min(2.0, step))))
        K[n] = {k: round(v, 3) for k, v in kn.items()}
json.dump(K, open(f'{work}/knobs.json', 'w'), indent=1)
print(f'{work}/knobs.json')
