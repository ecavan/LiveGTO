"""The puzzle library's GTO answers next to what Pluribus did in the same kind of spot.

Spot: BTN opens, only the BB calls (100bb), the library's "srp_btn_bb" family. On the turn and
river, after a bet-call on the street before or after it was checked through:
  ip_checked_to   BB checks, BTN to act      → share of each class that bets
  oop_vs_bet      BB checks, BTN bets, BB to act → share of each class that folds / calls / raises
The library's numbers are its GTO playbook (one action per hand, range frequencies kept),
averaged over all its boards for that decision; Pluribus's are pooled over its hands.

Usage: python3 -I solver_check.py <decisions.tsv> <library dir> [Pluribus|all]
"""
import glob
import json
import sys
from collections import defaultdict

import polars as pl

dec_path, lib_dir = sys.argv[1], sys.argv[2]
who = sys.argv[3] if len(sys.argv) > 3 else 'all'
CLS = ['monster', 'strong', 'medium', 'weak', 'draw', 'air']

# ---------------------------------------------------------------- library
lib = {'ip_checked_to': defaultdict(lambda: [0.0, 0.0]), 'oop_vs_bet': defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])}
nrec = defaultdict(int)
for f in glob.glob(f'{lib_dir}/srp_btn_bb_*.json'):
    for r in json.load(open(f))['records']:
        if r['villain']['profile'] != 'gto' or r['decision'] not in lib:
            continue
        acts = r['actions_short'] if 'actions_short' in r else r['actions']
        nrec[r['decision']] += 1
        for c in r['classes']:
            w, pure = c['gto']['weight'], c['gto']['pure']
            if r['decision'] == 'ip_checked_to':
                bet = sum(p for a, p in zip(r['actions'], pure) if not a.lower().startswith('check'))
                lib['ip_checked_to'][c['class']][0] += w * bet
                lib['ip_checked_to'][c['class']][1] += w
            else:
                fold = sum(p for a, p in zip(r['actions'], pure) if a.lower().startswith('fold'))
                call = sum(p for a, p in zip(r['actions'], pure) if a.lower().startswith('call'))
                lib['oop_vs_bet'][c['class']][0] += w * fold
                lib['oop_vs_bet'][c['class']][1] += w * call
                lib['oop_vs_bet'][c['class']][2] += w * (1 - fold - call)
                lib['oop_vs_bet'][c['class']][3] += w

# ---------------------------------------------------------------- Pluribus
d = pl.read_csv(dec_path, separator='\t', quote_char=None, infer_schema_length=0).filter(pl.col('n') == '6')
hands = d.group_by('hand', maintain_order=True).agg(pl.all())
plur = {'ip_checked_to': defaultdict(lambda: [0, 0]), 'oop_vs_bet': defaultdict(lambda: [0, 0, 0, 0])}
for h in hands.iter_rows(named=True):
    rows = [dict(zip(h.keys(), vals)) for vals in zip(*[h[k] if isinstance(h[k], list) else [h[k]] * len(h['player']) for k in h.keys()])]
    pre = [r for r in rows if r['street'] == '0']
    # BTN raises first in, everyone else folds except the BB, who calls
    if not pre or any(r['act'] == 'r' and r['pos'] != 'BTN' for r in pre):
        continue
    btn_open = [r for r in pre if r['pos'] == 'BTN' and r['act'] == 'r' and r['raises'] == '0' and r['limpers'] == '0']
    bb_call = [r for r in pre if r['pos'] == 'BB' and r['act'] == 'c']
    others = [r for r in pre if r['pos'] not in ('BTN', 'BB') and r['act'] != 'f']
    if not btn_open or not bb_call or others or len([r for r in pre if r['act'] == 'r']) != 1:
        continue
    btn, bb = btn_open[0]['player'], bb_call[0]['player']
    by_street = defaultdict(list)
    for r in rows:
        if r['street'] != '0':
            by_street[int(r['street'])].append(r)
    for st in (2, 3):
        prev = by_street.get(st - 1, [])
        seq = ''.join(('B' if r['player'] == btn else 'b') + r['act'] for r in prev)
        if seq not in ('bxBbbc', 'bxBx'):  # bet-called by the BTN after a BB check, or checked through
            continue
        cur = by_street.get(st, [])
        if len(cur) < 2 or cur[0]['player'] != bb or cur[0]['act'] != 'x':
            continue
        b = cur[1]
        if b['player'] != btn:
            continue
        if who == 'all' or btn == who:
            plur['ip_checked_to'][b['cls']][0] += b['act'] in ('b', 'r')
            plur['ip_checked_to'][b['cls']][1] += 1
        if b['act'] == 'b' and len(cur) > 2 and cur[2]['player'] == bb and (who == 'all' or bb == who):
            r3 = cur[2]
            k = {'f': 0, 'c': 1}.get(r3['act'], 2)
            plur['oop_vs_bet'][r3['cls']][k] += 1
            plur['oop_vs_bet'][r3['cls']][3] += 1

print(f'# The solver\'s GTO answers next to Pluribus\n')
print(f'BTN opens, the BB calls, 100bb deep. Library: its GTO playbook over {nrec["ip_checked_to"]} + {nrec["oop_vs_bet"]} turn and river spots.')
print(f'Pluribus logs: decisions by {"every player" if who == "all" else who} in the same line (bet-called or checked through on the street before).\n')
print('## Checked to on the BTN: how often each class bets\n')
print('| Class | Library (GTO) | Pluribus logs | Hands |')
print('|---|---|---|---|')
for c in CLS:
    lw = lib['ip_checked_to'][c]
    pw = plur['ip_checked_to'][c]
    if lw[1] == 0 and pw[1] == 0:
        continue
    l = f'{100 * lw[0] / lw[1]:.0f}%' if lw[1] else '—'
    p = f'{100 * pw[0] / pw[1]:.0f}%' if pw[1] else '—'
    print(f'| {c} | {l} | {p} | {pw[1]} |')
print('\n## BB facing a bet: fold / call / raise\n')
print('| Class | Library (GTO) | Pluribus logs | Hands |')
print('|---|---|---|---|')
for c in CLS:
    lw = lib['oop_vs_bet'][c]
    pw = plur['oop_vs_bet'][c]
    if lw[3] == 0 and pw[3] == 0:
        continue
    l = ' / '.join(f'{100 * x / lw[3]:.0f}' for x in lw[:3]) if lw[3] else '—'
    p = ' / '.join(f'{100 * x / pw[3]:.0f}' for x in pw[:3]) if pw[3] else '—'
    print(f'| {c} | {l} | {p} | {pw[3]} |')
