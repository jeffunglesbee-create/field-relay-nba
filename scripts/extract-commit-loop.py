#!/usr/bin/env python3
"""Print the commit-retry `run:` script of a workflow, verbatim.

EXTRACTED AT TEST TIME so the test drives the workflow's REAL text. A copy
pasted into a test proves only that the copy behaves; this repo has already been
bitten by a check that verified a re-implementation of the thing it named.
"""
import sys, yaml

path = sys.argv[1]
doc = yaml.safe_load(open(path, encoding='utf-8'))
found = []
for job in (doc.get('jobs') or {}).values():
    for step in (job.get('steps') or []):
        run = step.get('run')
        if isinstance(run, str) and 'git push' in run and 'for i in' in run:
            found.append(run)
if len(found) != 1:
    print(f"expected exactly 1 commit-retry step in {path}, found {len(found)}",
          file=sys.stderr)
    sys.exit(2)
sys.stdout.write(found[0])
