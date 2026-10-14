"""The coach's preflop charts against Pluribus's 10,000 hands (all cards known).

For every Pluribus decision that a chart covers (first in; facing a single raise), compare
what Pluribus did with what the chart says. Pluribus mixes, so per hand we use how often it
raised / called / folded.

Usage: python3 -I pluribus.py <decisions.tsv> <charts.json> [--all-players] > report.md
"""
import json
import sys
import polars as pl

dec_path, charts_path = sys.argv[1], sys.argv[2]
who = 'all six players' if '--all-players' in sys.argv else 'Pluribus'
charts = json.load(open(charts_path))
R = 'AKQJT98765432'


def hand_type(h):
    a, b = h[0:2], h[2:4]
    ra, rb = R.index(a[0]), R.index(b[0])
    if ra == rb:
        return a[0] + b[0]
    hi, lo = (a, b) if ra < rb else (b, a)
    return hi[0] + lo[0] + ('s' if a[1] == b[1] else 'o')


def combos(t):
    return 6 if len(t) == 2 else 4 if t.endswith('s') else 12


ALL = [R[i] + R[j] + s for i in range(13) for j in range(13) for s in ([''] if i == j else ['s', 'o']) if (i == j) or (i < j)]
# 6-max seat (as ps-phh names it, by distance from the button) → chart position
SIX = {'LJ': 'UTG', 'HJ': 'MP', 'CO': 'CO', 'BTN': 'BTN', 'SB': 'SB', 'BB': 'BB'}
LABEL = {'UTG': 'UTG', 'MP': 'HJ', 'CO': 'CO', 'BTN': 'BTN', 'SB': 'SB', 'BB': 'BB'}

d = pl.read_csv(dec_path, separator='\t', quote_char=None, infer_schema_length=0)
d = d.filter((pl.col('street') == '0') & (pl.col('n') == '6'))
if who == 'Pluribus':
    d = d.filter(pl.col('player') == 'Pluribus')
d = d.with_columns(
    pl.col('hole').map_elements(hand_type, return_dtype=pl.Utf8).alias('ht'),
    pl.col('pos').replace(SIX).alias('cpos'),
    pl.col('raises').cast(pl.Int32), pl.col('limpers').cast(pl.Int32),
)

print(f'# The preflop charts against Pluribus\n')
print(f'Decisions by {who}, 6-handed, 100bb. Pluribus opens small (about 2–2.5bb) and plays a 6-max online')
print('game; the charts are for live 9-handed $1/$2 with $10 opens, mapped onto six seats the way the')
print('coach maps them (UTG → early, HJ → MP). So a gap in width is expected; the question is whether the')
print('chart keeps the hands Pluribus likes most and drops the ones it dislikes.\n')

# ---------------------------------------------------------------- first in
first = d.filter((pl.col('raises') == 0) & (pl.col('limpers') == 0) & (pl.col('cpos') != 'BB'))
print('## Raise first in\n')
print('| Seat | Chart opens | Pluribus opens | Agreement | Pluribus opens, chart folds | Chart opens, Pluribus folds |')
print('|---|---|---|---|---|---|')
for pos in ['UTG', 'MP', 'CO', 'BTN', 'SB']:
    sub = first.filter(pl.col('cpos') == pos)
    if sub.height == 0:
        continue
    chart = set(charts['rfi'][pos])
    g = sub.group_by('ht').agg(n=pl.len(), r=(pl.col('act') == 'r').mean())
    freq = dict(zip(g['ht'], g['r']))
    cnt = dict(zip(g['ht'], g['n']))
    width = sum(combos(t) for t in chart) / 1326
    plur = sum(freq.get(t, 0) * combos(t) for t in ALL) / 1326
    # agreement over all dealt combos, weighting each hand by its combos and Pluribus's mix
    agree = sum(((freq.get(t, 0) if t in chart else 1 - freq.get(t, 0)) * combos(t)) for t in ALL if t in freq)
    agree /= sum(combos(t) for t in ALL if t in freq)
    p_not_c = sorted([t for t in ALL if t not in chart and freq.get(t, 0) >= 0.8 and cnt.get(t, 0) >= 5], key=lambda t: -freq[t])
    c_not_p = sorted([t for t in chart if freq.get(t, 1) <= 0.2 and cnt.get(t, 0) >= 5], key=lambda t: freq[t])
    print(f"| {LABEL[pos]} | {100*width:.0f}% | {100*plur:.0f}% | {100*agree:.0f}% | {', '.join(p_not_c[:14]) or '—'}{' …' if len(p_not_c) > 14 else ''} | {', '.join(c_not_p) or '—'} |")
print()

# ---------------------------------------------------------------- facing one raise
vs = d.filter((pl.col('raises') == 1) & (pl.col('limpers') == 0))
# who opened: the first raiser before this decision in the same hand
allpre = pl.read_csv(dec_path, separator='\t', quote_char=None, infer_schema_length=0).filter(pl.col('street') == '0')
opener = allpre.filter((pl.col('act') == 'r') & (pl.col('raises') == '0')).select('hand', pl.col('pos').replace(SIX).alias('opos'))
vs = vs.join(opener, on='hand', how='inner').unique(subset=['hand', 'player'], keep='first')
print('## Facing one raise\n')
print('Agreement: how often Pluribus took the chart\'s action (3-bet / call / fold).\n')
print('| You | Opener | Decisions | Chart: 3-bet / call | Pluribus: 3-bet / call | Agreement | Chart folds, Pluribus continues ≥80% | Chart continues, Pluribus folds ≥80% |')
print('|---|---|---|---|---|---|---|---|')
for key, ch in charts['facing'].items():
    hero, op = key.split('|')
    sub = vs.filter((pl.col('cpos') == hero) & (pl.col('opos') == op))
    if sub.height < 30:
        continue
    raise_s, call_s = set(ch['raise']), set(ch['call'])
    g = sub.group_by('ht').agg(n=pl.len(), r=(pl.col('act') == 'r').mean(), c=(pl.col('act') == 'c').mean())
    fr = {t: (r, c) for t, r, c in zip(g['ht'], g['r'], g['c'])}
    cnt = dict(zip(g['ht'], g['n']))
    w = lambda s: sum(combos(t) for t in s) / 1326
    pr = sum(fr.get(t, (0, 0))[0] * combos(t) for t in ALL) / 1326
    pc = sum(fr.get(t, (0, 0))[1] * combos(t) for t in ALL) / 1326

    def agree_t(t):
        r, c = fr[t]
        return r if t in raise_s else c if t in call_s else 1 - r - c
    num = sum(agree_t(t) * cnt[t] for t in fr)
    agree = num / sum(cnt.values())
    fold_cont = sorted([t for t in fr if t not in raise_s and t not in call_s and sum(fr[t]) >= 0.8 and cnt[t] >= 3], key=lambda t: -sum(fr[t]))
    cont_fold = sorted([t for t in fr if (t in raise_s or t in call_s) and sum(fr[t]) <= 0.2 and cnt[t] >= 3], key=lambda t: sum(fr[t]))
    print(f"| {LABEL[hero]} | {LABEL[op]} | {sub.height} | {100*w(raise_s):.0f}% / {100*w(call_s):.0f}% | {100*pr:.0f}% / {100*pc:.0f}% | {100*agree:.0f}% | {', '.join(fold_cont[:10]) or '—'}{' …' if len(fold_cont) > 10 else ''} | {', '.join(cont_fold[:10]) or '—'} |")
