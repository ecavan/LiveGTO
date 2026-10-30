"""Recover the fitted knobs (fit_postflop_loop.py's knobs.json) from the profiles as written,
so a refit can start from where the last one ended instead of from 1.0.

A calibration rule is one whose fields are exactly a knob's fields (profiles_fit.KNOBS) and
whose `scale` is that knob's action class; its note, if any, is ignored.

  python3 -I knobs_from_profiles.py <profiles dir> > knobs.json
"""
import json
import os
import sys
import tomllib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import profiles_fit  # noqa: E402

FIELDS = ['role', 'streets', 'facing', 'facing_size', 'hands']


def key(d):
    return tuple((f, tuple(d[f]) if isinstance(d.get(f), list) else d.get(f)) for f in FIELDS if f in d)


out = {}
for name in profiles_fit.FISH:
    path = os.path.join(sys.argv[1], f'{name}.toml')
    if not os.path.exists(path):
        continue
    p = tomllib.load(open(path, 'rb'))
    knobs = {}
    for r in p.get('rules', []):
        if 'set' in r or 'scale' not in r or len(r['scale']) != 1:
            continue
        for k, (fields, act) in profiles_fit.KNOBS.items():
            if key(fields) == key(r) and act in r['scale']:
                knobs[k] = r['scale'][act]
    out[name] = knobs
print(json.dumps(out, indent=1))
