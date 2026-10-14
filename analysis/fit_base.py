"""New postflop baseline for the bots from the Pluribus hands (src/engine/hu/bots.js BASE_*).

Pluribus is the reference; where its sample of a cell is thin, the estimate is shrunk towards
what all six players in those games did (Pluribus and the pros):
    p = (n_P · p_P + K · p_all) / (n_P + K),   K = 40
Streets are pooled. "Free" = not the previous street's aggressor and not betting into him
(he checked, or nobody bet the previous street).

Usage: python3 -I fit_base.py <base_plur.json> <base_all.json> > base.json
"""
import json
import sys

K = 40
P = json.load(open(sys.argv[1]))
A = json.load(open(sys.argv[2]))
CLS = ['monster', 'strong', 'medium', 'weak', 'draw', 'air']


def merge(tables, keys):
    """Pool several {cls: {key: p, n}} tables (counts add)."""
    out = {}
    for c in CLS:
        n = sum(t.get(c, {}).get('n', 0) for t in tables)
        if n == 0:
            continue
        out[c] = {k: sum(t.get(c, {}).get(k, 0) * t.get(c, {}).get('n', 0) for t in tables) / n for k in keys}
        out[c]['n'] = n
    return out


def shrink(p, a, keys):
    out = {}
    for c in CLS:
        np_, na = p.get(c, {}).get('n', 0), a.get(c, {}).get('n', 0)
        if np_ + na == 0:
            continue
        v = {k: (np_ * p.get(c, {}).get(k, 0) + K * a.get(c, {}).get(k, 0)) / (np_ + K) if na else p[c][k] for k in keys}
        t = sum(v.values())
        out[c] = {k: round(v[k] / t, 3) for k in keys}
        out[c]['_n'] = np_
    return out


OPEN = ['check', 'small', 'big', 'allin']
FACE = ['fold', 'call', 'raise', 'allin']
res = {'open': {}, 'facing': {}}
for role, parts in [('aggr', ['aggr']), ('donk', ['donk']), ('free', ['checked_to', 'none'])]:
    p = merge([P['open_role']['all'][r] for r in parts], OPEN)
    a = merge([A['open_role']['all'][r] for r in parts], OPEN)
    res['open'][role] = shrink(p, a, OPEN)
for size in ['small', 'large', 'overbet']:
    res['facing'][size] = shrink(P['facing']['all'][size], A['facing']['all'][size], FACE)
print(json.dumps(res, indent=1))
