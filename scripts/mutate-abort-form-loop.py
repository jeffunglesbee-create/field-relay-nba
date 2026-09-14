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
    # The exclusion rests entirely on the abort. Remove it and the workflow is
    # the plain `|| true` defect, which this check must refuse to vouch for.
    dict(name='A1  the watch loses its rebase --abort',
         anchor='git pull --rebase --autostash origin main || git rebase --abort || true',
         replace='git pull --rebase --autostash origin main || true',
         expect='no longer uses the abort form'),

    # If the step stops being findable the check must fail, not silently vouch
    # for zero workflows.
    dict(name='A2  the commit-retry step disappears',
         anchor='          for i in 1 2 3; do\n            if git push; then exit 0; fi',
         replace='          for i in 1 2 3; do\n            if true; then exit 0; fi',
         expect='a commit-retry step could be extracted'),
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
