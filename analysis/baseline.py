"""The bots' postflop baseline (BASE_OPEN / BASE_FACING in src/engine/hu/bots.js) next to what
a player actually did with each class of hand, from logs where every card is known.

Not facing a bet: check / small (< ½ pot) / big / all-in. Facing a bet (sized against the pot
before it: small < ½, large ≤ pot, overbet): fold / call / raise / all-in.

Usage: python3 -I baseline.py <decisions.tsv> [player|all] [--json out.json]
"""
import json
import sys
import polars as pl

path = sys.argv[1]
who = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 'Pluribus'
out_json = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
CLS = ['monster', 'strong', 'medium', 'weak', 'draw', 'air']

d = pl.read_csv(path, separator='\t', quote_char=None, infer_schema_length=0)
d = d.filter((pl.col('street') != '0') & (pl.col('cls') != ''))
if who != 'all':
    d = d.filter(pl.col('player') == who)
d = d.with_columns(pl.col('frac').cast(pl.Float64, strict=False), pl.col('to_call_bb').cast(pl.Float64))
facing = pl.col('to_call_bb') > 0
d = d.with_columns(
    kind=pl.when(facing).then(pl.lit('facing')).otherwise(pl.lit('open')),
    size=pl.when(~facing).then(pl.lit(''))
    .when(pl.col('frac') < 0.5).then(pl.lit('small'))
    .when(pl.col('frac') <= 1.05).then(pl.lit('large')).otherwise(pl.lit('overbet')),
    move=pl.when(pl.col('act').is_in(['b', 'r']) & (pl.col('allin') == '1')).then(pl.lit('allin'))
    .when(pl.col('act') == 'x').then(pl.lit('check'))
    .when(pl.col('act') == 'f').then(pl.lit('fold'))
    .when(pl.col('act') == 'c').then(pl.lit('call'))
    .when(pl.col('act') == 'r').then(pl.lit('raise'))
    .when(pl.col('frac') < 0.5).then(pl.lit('small')).otherwise(pl.lit('big')),
    street_name=pl.col('street').replace({'1': 'flop', '2': 'turn', '3': 'river'}),
)


def table(sub, keys):
    g = sub.group_by(['cls', 'move']).agg(n=pl.len())
    tot = g.group_by('cls').agg(t=pl.col('n').sum())
    g = g.join(tot, on='cls').with_columns(p=pl.col('n') / pl.col('t'))
    out = {}
    for c in CLS:
        row = g.filter(pl.col('cls') == c)
        if row.height == 0:
            continue
        out[c] = {k: round(float(row.filter(pl.col('move') == k)['p'].sum()), 3) for k in keys}
        out[c]['n'] = int(row['t'][0])
    return out


res = {'who': who, 'open': {}, 'facing': {}, 'open_role': {}}
for street in ['all', 'flop', 'turn', 'river']:
    sub = d if street == 'all' else d.filter(pl.col('street_name') == street)
    res['open'][street] = table(sub.filter(pl.col('kind') == 'open'), ['check', 'small', 'big', 'allin'])
    res['open_role'][street] = {r: table(sub.filter((pl.col('kind') == 'open') & (pl.col('role') == r)), ['check', 'small', 'big', 'allin'])
                                for r in ['aggr', 'donk', 'checked_to', 'none']}
    res['facing'][street] = {s: table(sub.filter((pl.col('kind') == 'facing') & (pl.col('size') == s)), ['fold', 'call', 'raise', 'allin'])
                             for s in ['small', 'large', 'overbet']}

if __name__ == '__main__':
    def show(t, keys):
        for c, v in t.items():
            print(f"  {c:8s} n={v['n']:5d}  " + '  '.join(f"{k} {100 * v[k]:4.0f}%" for k in keys))
    for street in ['all', 'flop', 'turn', 'river']:
        print(f'== {who}, {street}: not facing a bet')
        show(res['open'][street], ['check', 'small', 'big', 'allin'])
        for r in ['aggr', 'donk', 'checked_to', 'none']:
            print(f'   -- as {r}')
            show(res['open_role'][street][r], ['check', 'small', 'big', 'allin'])
        for s in ['small', 'large', 'overbet']:
            print(f'== {who}, {street}: facing a {s} bet')
            show(res['facing'][street][s], ['fold', 'call', 'raise', 'allin'])
    if out_json:
        json.dump(res, open(out_json, 'w'), indent=1)
