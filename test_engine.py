"""Engine tests — hand bucketing, textures, and full flow."""
from treys import Card
from engine.abstraction import classify_hand, BUCKETS
from engine.postflop import classify_texture, get_strategy, get_correct_actions, TEXTURES

failures = []

def test(label, hand_strs, board_strs, expected_bucket, expected_texture=None):
    hand = [Card.new(c) for c in hand_strs]
    board = [Card.new(c) for c in board_strs]
    tex = classify_texture(board)
    bkt = classify_hand(hand, board, tex)
    ok = True
    notes = []
    if expected_texture and tex != expected_texture:
        notes.append(f"tex: got {tex}, want {expected_texture}")
        ok = False
    if bkt != expected_bucket:
        notes.append(f"bkt: got {bkt}, want {expected_bucket}")
        ok = False
    status = "PASS" if ok else "FAIL"
    detail = f"  ({', '.join(notes)})" if notes else ""
    print(f"  [{status}] {label:45s} tex={tex:10s} bkt={bkt:12s}{detail}")
    if not ok:
        failures.append(label)


print("=== TEXTURES ===")
test("AKQ rainbow = high_dry",          ["2s","3h"], ["Ac","Kd","Qh"],  "air",       "high_dry")
test("753 rainbow = low_dry",           ["2s","4h"], ["7c","5d","3h"],   "draw",      "low_dry")
test("3 hearts = monotone",             ["Ah","5h"], ["Kh","9h","2h"],   "premium",   "monotone")
test("AA3 = paired",                    ["Ks","Qh"], ["Ac","Ad","3h"],   "weak_made", "paired")
test("JT9 two-tone conn = wet",         ["Qs","Qh"], ["Jc","Tc","9h"],  "good",      "wet")

print("\n=== PREMIUM ===")
test("AA top set on AK7 dry",           ["As","Ah"], ["Ac","Kd","7h"],  "premium",   "high_dry")
test("Nut flush (Ace-high)",            ["Ah","5h"], ["Kh","9h","2h"],  "premium",   "monotone")
test("Full house",                      ["Ks","Kh"], ["Kd","7s","7h"],  "premium",   "paired")
test("Quads",                           ["9s","9h"], ["9d","9c","3h"],  "premium")
test("Top set on low dry (777)",        ["7s","7h"], ["7d","5c","2h"],  "premium",   "low_dry")

print("\n=== NUT ===")
test("Bottom set on AK7 dry",           ["7s","7h"], ["Ac","Kd","7d"],  "nut",       "high_dry")
test("Top set on 987 (connected wet)",  ["9s","9h"], ["9d","8c","7c"],  "nut",       "wet")
test("K-high flush",                    ["Kh","3h"], ["Ah","9h","2h"],  "nut",       "monotone")
test("Top two pair AK on AK3",          ["As","Kh"], ["Ac","Kd","3h"],  "nut")
test("Combo draw (FD+gutshot)",         ["Ah","Th"], ["9h","7c","6h"],  "nut",       "wet")

print("\n=== STRONG ===")
test("KK overpair on J53",              ["Ks","Kh"], ["Jc","5d","3h"],  "strong")
test("TPTK AK on Kc52",                ["As","Kh"], ["Kc","5d","2s"],  "strong")
test("Low flush 8-high",               ["8h","3h"], ["Ah","9h","2h"],  "strong",    "monotone")
test("Bottom set on wet board",         ["7s","7h"], ["9d","8c","7d"],  "strong")
test("Trips on dry",                    ["Ks","5h"], ["5d","5c","2h"],  "strong",    "paired")

print("\n=== GOOD ===")
test("JJ overpair on 953 dry",          ["Js","Jh"], ["9c","5d","3h"],  "good",      "low_dry")
test("TT overpair on 853 dry",          ["Ts","Th"], ["8c","5d","3h"],  "good",      "low_dry")
test("QQ overpair on JT9 wet",          ["Qs","Qh"], ["Jc","Tc","9h"],  "good",      "wet")
test("Top two pair on wet",             ["Js","Th"], ["Jc","Tc","8h"],  "strong",    "wet")

print("\n=== MEDIUM ===")
test("99 overpair on 753",              ["9s","9h"], ["7c","5d","3h"],  "medium",    "low_dry")
test("TP weak kicker K4 on K52",        ["Ks","4h"], ["Kc","5d","2s"],  "medium")
test("Middle pair AJ on AJ3 (J=mid)",   ["Qs","Jh"], ["Ac","Jd","3h"],  "medium",   "high_dry")

print("\n=== DRAW ===")
test("Flush draw",                      ["Ah","5h"], ["Kc","9h","2h"],  "draw")
test("OESD (JT on 98x)",               ["Jh","Ts"], ["9c","8d","2h"],  "draw")

print("\n=== WEAK MADE ===")
test("Bottom pair 3x on AK3",           ["3s","5h"], ["Ac","Kd","3h"],  "weak_made", "high_dry")
test("Underpair 22 on AK3",            ["2s","2h"], ["Ac","Kd","3h"],  "weak_made", "high_dry")

print("\n=== WEAK DRAW ===")
test("Gutshot (A5 on 43x)",            ["Ah","5s"], ["4c","3d","8h"],  "weak_draw")
test("K-high overcard on low board",   ["Ks","5h"], ["9c","7d","2h"],  "weak_draw", "low_dry")

print("\n=== AIR ===")
test("Complete air",                    ["4s","2h"], ["Ac","Kd","9h"],  "air",       "high_dry")
test("Low cards no draw",              ["4s","2h"], ["Tc","8d","6h"],   "air")

# --- Strategy table coverage ---
print("\n=== STRATEGY COVERAGE ===")
total_entries = 0
for tex in TEXTURES:
    for bkt in BUCKETS:
        for pos in ["OOP", "IP"]:
            s = get_strategy(pos, tex, bkt, facing_bet=False)
            if s:
                total_entries += 1
        s = get_strategy("IP", tex, bkt, facing_bet=True)
        if s:
            total_entries += 1
print(f"  {total_entries} strategy entries loaded (135 possible)")

# --- Prob sums ---
print("\n=== PROB SUMS ===")
from engine.postflop import OOP_STRATEGY, IP_VS_CHECK, FACING_BET
bad_sums = []
for name, table in [("OOP", OOP_STRATEGY), ("IP", IP_VS_CHECK), ("FACING", FACING_BET)]:
    for key, strat in table.items():
        total = sum(strat.values())
        if abs(total - 1.0) > 0.01:
            bad_sums.append(f"{name} {key}: sum={total:.3f}")
if bad_sums:
    print(f"  BAD SUMS: {len(bad_sums)}")
    for b in bad_sums:
        print(f"    {b}")
else:
    print("  All probability sums = 1.0")

# --- Flask routes ---
print("\n=== FLASK ROUTES ===")
import json
from api.index import app
with app.test_client() as c:
    for route in ["/", "/preflop", "/postflop"]:
        r = c.get(route)
        print(f"  GET {route}: {r.status_code}")

    # Preflop answer
    r = c.post("/api/preflop/answer", data={
        "action": "raise", "type": "preflop_rfi", "position": "UTG",
        "hand_key": "AA", "correct_action": "raise",
        "range": json.dumps(["AA","KK"]), "range_size": "2", "streak": "0",
    })
    print(f"  POST /api/preflop/answer: {r.status_code}")

    r = c.post("/api/preflop/next", data={"streak": "1"})
    print(f"  POST /api/preflop/next: {r.status_code}")

    # Postflop answer
    r = c.post("/api/postflop/answer", data={
        "action": "bet_l", "position": "OOP", "hand_key": "AA",
        "bucket": "premium",
        "bucket_label": "Premium (top set dry, nut flush, full house+)",
        "texture": "high_dry",
        "texture_label": "High & dry",
        "strategy": json.dumps({"check": 0.40, "bet_m": 0.20, "bet_l": 0.40}),
        "correct_actions": json.dumps(["check", "bet_l"]),
        "action_labels": json.dumps({"check": "Check", "bet_m": "Bet 66%", "bet_l": "Bet 100%"}),
        "range_breakdown": json.dumps({}),
        "streak": "0",
    })
    print(f"  POST /api/postflop/answer: {r.status_code}")

    r = c.post("/api/postflop/next", data={"streak": "2"})
    print(f"  POST /api/postflop/next: {r.status_code}")


# --- Bucket distribution ---
print("\n=== BUCKET DISTRIBUTION (500 random hands) ===")
from collections import Counter
from treys import Deck
from engine.abstraction import classify_hand as ch
from engine.postflop import classify_texture as ct
dist = Counter()
for _ in range(500):
    d = Deck()
    h = d.draw(2)
    b = d.draw(3)
    t = ct(b)
    bkt = ch(h, b, t)
    dist[bkt] += 1
for bkt in BUCKETS:
    pct = dist.get(bkt, 0) / 5
    bar = "#" * int(pct)
    print(f"  {bkt:12s}: {dist.get(bkt, 0):3d} ({pct:4.1f}%) {bar}")

print(f"\n{'='*55}")
if failures:
    print(f"FAILED: {len(failures)} tests")
    for f in failures:
        print(f"  - {f}")
else:
    print("ALL TESTS PASSED")
