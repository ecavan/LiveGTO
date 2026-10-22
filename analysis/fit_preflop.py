"""Fit the ring archetypes' preflop numbers (src/engine/ring/preflop.json) to real players.

Every parameter is a top share of all hands (by the preflop ranking). With recreational noise
ν (a slice ν of the hands he'd fold he calls, 0.4·ν he raises), a cold decision with target
raise rate R and call rate C solves exactly:
    x = (1 − R − C) / (1 − 1.4ν),   continue threshold c = 1 − x,   raise threshold r = R − 0.4·ν·x
After limping (facing a raise) and facing a re-raise, the numbers are shares of his own range
(his limps; his opens or 3-bets), so they start straight from the rates. Everything is then
refined by simulation (refine), since ranges overlap and noise adds a little everywhere:
    θ ← θ · (target / measured)^0.8

  python3 -I fit_preflop.py init <targets.json> > preflop.json
  python3 -I fit_preflop.py refine <targets.json> <preflop.json> <measured stats.json> > new.json
"""
import json
import sys

NOISE = {'whale': 0.06, 'station': 0.03, 'passive': 0.01, 'maniac': 0.04}
# Facing a 4-bet (or a shove) after 3-betting: [5-bet/shove, continue] as shares of his 3-bets.
# The logs have too few of these to fit; these keep the ratios the archetypes had before.
VS3 = {'whale': [0.67, 1.0], 'station': [0.75, 1.0], 'passive': [0.5, 0.75], 'nit': [0.5, 0.67], 'maniac': [0.27, 0.5],
       'reg': [0.29, 0.43], 'shark': [0.28, 0.39], 'pro': [0.25, 0.35]}
POS = ['UTG', 'HJ', 'CO', 'BTN', 'SB']
ORDER = ['whale', 'station', 'passive', 'nit', 'maniac', 'reg', 'shark', 'pro']


def solve(R, C, nu):
    R, C = max(R, 0.0), max(C, 0.0)
    x = max(0.0, (1 - R - C) / (1 - 1.4 * nu))
    c = 1 - x
    r = max(0.001, R - 0.4 * nu * x)
    return r, max(c, r)


def g(t, k, default=0.0):
    v = t.get(k)
    return default if v is None else v / 100


def init(t, nu, name):
    p = {'noise': nu, 'open': {}, 'openLimp': {}}
    for pos in POS:
        r, c = solve(g(t, f'RFI_{pos}'), g(t, f'OLimp_{pos}'), nu)
        p['open'][pos] = r
        p['openLimp'][pos] = c - r
    r, c = solve(g(t, 'IsoBehind'), g(t, 'LimpBehind'), nu)
    p['behind'] = [r, c - r]
    p['bbIso'] = g(t, 'IsoVsLimp(BB)')
    p['vs1'] = list(solve(g(t, '3Bet'), g(t, 'ColdCall'), nu))
    p['bb'] = list(solve(g(t, 'BB3Bet'), max(0.0, 1 - g(t, 'BBFold') - g(t, 'BB3Bet')), nu))
    # shares of his own range: of his limps (after limping, facing a raise), of his opens (facing a 3-bet)
    p['vsIso'] = [g(t, 'LimpReraise'), min(1.0, g(t, 'LimpReraise') + g(t, 'LimpCallVsRaise'))]
    p['vs2'] = [g(t, '4Bet'), min(1.0, 1 - g(t, 'FoldTo3Bet'))]
    p['vs3'] = VS3[name]
    return p


def refine(p, t, m, rate=0.8):
    """Multiplicative updates of each threshold towards the target rates."""
    def f(target, measured):
        if target is None or measured is None or measured <= 0.05 or target <= 0.05:
            return 1.0
        return max(0.5, min(2.0, (target / measured) ** rate))
    q = json.loads(json.dumps(p))
    for pos in POS:
        q['open'][pos] *= f(t.get(f'RFI_{pos}'), m.get(f'RFI_{pos}'))
        q['openLimp'][pos] *= f(t.get(f'OLimp_{pos}'), m.get(f'OLimp_{pos}'))
    q['behind'][0] *= f(t.get('IsoBehind'), m.get('IsoBehind'))
    q['behind'][1] *= f(t.get('LimpBehind'), m.get('LimpBehind'))
    q['bbIso'] *= f(t.get('IsoVsLimp(BB)'), m.get('IsoVsLimp(BB)'))

    def pair(key, rk, ck_t, ck_m, cap=1.0):
        r, c = q[key]
        r2 = min(cap, r * f(t.get(rk), m.get(rk)))
        width = (c - r) * f(ck_t, ck_m)
        q[key] = [r2, min(cap, r2 + max(0.0, width))]
    pair('vs1', '3Bet', t.get('ColdCall'), m.get('ColdCall'))
    call = lambda d: None if d.get('BBFold') is None else 100 - d['BBFold'] - d['BB3Bet']
    pair('bb', 'BB3Bet', call(t), call(m))
    pair('vs2', '4Bet', t.get('Call3Bet'), m.get('Call3Bet'))
    pair('vsIso', 'LimpReraise', t.get('LimpCallVsRaise'), m.get('LimpCallVsRaise'))
    return q


def rounded(p):
    def r(x):
        return round(x, 4)
    out = {}
    for k, v in p.items():
        if isinstance(v, dict):
            out[k] = {kk: r(vv) for kk, vv in v.items()}
        elif isinstance(v, list):
            out[k] = [r(x) for x in v]
        else:
            out[k] = r(v)
    return out


if __name__ == '__main__':
    mode = sys.argv[1]
    T = json.load(open(sys.argv[2]))
    if mode == 'init':
        res = {k: rounded(init(T[k], NOISE.get(k, 0.0), k)) for k in ORDER}
    else:
        P = json.load(open(sys.argv[3]))
        M = json.load(open(sys.argv[4]))
        res = {k: rounded(refine(P[k], T[k], M[k])) for k in ORDER}
    print(json.dumps(res, indent=1))
