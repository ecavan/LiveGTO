"""Refine preflop.json by simulation: play preflop-only bot tables, measure, nudge, repeat.

Usage: python3 -I fit_preflop_loop.py <targets.json> <start preflop.json> <work dir> [rounds] [hands]
Writes <work dir>/preflop_<k>.json each round and prints the largest misses.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import hud  # noqa: E402
import fit_preflop  # noqa: E402

targets_path, start, work = sys.argv[1], sys.argv[2], sys.argv[3]
ROUNDS = int(sys.argv[4]) if len(sys.argv) > 4 else 4
HANDS = int(sys.argv[5]) if len(sys.argv) > 5 else 60000
T = json.load(open(targets_path))
os.makedirs(work, exist_ok=True)
KEYS = ['RFI_UTG', 'RFI_HJ', 'RFI_CO', 'RFI_BTN', 'RFI_SB', 'OLimp_UTG', 'OLimp_BTN', 'OLimp_SB', 'IsoBehind', 'LimpBehind',
        'IsoVsLimp(BB)', '3Bet', 'ColdCall', 'BB3Bet', 'BBFold', 'LimpCallVsRaise', 'LimpFoldVsRaise', 'FoldTo3Bet', '4Bet', 'VPIP', 'PFR']


def measure(pre_path, tag):
    half = HANDS // 2
    procs = []
    for k in (1, 2):
        out = f'{work}/{tag}_{k}.phhs'
        procs.append(subprocess.Popen(['npx', 'vite-node', 'analysis/sim-phh.mjs', str(half), out, str(100 + k), '--preflop', '--pre', pre_path],
                                      cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    for p in procs:
        p.wait()
    subprocess.run([f'{ROOT}/solver/target/release/ps-phh', f'{work}/{tag}_1.phhs', f'{work}/{tag}_2.phhs', '--out', f'{work}/{tag}'],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    st = hud.stats(hud.load(f'{work}/{tag}/players.tsv'), 'player')
    return {r['player']: r for r in st.to_dicts()}


def report(M, label):
    worst = []
    for a in fit_preflop.ORDER:
        for k in KEYS:
            t, m = T[a].get(k), M.get(a, {}).get(k)
            if t is None or m is None:
                continue
            worst.append((abs(t - m), a, k, t, m))
    worst.sort(reverse=True)
    print(f'{label}: mean |miss| {sum(w[0] for w in worst) / len(worst):.2f} pts; worst:', flush=True)
    for w in worst[:8]:
        print(f'   {w[1]:8s} {w[2]:16s} target {w[3]:5.1f}  bots {w[4]:5.1f}', flush=True)


P = json.load(open(start))
cur = start
for k in range(ROUNDS):
    M = measure(cur, f'r{k}')
    report(M, f'round {k}')
    json.dump(M, open(f'{work}/measured_{k}.json', 'w'), indent=1)
    P = {a: fit_preflop.rounded(fit_preflop.refine(P[a], T[a], M[a])) for a in fit_preflop.ORDER}
    cur = f'{work}/preflop_{k + 1}.json'
    json.dump(P, open(cur, 'w'), indent=1)
M = measure(cur, 'final')
report(M, 'final')
json.dump(M, open(f'{work}/measured_final.json', 'w'), indent=1)
print(cur)
