"""src/content/types.json: each player type's real HUD stats (the calibration targets), for the
Learn → Player types page.

  python3 -I types_json.py <targets.json> <sd_targets.json> > src/content/types.json
"""
import json
import sys

T = json.load(open(sys.argv[1]))
SD = json.load(open(sys.argv[2]))
STATS = ['VPIP', 'PFR', '3Bet', 'FoldTo3Bet', 'CBetFlop', 'FoldToCBetFlop', 'CheckRaiseFlop', 'WTSD', 'AFq']
out = {'stats': STATS, 'types': {}}
for k in ['whale', 'station', 'passive', 'nit', 'maniac', 'reg', 'shark', 'pro']:
    out['types'][k] = {s: round(T[k][s]) for s in STATS if T[k].get(s) is not None}
    out['types'][k]['RiverBluffs'] = round(SD.get(k, {}).get('air_in_river_bets', 0))
    out['types'][k]['source'] = T['_source'][k]
print(json.dumps(out, indent=1))
