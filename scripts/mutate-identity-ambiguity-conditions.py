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
