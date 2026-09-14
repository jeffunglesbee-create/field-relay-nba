#!/usr/bin/env python3
"""Rule 90 for scripts/check-abort-form-loop.sh.

That check VOUCHES for two workflows being excluded from the `|| true` ratchet.
A check that would keep vouching after the workflow changed is worse than none —
it would hold an exclusion open on a loop that no longer earns it.
"""
import shutil, subprocess, sys

CHECK = 'scripts/check-abort-form-loop.sh'
VICTIM = '.github/workflows/identity-ambiguity-watch.yml'
BAK = VICTIM + '.mutbak'

MUTATIONS = [
    # The conversion is the whole point. If a workflow stops calling the shared
    # loop the check must say so, not pass because nothing was left to race.
    dict(name='A1  the watch stops calling the shared loop',
         anchor='bash scripts/probe-commit-retry.sh "chore: identity ambiguity watch [skip ci]"',
         replace='git push',
         expect='no longer calls scripts/probe-commit-retry.sh'),

    # A workflow that calls the shared loop AND keeps a private one would pass
    # a naive grep while still carrying the defect.
    dict(name='A2  it calls the shared loop and keeps a private one too',
         anchor='          bash scripts/probe-commit-retry.sh "chore: identity ambiguity watch [skip ci]"',
         replace='          bash scripts/probe-commit-retry.sh "chore: identity ambiguity watch [skip ci]"\\n          for i in 1 2 3; do\\n            if git push; then exit 0; fi\\n            git pull --rebase --autostash origin main || git rebase --abort || true\\n          done\\n          exit 1'.replace('\\n', chr(10)),
         expect='still carries its own retry loop'),
]

bad = 0
for m in MUTATIONS:
    before = open(VICTIM, encoding='utf-8').read()
    hits = before.count(m['anchor'])
    if hits != 1:
        bad += 1
        print(f"  ANCHOR  {m['name']}\n          anchor occurs {hits} time(s), expected 1. "
              f"NOTHING WAS MUTATED.", file=sys.stderr)
        continue
    shutil.copy(VICTIM, BAK)
    open(VICTIM, 'w', encoding='utf-8').write(before.replace(m['anchor'], m['replace']))
    try:
        r = subprocess.run(['bash', CHECK], capture_output=True, text=True)
        out = r.stdout + r.stderr
    finally:
        shutil.move(BAK, VICTIM)
    red = [l for l in out.splitlines() if l.startswith('FAIL')]
    if r.returncode == 0:
        bad += 1
        print(f"  NOT CAUGHT  {m['name']}\n          check still vouched for it", file=sys.stderr)
    elif not any(m['expect'] in l for l in red):
        bad += 1
        print(f"  WRONG REASON  {m['name']}\n          no FAIL line mentioned \"{m['expect']}\"."
              f"\n" + "\n".join(red[:5]), file=sys.stderr)
    else:
        print(f"  caught  {m['name']}\n          by \"{m['expect']}\" ({len(red)} red)")

import yaml
yaml.safe_load(open(VICTIM, encoding='utf-8'))
print(f"\nran {len(MUTATIONS)} mutation(s) against {CHECK}; {VICTIM} restored and parsing")
sys.exit(1 if bad else 0)
