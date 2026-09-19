#!/usr/bin/env python3
"""Rule 90 for check-push-lands.py.

P3 is the one to keep: it makes the guard count when it appears ANYWHERE in the
step rather than AFTER the loop. A guard before the loop verifies the previous
push, and every file in this repo would pass with the loops still silent.

Each mutation asserts its anchor is unique and applied before reporting a
verdict; NOT CAUGHT with nothing mutated is worse than no test.
"""
import subprocess, pathlib, sys

CHECK = pathlib.Path('scripts/check-push-lands.py')
SELF = [sys.executable, str(CHECK), '--self-test']

if subprocess.run(['git', 'diff', '--quiet', '--', str(CHECK)]).returncode != 0:
    print(f'FAIL — {CHECK} has unstaged changes; restore would lose them.'); sys.exit(1)
if subprocess.run(SELF, capture_output=True).returncode != 0:
    print(f'FAIL — {CHECK} --self-test is already red on clean source.'); sys.exit(1)
print(f'baseline: {CHECK} --self-test passes on clean source\n')

MUTATIONS = [
    ('P1 a loop is never unguarded',
     "    return bool(LANDED.search(run[end:]))",
     "    return True",
     'every loop reads as guarded and the check can never fail'),
    ('P2 only the one exact shape is a loop',
     r"LOOP = re.compile(r'for\s+\w+\s+in\s+[^\n;]*;\s*do(?P<body>.*?)\bdone\b', re.S)",
     r"LOOP = re.compile(r'for i in 1 2 3; do\n(?P<body>.*?)\ndone', re.S)",
     'the one-liner and push-then-pull variants stop being seen — the exact failure the sweep hit five times'),
    ('P3 a guard ANYWHERE in the step counts',
     "    return bool(LANDED.search(run[end:]))",
     "    return bool(LANDED.search(run))",
     'a guard BEFORE the loop verifies the previous push; every file passes with the loops still silent'),
    ('P4 zero loops reads as clean',
     "    if guarded + unguarded == 0:\n        return 'no-loops-found'",
     "    if guarded + unguarded == 0:\n        return 'all-guarded'",
     'a broken matcher reports a clean tree (an empty result is a failure, not a pass)'),
    ('P5 unguarded loops stop failing',
     "    if unguarded:\n        return 'unguarded'",
     "    if False:\n        return 'unguarded'",
     'the count is printed and the run still goes green'),
    ('P6 a push loop needs no break',
     "        if 'git push' in body and 'break' in body:",
     "        if 'git push' in body:",
     'ordinary loops containing a push are counted as retry loops and the numbers stop meaning anything'),
]

caught = 0
for name, anchor, repl, why in MUTATIONS:
    original = CHECK.read_text()
    hits = original.count(anchor)
    if hits != 1:
        print(f'FAIL       {name}\n            anchor matched {hits} times, expected 1 — NOTHING MUTATED.')
        continue
    CHECK.write_text(original.replace(anchor, repl))
    if CHECK.read_text() == original:
        print(f'FAIL       {name}\n            file unchanged — NOTHING MUTATED.')
        continue
    red = subprocess.run(SELF, capture_output=True).returncode != 0
    CHECK.write_text(original)
    print(f'{"CAUGHT    " if red else "NOT CAUGHT"} {name}\n            ({why})')
    caught += 1 if red else 0

print(f'\n{caught} of {len(MUTATIONS)} mutations caught.')
print('COVERAGE: the three pure predicates via --self-test. It does NOT re-run the')
print('live repo scan, the YAML parse, or the unreadable-workflow path.')
sys.exit(0 if caught == len(MUTATIONS) else 1)
