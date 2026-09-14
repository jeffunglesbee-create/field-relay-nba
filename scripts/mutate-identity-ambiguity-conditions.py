#!/usr/bin/env python3
"""Rule 90 for scripts/identity_ambiguity_conditions.py.

A conditions module is exactly the kind of code that passes forever while
measuring nothing: every fixture green, every condition worded plausibly, and no
way to tell a condition that reads the response from one that returns a constant.
So each mutation below breaks one condition on purpose and the fixture check must
go red for THAT reason.

The harness asserts its own anchor is unique and applied before reporting
anything. NOT CAUGHT with no mutation applied is worse than no test.
"""
import os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'identity_ambiguity_conditions.py')
CHECK = os.path.join(HERE, 'check-identity-ambiguity-conditions.py')

MUTATIONS = [
    # The whole point of the restatement: a condition that cannot be met is not
    # a strict watch. Put the old wording back and the FIXED fixture — whose CFB
    # and NFL exposure is deliberately non-zero — must stop reaching all_done.
    dict(name='P1 old wording restored (CFB substituted_rows == 0)',
         anchor='''        ("no substituted name reaches another sport's club",
         d.get("cross_sport_reach_failures") == 0,''',
         replace='''        ("no substituted name reaches another sport's club",
         ((d.get("by_sport") or {}).get("CFB") or {}).get("substituted_rows") == 0,''',
         expect='every condition met, exposure unchanged'),
    # A condition hard-wired true reads identically to one that passes.
    dict(name='P2 reach condition always met',
         anchor='         d.get("cross_sport_reach_failures") == 0,',
         replace='         True,',
         expect='reach is the only open condition'),
    # Absence collapsed to zero (Rule 99). A relay too old to send the field
    # would then read as a relay with nothing left to fix.
    dict(name='P3 absence read as zero',
         anchor='         d.get("cross_sport_reach_failures") == 0,',
         replace='         (d.get("cross_sport_reach_failures") or 0) == 0,',
         expect='reach fields absent from the response'),
    # Same shape as P2, on the condition added hours later. Written because P2
    # had already proved this family of gap exists in this very file.
    dict(name='P5 collision condition always met',
         anchor='         d.get("same_slate_pair_collisions_with_odds") == 0,',
         replace='         True,',
         expect='a reachable collision is the only open condition'),
    # Rule 99 again, on the new field: a relay too old to send it must not read
    # as an archive with no collisions.
    dict(name='P6 collision absence read as zero',
         anchor='         d.get("same_slate_pair_collisions_with_odds") == 0,',
         replace='         (d.get("same_slate_pair_collisions_with_odds") or 0) == 0,',
         expect='collision field absent from the response'),

    # The narrowing is the point: a condition keyed back on the RAW count reads
    # OPEN on 115 collisions that cannot produce the fact it guards.
    dict(name='P8 the condition reverts to the raw collision count',
         anchor='         d.get("same_slate_pair_collisions_with_odds") == 0,',
         replace='         d.get("same_slate_pair_collisions") == 0,',
         expect='115 collisions, none of them reachable'),
    # The 11 are demoted, not deleted. If the readout stops printing them, a
    # TWELFTH ambiguous key arrives with nothing to notice it — which is the
    # actual risk of turning a condition into a readout.
    dict(name='P7 the demoted ambiguity count stops being printed',
         # Anchored on BOTH lines of the readout. Anchoring the first alone left
         # the count itself still printed by the second, and the mutation passed.
         anchor=(
             '              f"cross-sport ambiguity (not a condition): "\n'
             '              f"{t.get(\'ambiguous_key_count\')} keys claimed by two families \u00b7 "'
         ),
         replace='              f"cross-sport ambiguity: "',
         expect='summary omits'),
    # The exposure readout is the denominator the probe ran over. Drop it and a
    # reader sees a green condition with no idea what it covered (Rule 91).
    dict(name='P4 exposure readout dropped from the summary',
         anchor='              f"alias-table exposure (not a condition): {t.get(\'substituted_rows\')} "',
         replace='              f"" "" f"" "" f"" ',
         expect='summary omits'),
]

bad = 0
for m in MUTATIONS:
    before = open(SRC, encoding='utf-8').read()
    hits = before.count(m['anchor'])
    if hits != 1:
        bad += 1
        print(f"  ANCHOR  {m['name']}\n          anchor occurs {hits} time(s), expected 1. "
              f"NOTHING WAS MUTATED.", file=sys.stderr)
        continue
    after = before.replace(m['anchor'], m['replace'])
    assert after != before
    shutil.copy(SRC, SRC + '.bak')
    open(SRC, 'w', encoding='utf-8').write(after)
    try:
        r = subprocess.run([sys.executable, CHECK], capture_output=True, text=True)
        out = r.stdout + r.stderr
    finally:
        shutil.move(SRC + '.bak', SRC)
    if r.returncode == 0:
        bad += 1
        print(f"  NOT CAUGHT  {m['name']}\n          check still passed with the mutation applied",
              file=sys.stderr)
    elif not any(m['expect'] in l for l in out.splitlines() if l.startswith('FAIL')):
        bad += 1
        print(f"  WRONG REASON  {m['name']}\n          went red, but no FAIL line mentioned "
              f"\"{m['expect']}\".\n{out[:800]}", file=sys.stderr)
    else:
        print(f"  caught  {m['name']}\n          by \"{m['expect']}\"")

assert open(SRC, encoding='utf-8').read().count('cross_sport_reach_failures') >= 1, \
    'source not restored'
print(f"\nran {len(MUTATIONS)} mutation(s) against {os.path.basename(CHECK)}; "
      f"{os.path.basename(SRC)} restored clean")
sys.exit(1 if bad else 0)
