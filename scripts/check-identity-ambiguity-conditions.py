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
               "ambiguous_rows_with_odds": 363, "substituted_rows": 1551},
    "cross_sport_reach_probed": 94, "cross_sport_reach_failures": 94,
    "same_slate_pair_collisions": 0, "same_slate_pair_collisions_odds_disagree": 0,
    "same_slate_pair_collisions_inert": 0,
    "same_slate_pair_collision_coverage": "checked 3100 distinct join keys across 900 slates",
}
FIXED = {"coverage": "scanned 3191 of 3191 rows across 2 tables",
         "by_sport": {"CFB": {"substituted_rows": 14}, "NFL": {"substituted_rows": 6}},
         "ambiguous_keys": [],
         "totals": {"ambiguous_key_count": 0, "substituted_rows": 1551},
         "cross_sport_reach_probed": 94, "cross_sport_reach_failures": 0,
         "same_slate_pair_collisions": 0, "same_slate_pair_collisions_odds_disagree": 0,
         "same_slate_pair_collisions_inert": 0,
         "same_slate_pair_collision_coverage": "checked 3100 distinct join keys across 900 slates"}
# THE ONLY FIXTURE IN WHICH THE REACH CONDITION DECIDES THE ANSWER. Every other
# condition is met here, so all_done turns on that one alone. Without it, a reach
# condition hard-wired to True is indistinguishable from one that reads the
# response — mutation P2 walked straight through the other three fixtures,
# because in each of them something else was already open.
REACH_ONLY = {"coverage": "scanned 3191 of 3191 rows across 2 tables",
              "by_sport": {"CFB": {"substituted_rows": 14}, "NFL": {"substituted_rows": 6}},
              "ambiguous_keys": [],
              "totals": {"ambiguous_key_count": 0, "substituted_rows": 1551},
              "cross_sport_reach_probed": 94, "cross_sport_reach_failures": 3,
              "same_slate_pair_collisions": 0, "same_slate_pair_collisions_odds_disagree": 0,
              "same_slate_pair_collisions_inert": 0,
              "same_slate_pair_collision_coverage": "checked 3100 distinct join keys across 900 slates"}
# The mirror of REACH_ONLY, for the same reason: without it, a collision
# condition hard-wired to True is indistinguishable from one that reads the
# response, because every other fixture already has something else open.
COLLISION_ONLY = {"coverage": "scanned 3191 of 3191 rows across 2 tables",
                  "by_sport": {"CFB": {"substituted_rows": 14}, "NFL": {"substituted_rows": 6}},
                  "ambiguous_keys": [],
                  "totals": {"ambiguous_key_count": 11, "substituted_rows": 1551},
                  "cross_sport_reach_probed": 94, "cross_sport_reach_failures": 0,
                  "same_slate_pair_collisions": 2, "same_slate_pair_collisions_odds_disagree": 2,
                  "same_slate_pair_collisions_inert": 0,
                  "same_slate_pair_collision_coverage": "checked 3100 distinct join keys across 900 slates"}
# TWO absence fixtures, not one, and the reason is a defect this file already
# produced: with a single fixture missing BOTH new fields, collapsing either
# one's absence to zero left the other still open, all_done still False, and the
# check still green. Mutations P3 and P6 both walked through it. Each absence
# now gets a fixture where the OTHER condition is satisfied, so the missing
# field is the only thing deciding the answer.
REACH_ABSENT = {"coverage": "scanned 3191 of 3191 rows across 2 tables",
                "by_sport": {}, "ambiguous_keys": [],
                "totals": {"ambiguous_key_count": 11, "substituted_rows": 1551},
                "same_slate_pair_collisions": 0, "same_slate_pair_collisions_odds_disagree": 0,
                "same_slate_pair_collisions_inert": 0,
                "same_slate_pair_collision_coverage": "checked 3100 distinct join keys across 900 slates"}
COLLISION_ABSENT = {"coverage": "scanned 3191 of 3191 rows across 2 tables",
                    "by_sport": {}, "ambiguous_keys": [],
                    "totals": {"ambiguous_key_count": 11, "substituted_rows": 1551},
                    "cross_sport_reach_probed": 94, "cross_sport_reach_failures": 0}
# THE FIXTURE THE NARROWING IS FOR. 115 collisions, none of them able to reach
# the odds join: 82 cup rows that can never carry odds, plus a doubleheader.
# Under the raw count this reads OPEN forever; under the narrowed condition it is
# DONE, and the raw count is still printed in the readout.
INERT_ONLY = {"coverage": "scanned 3155 of 3155 rows across 2 tables",
              "by_sport": {"CFB": {"substituted_rows": 14}, "NFL": {"substituted_rows": 6}},
              "ambiguous_keys": [],
              "totals": {"ambiguous_key_count": 0, "substituted_rows": 1551},
              "cross_sport_reach_probed": 94, "cross_sport_reach_failures": 0,
              "same_slate_pair_collisions": 115,
              "same_slate_pair_collisions_odds_disagree": 0,
              "same_slate_pair_collisions_inert": 115,
              "same_slate_pair_collision_coverage": "checked 3024 distinct join keys across 625 slates"}
EMPTY = {}  # must not raise

CASES = [
    ("today, nothing fixed", TODAY, False),
    # THE FIXTURE THAT WOULD HAVE CAUGHT THE OLD WORDING. Its CFB and NFL
    # substituted_rows are NOT zero — 14 and 6, exactly as live — because the
    # shipped fix leaves them there deliberately. Under the conditions as first
    # written this fixture could never reach all_done, and the watch would have
    # reported OPEN for a defect that no longer existed.
    ("every condition met, exposure unchanged", FIXED, True),
    ("reach is the only open condition", REACH_ONLY, False),
    ("115 collisions, none of them reachable", INERT_ONLY, True),
    ("a reachable collision is the only open condition", COLLISION_ONLY, False),
    ("reach fields absent from the response", REACH_ABSENT, False),
    ("collision field absent from the response", COLLISION_ABSENT, False),
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
# THE FIXED 11 MUST STILL BE VISIBLE. They are no longer a condition, and the
# whole risk of demoting a number is that it stops being printed at all — after
# which a TWELFTH ambiguous key would arrive with nothing to notice it.
for needle in ["hullcity", "CFB", "NFL", "claimed by two families", "3191",
               "not a condition", "1551", "94", "12 keys"]:
    if needle in text:
        print(f"ok   summary names {needle}")
    else:
        fails += 1
        print(f"FAIL summary omits {needle}")

print(f"\n{'PASS' if not fails else 'FAILED: ' + str(fails)}"
      f" — {len(CASES)} fixtures, {len(evaluate(TODAY))} conditions each")
sys.exit(1 if fails else 0)
