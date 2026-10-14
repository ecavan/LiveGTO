"""Cross-check ps-phh's replay against pokerkit (the PHH reference implementation).

For every decision: pot before acting, amount to call, and the action type must agree.
Usage: python3 -I crosscheck.py <hands.phhs> <decisions.tsv>
"""
import sys
from decimal import Decimal
import polars as pl
from pokerkit import HandHistory

phh, dec = sys.argv[1], sys.argv[2]
with open(phh, 'rb') as f:
    hhs = list(HandHistory.load_all(f))
d = pl.read_csv(dec, separator='\t', infer_schema_length=0)
by_hand = {}
for row in d.iter_rows(named=True):
    by_hand.setdefault(row['hand'].split(':', 1)[-1], []).append(row)  # ps-phh writes file:hand

checked = bad = skipped = 0
for hh in hhs:
    rows = by_hand.get(str(hh.hand))
    if rows is None:
        skipped += 1
        continue
    bb = Decimal(str(hh.blinds_or_straddles[1]))
    k = 0
    try:
        states = hh.state_actions  # one state object, updated in place
    except Exception:
        skipped += 1
        continue
    ok = True
    pot_before = owe_before = None
    for state, action in states:
        if action is None:
            pot_before, owe_before = state.total_pot_amount, state.checking_or_calling_amount
            continue
        parts = action.split()
        if parts[0] != 'd' and parts[1] in ('f', 'cc', 'cbr'):
            r = rows[k]; k += 1
            pot = pot_before / bb
            owe = (owe_before or 0) / bb if parts[1] != 'f' else None
            act = {'f': 'f', 'cbr': None, 'cc': 'x' if (owe_before or 0) == 0 else 'c'}[parts[1]]
            if abs(float(pot) - float(r['pot_bb'])) > 0.006: ok = False
            if act and act != r['act']: ok = False
            if parts[1] == 'cbr' and r['act'] not in ('b', 'r'): ok = False
            if owe is not None and abs(float(owe) - float(r['to_call_bb'])) > 0.006 and r['act'] != 'f': ok = False
        # pokerkit updates one state object in place: read "before" values after each step
        pot_before, owe_before = state.total_pot_amount, state.checking_or_calling_amount
    if k != len(rows): ok = False
    checked += 1
    bad += (not ok)
    if not ok and bad <= 3:
        print('mismatch in hand', hh.hand)
print(f'checked {checked} hands, {bad} mismatches, {skipped} not compared')
