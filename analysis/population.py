"""Who the real players are: type every player with enough hands, then pool each type's stats.

Typing uses a player's whole sample (all table sizes); the stats per type are pooled from
5–6-handed hands only, to compare with LiveGTO's 6-handed table.

Types (VPIP / PFR in %, from the usual HUD reading, with LiveGTO's names):
  nit       VPIP < 15
  reg       VPIP 15–28, raises most of what he plays (PFR ≥ 0.6·VPIP)       — TAG
  lag       VPIP 28–40, PFR ≥ 0.6·VPIP                                     — loose-aggressive
  maniac    VPIP ≥ 40 and PFR ≥ 0.5·VPIP, or AFq ≥ 50 with VPIP ≥ 30
  passive   VPIP 15–28, PFR < 0.6·VPIP                                     — tight-passive limper
  station   VPIP 28–45, PFR < 0.6·VPIP, and sticky: goes to showdown (WTSD) ≥ 33% of the flops
            he sees (the top third of loose-passive players; a calling station is defined by
            what he does after the flop, not by VPIP)
  loose     the other loose-passive players (they play too many hands but fold after the flop)
  whale     VPIP ≥ 45, PFR < 0.5·VPIP

Usage: python3 -I population.py <players.tsv> [--min-hands 150] [--json out.json] [--types typed.parquet]
"""
import json
import sys
import polars as pl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import hud  # noqa: E402

path = sys.argv[1]
MIN = int(sys.argv[sys.argv.index('--min-hands') + 1]) if '--min-hands' in sys.argv else 150
out_json = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
out_types = sys.argv[sys.argv.index('--types') + 1] if '--types' in sys.argv else None

df = hud.load(path)
num = [c for c in df.columns if c not in ('venue', 'player', 'table')]
whole = df.group_by(['venue', 'player']).agg([pl.col(c).sum() for c in num])
pp = hud.per_player(whole, MIN)

v, r, afq = pl.col('VPIP'), pl.col('PFR'), pl.col('AFq')
STICKY = 33.0
typed = pp.with_columns(
    type=pl.when(v < 15).then(pl.lit('nit'))
    .when(((v >= 40) & (r >= 0.5 * v)) | ((afq >= 50) & (v >= 30))).then(pl.lit('maniac'))
    .when((v >= 45) & (r < 0.5 * v)).then(pl.lit('whale'))
    .when((v < 28) & (r >= 0.6 * v)).then(pl.lit('reg'))
    .when((v < 28)).then(pl.lit('passive'))
    .when((v < 40) & (r >= 0.6 * v)).then(pl.lit('lag'))
    .when(pl.col('WTSD') >= STICKY).then(pl.lit('station'))
    .otherwise(pl.lit('loose'))
).select(['venue', 'player', 'type', 'vpip_opp'])

ORDER = ['nit', 'passive', 'reg', 'lag', 'station', 'loose', 'whale', 'maniac']
share = typed.group_by('type').agg(players=pl.len(), hands=pl.col('vpip_opp').sum())
share = share.with_columns(
    (100 * pl.col('players') / pl.col('players').sum()).round(1).alias('% of players'),
    (100 * pl.col('hands') / pl.col('hands').sum()).round(1).alias('% of hands'),
)
share = share.sort(pl.col('type').replace({t: str(i) for i, t in enumerate(ORDER)}))

six = df.filter(pl.col('table') == '5-6').join(typed.select(['venue', 'player', 'type']), on=['venue', 'player'], how='inner')
st = hud.stats(six, 'type')
st = st.sort(pl.col('type').replace({t: str(i) for i, t in enumerate(ORDER)}))
all_six = hud.stats(df.filter(pl.col('table') == '5-6').with_columns(type=pl.lit('everyone')), 'type')

if __name__ == '__main__':
    pl.Config.set_tbl_cols(40)
    pl.Config.set_tbl_width_chars(250)
    pl.Config.set_tbl_rows(70)
    print(f'players with ≥{MIN} hands: {pp.height} (of {whole.height}); they play {100 * pp["vpip_opp"].sum() / whole["vpip_opp"].sum():.0f}% of the hands')
    print(share)
    print(pl.concat([st, all_six]).transpose(include_header=True, column_names='type'))
    if out_types:
        typed.write_parquet(out_types)
    if out_json:
        json.dump({
            'min_hands': MIN,
            'share': share.to_dicts(),
            'by_type': {row['type']: row for row in pl.concat([st, all_six]).to_dicts()},
        }, open(out_json, 'w'), indent=1)
