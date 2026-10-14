"""Calibration targets: which real players each LiveGTO archetype should play like.

  whale, station, nit, maniac, reg   the HandHQ players of that type (population.py), 5–6 handed
  shark                              the human pros in the Pluribus games
  pro                                Pluribus

Usage: python3 -I targets.py <population.json> <pluribus players.tsv> > targets.json
"""
import json
import sys
import polars as pl

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import hud  # noqa: E402

pop = json.load(open(sys.argv[1]))['by_type']
plur = hud.load(sys.argv[2]).with_columns(
    who=pl.when(pl.col('player') == 'Pluribus').then(pl.lit('Pluribus')).otherwise(pl.lit('pros')))
ps = {r['who']: r for r in hud.stats(plur, 'who').to_dicts()}

src = {'whale': pop['whale'], 'station': pop['station'], 'nit': pop['nit'], 'maniac': pop['maniac'],
       'reg': pop['reg'], 'shark': ps['pros'], 'pro': ps['Pluribus']}
out = {k: {s: v for s, v in d.items() if s not in ('type', 'who')} for k, d in src.items()}
out['_source'] = {'whale': 'HandHQ whales', 'station': 'HandHQ stations', 'nit': 'HandHQ nits',
                  'maniac': 'HandHQ maniacs', 'reg': 'HandHQ regs (TAG)', 'shark': 'the pros against Pluribus',
                  'pro': 'Pluribus'}
print(json.dumps(out, indent=1))
