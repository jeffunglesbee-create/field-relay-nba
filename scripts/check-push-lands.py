#!/usr/bin/env python3
"""Every push-retry loop must be followed by a check that the push landed.

WHY THIS EXISTS, from 107 committed instances across four repos.

    for i in 1 2 3; do
      git pull --rebase --autostash origin main && git push origin main && break
      sleep $((i * 5))
    done

When every attempt fails the loop's last command is `sleep`, so the loop exits
0, the step is GREEN, and the artifact is silently lost. `set -e` does not catch
it: a failing `&&` list is a tested command, so -e is suppressed. Measured under
the exact Actions shell (bash -e -o pipefail) -> exit 0.

Found because a session's own ad-hoc push printed "PUSHED" after four failed
attempts. The same shape was already committed 23 times here, 82 in
jubilant-bassoon, 3 in field-laboratory.

THE SWEEP FOUND FIVE VARIANTS BY REFUSING TO GUESS. A 4-attempt loop, a
different sleep multiplier, a one-liner, an `echo "retrying..."` between push
and sleep, and one file that pushes first and pulls last. A looser matcher would
have half-matched and mangled them. A sixth variant will arrive the same way —
someone copies a workflow — which is what this check is for.

IT DOES NOT CHECK THE SHAPE OF THE LOOP. It checks that a landing verification
follows it. That is deliberate: policing loop shapes means enumerating them, and
the enumeration is exactly what proved incomplete five times.

READ-ONLY. Parses workflow YAML; runs nothing.
"""
import sys, re, glob, pathlib

# A push-retry loop: a `for` loop whose body pushes and breaks. Shape-agnostic
# on purpose — see the header.
LOOP = re.compile(r'for\s+\w+\s+in\s+[^\n;]*;\s*do(?P<body>.*?)\bdone\b', re.S)
LANDED = re.compile(r'merge-base\s+--is-ancestor|rev-parse\s+HEAD.*rev-parse\s+origin')

def loop_spans(run):
    """(start, end) of every push-retry loop in a run block."""
    out = []
    for m in LOOP.finditer(run or ''):
        body = m.group('body')
        if 'git push' in body and 'break' in body:
            out.append((m.start(), m.end()))
    return out

def guarded_after(run, end):
    """Is there a landing check AFTER this loop — not merely somewhere in the
    file? A guard before the loop verifies the previous push, not this one."""
    return bool(LANDED.search(run[end:]))

def scan(text):
    """-> (guarded, unguarded, loops) for one workflow's YAML text."""
    import yaml
    doc = yaml.safe_load(text)
    guarded = unguarded = 0
    details = []
    for jname, job in ((doc or {}).get('jobs') or {}).items():
        for step in (job.get('steps') or []):
            run = step.get('run')
            if not isinstance(run, str):
                continue
            for (s, e) in loop_spans(run):
                if guarded_after(run, e):
                    guarded += 1
                else:
                    unguarded += 1
                    details.append(f"{jname} / {step.get('name', '(unnamed step)')}")
    return guarded, unguarded, details

def verdict(guarded, unguarded, parsed):
    # An empty result is a FAILURE, not a pass: zero loops across a repo that
    # demonstrably has them means the matcher broke, not that the tree is clean.
    if parsed == 0:
        return 'no-workflows-parsed'
    if guarded + unguarded == 0:
        return 'no-loops-found'
    if unguarded:
        return 'unguarded'
    return 'all-guarded'

if '--self-test' in sys.argv:
    bad = 0
    def one(label, got, want, why):
        global bad
        if got == want:
            print(f'  PASS  {label} -> {got!r}  ({why})')
        else:
            bad += 1; print(f'  FAIL  {label}: got {got!r} want {want!r}  ({why})')

    MULTI = ('git commit -m x\n'
             'for i in 1 2 3; do\n'
             '  git pull --rebase --autostash origin main && git push origin main && break\n'
             '  sleep $((i * 5))\n'
             'done\n')
    one('an unguarded loop is found', len(loop_spans(MULTI)), 1, 'the 2026-09-19 shape, 107 instances')
    one('and it reads as unguarded', guarded_after(MULTI, loop_spans(MULTI)[0][1]), False,
        'nothing after the loop verifies the push landed')

    FIXED = MULTI + 'git fetch -q origin main\ngit merge-base --is-ancestor HEAD origin/main || exit 1\n'
    one('the guard after it is seen', guarded_after(FIXED, loop_spans(FIXED)[0][1]), True, 'the applied fix')

    BEFORE = ('git merge-base --is-ancestor HEAD origin/main || exit 1\n' + MULTI)
    one('A GUARD BEFORE THE LOOP DOES NOT COUNT', guarded_after(BEFORE, loop_spans(BEFORE)[0][1]), False,
        'it verifies the PREVIOUS push; position is the whole point')

    ONELINE = 'for i in 1 2 3; do git pull && git push origin main && break; sleep 5; done\n'
    one('the one-liner variant is found', len(loop_spans(ONELINE)), 1,
        '12 files used it; a shape-specific matcher missed them')
    REVERSED = 'for i in 1 2 3; do\n  git push origin main && break\n  sleep 5\n  git pull\ndone\n'
    one('the push-then-pull variant too', len(loop_spans(REVERSED)), 1,
        'one file ends its loop with the pull; shape-agnostic detection is why')

    NOPUSH = 'for f in a b c; do\n  echo "$f"\ndone\n'
    one('an ordinary for loop is not a push loop', len(loop_spans(NOPUSH)), 0, 'push AND break are both required')
    NOBREAK = 'for i in 1 2; do\n  git push origin main\ndone\n'
    one('a loop with no break is not one either', len(loop_spans(NOBREAK)), 0, 'it is not a retry loop')

    one('zero loops is NOT clean', verdict(0, 0, 40), 'no-loops-found',
        'a repo that has them reporting none means the matcher broke (empty result = failure)')
    one('zero workflows is its own state', verdict(0, 0, 0), 'no-workflows-parsed', 'nothing was checked')
    one('one unguarded fails the run', verdict(9, 1, 40), 'unguarded', 'a single silent loop is the defect')
    one('all guarded passes', verdict(10, 0, 40), 'all-guarded', 'the state after the sweep')

    print(f'\n{bad} FAILED' if bad else '\nself-test: 12/12')
    print('COVERAGE: three pure predicates over enumerated text. It does NOT parse')
    print('the repo, and it cannot see a push outside a `for` loop — a bare `git push`')
    print('fails under set -e on its own and is out of scope.')
    sys.exit(1 if bad else 0)

import yaml
files = sorted(glob.glob('.github/workflows/*.yml'))
G = U = parsed = 0
unreadable = []
rows = []
for f in files:
    try:
        g, u, det = scan(pathlib.Path(f).read_text())
    except Exception as e:
        unreadable.append(f'{f}: {e}'); continue
    parsed += 1; G += g; U += u
    for d in det:
        rows.append(f'{f}  ->  {d}')

print(f'=== push-retry loops land what they push ===\n')
print(f'  workflows parsed   : {parsed} of {len(files)}')
print(f'  loops GUARDED      : {G}')
print(f'  loops UNGUARDED    : {U}')
if unreadable:
    print(f'  unreadable         : {len(unreadable)}')
    for u in unreadable[:5]:
        print(f'      {u}')

v = verdict(G, U, parsed)
print(f'\n  verdict: {v}')
print(f'\nCOVERAGE: {parsed} workflow(s) parsed, {G + U} push-retry loop(s) found. It checks')
print('that a landing verification FOLLOWS each loop, not that the loop has any')
print('particular shape — five shapes were found by the 2026-09-19 sweep and a sixth')
print('is expected. A bare `git push` outside a loop is out of scope: it fails under')
print('set -e on its own.')

if v == 'unguarded':
    print(f'\nFAIL: {U} push-retry loop(s) with nothing after them that checks the push landed.')
    for r in rows:
        print(f'      {r}')
    print('      Add after the loop:')
    print('        git fetch -q origin main')
    print('        git merge-base --is-ancestor HEAD origin/main \\')
    print('          || { echo "FAIL: push did not land after retries"; exit 1; }')
    sys.exit(1)
if v in ('no-loops-found', 'no-workflows-parsed'):
    print(f'\nFAIL: {v} — this repo has push-retry loops, so finding none means the')
    print('      matcher stopped matching, not that the tree is clean.')
    sys.exit(1)
print(f'\nOK: all {G} push-retry loop(s) verify that the push landed.')
