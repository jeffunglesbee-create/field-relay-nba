#!/usr/bin/env python3
"""Rule 90 for scripts/identity_ambiguity_conditions.py.

Three fixtures, each asserting a different thing. The third is the one that
earns its place: a sport ABSENT from by_sport must not read as a sport with
nothing left to fix.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from identity_ambiguity_conditions import evaluate, render

TODAY = {  # measured live 2026-09-13, before any fix
    "coverage": "scanned 3191 of 3191 rows across 2 tables",
    "by_sport": {"CFB": {"substituted_rows": 14}, "NFL": {"substituted_rows": 6}},
    "ambiguous_keys": [{"key": "hullcity", "families": {
        "soccer": {"rows": 6, "names": ["Hull"]},
        "MLB": {"rows": 68, "names": ["Tigers"]}}}],
    "totals": {"ambiguous_key_count": 12, "ambiguous_rows": 636,
               "ambiguous_rows_with_odds": 363},
}
FIXED = {"coverage": "scanned 3191 of 3191 rows across 2 tables",
         "by_sport": {"CFB": {"substituted_rows": 0}, "NFL": {"substituted_rows": 0}},
         "ambiguous_keys": [], "totals": {"ambiguous_key_count": 0}}
ABSENT = {"coverage": "scanned 0 of 0 rows across 2 tables",
          "by_sport": {}, "ambiguous_keys": [], "totals": {"ambiguous_key_count": 0}}
EMPTY = {}  # must not raise

CASES = [
    ("today, nothing fixed", TODAY, False),
    ("every condition met", FIXED, True),
    ("CFB and NFL absent from by_sport", ABSENT, False),
    ("empty response", EMPTY, False),
]

fails = 0
for label, fixture, want in CASES:
    rows = evaluate(fixture)
    got = all(m for _, m, _ in rows)
    ok = got == want
    fails += 0 if ok else 1
    print(f"{'ok  ' if ok else 'FAIL'} {label}: all_done={got}, want {want}")
    for n, m, o in rows:
        print(f"        {'DONE' if m else 'OPEN'}  {n} -> {o}")

# The rendered summary must name every condition, or a reader sees a green run
# and infers more than it measured.
text = render(TODAY, evaluate(TODAY), "fixture")
for needle in ["hullcity", "CFB", "NFL", "ambiguous_key_count", "3191"]:
    if needle in text:
        print(f"ok   summary names {needle}")
    else:
        fails += 1
        print(f"FAIL summary omits {needle}")

print(f"\n{'PASS' if not fails else 'FAILED: ' + str(fails)}"
      f" — {len(CASES)} fixtures, {len(evaluate(TODAY))} conditions each")
sys.exit(1 if fails else 0)
