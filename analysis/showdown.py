"""What each type of player actually had at showdown, by how the river went.

On a called river bet the bettor has to show (in these logs his hand is known 99.8–100% of the
time on every site), so we see the bettor's whole hand. A caller who loses usually mucks (his hand
is known 2–5% of the time when he loses), so what callers had is NOT a fair sample: it is shown
for reference only. Whether a bet gets called is
up to the caller, who can't see the bettor's cards, so the hands behind called bets are a fair
sample of everything the bettor bets on the river (card removal aside). Lines that end in an
all-in are left out (the river may not have been played).

Classes are ps-core::classify on the full board, the same classes the bots' profiles use.

Usage: python3 -I showdown.py <showdowns.tsv> <players-typed.parquet or 'bots'>
"""
import sys
import polars as pl

CLS = ['monster', 'strong', 'medium', 'weak', 'air']


def load(path, types=None):
    s = pl.read_csv(path, separator='\t', quote_char=None, infer_schema_length=0)
    s = s.filter((pl.col('allin') == '0') & pl.col('hole').is_not_null() & (pl.col('hole') != '') & (pl.col('table') == '5-6'))
    if types is None:  # bots: the player name is the archetype
        return s.with_columns(type=pl.col('player'))
    return s.join(types, on=['venue', 'player'], how='inner')


def composition(s, role):
    """Share of each river class for showdowns where the player had `role` on the river."""
    x = s.filter(pl.col('river_role') == role)
    g = x.group_by(['type', 'cls_river']).agg(n=pl.len())
    tot = g.group_by('type').agg(total=pl.col('n').sum())
    g = g.join(tot, on='type').with_columns((100 * pl.col('n') / pl.col('total')).round(1).alias('pct'))
    wide = g.pivot(on='cls_river', index=['type', 'total'], values='pct').fill_null(0)
    return wide.select(['type', 'total'] + [c for c in CLS if c in wide.columns])


if __name__ == '__main__':
    pl.Config.set_tbl_cols(30)
    pl.Config.set_tbl_width_chars(200)
    types = None if sys.argv[2] == 'bots' else pl.read_parquet(sys.argv[2])
    s = load(sys.argv[1], types)
    for role, title in [('bet_called', 'River bets that got called: what the bettor had'),
                        ('call', 'River calls: what the caller had (biased: losers muck)'),
                        ('check_down', 'Checked down on the river')]:
        print(title)
        print(composition(s, role))


def targets(showdowns_path, typed_path, venues=None):
    """{type: {air_in_river_bets, air_in_river_calls (+ _n)}} for the calibration."""
    s = load(showdowns_path, pl.read_parquet(typed_path))
    if venues:
        s = s.filter(pl.col('venue').is_in(venues))
    out = {}
    for row in composition(s, 'bet_called').to_dicts():
        out[row['type']] = {'air_in_river_bets': row.get('air', 0.0), 'air_in_river_bets_n': row['total'],
                            'weak_in_river_bets': row.get('weak', 0.0)}
    return out
