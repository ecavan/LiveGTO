"""The 2026 Reg: halfway between the 2009 online regs and the 2019 pros.

The HandHQ hands are from 2009. Recreational players play much as they did then (live $1/$2 is
still loose-passive and limp-heavy), so the fish keep their real numbers. The regulars changed
most since solvers: wider 3-bets, no limping, more polarized betting. The Shark (the human pros
against Pluribus, 2019) and the Pro (Pluribus) are already from the solver era; the Reg is moved
halfway from the 2009 regs to the 2019 pros on every stat, so each number stays between two real
populations instead of being made up.

  python3 -I modern.py <targets.json> <sd_targets.json> <out targets.json> <out sd_targets.json>
"""
import json
import sys

T = json.load(open(sys.argv[1]))
SD = json.load(open(sys.argv[2]))
W = 0.5  # how far towards the pros


def blend(a, b):
    out = dict(a)
    for k, v in a.items():
        if isinstance(v, (int, float)) and isinstance(b.get(k), (int, float)) and not k.endswith('_n') and k != 'hands':
            out[k] = round((1 - W) * v + W * b[k], 1)
    return out


T['reg'] = blend(T['reg'], T['shark'])
T['_source']['reg'] = 'halfway between the 2009 HandHQ regs and the 2019 pros against Pluribus'
SD['reg'] = blend(SD['reg'], SD['shark'])
json.dump(T, open(sys.argv[3], 'w'), indent=1)
json.dump(SD, open(sys.argv[4], 'w'), indent=1)
