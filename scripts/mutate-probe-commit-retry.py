#!/usr/bin/env python3
"""Rule 90 harness for scripts/check-probe-commit-retry.sh.

Each mutation is the retry loop as it could plausibly be written — including the
way it WAS written before 2026-09-13, which passed every run that never raced.
Asserts its anchor is unique and applied before printing any verdict.
"""
import os, shutil, subprocess, sys

SRC = 'scripts/probe-commit-retry.sh'
CHECK = 'scripts/check-probe-commit-retry.sh'
BAK = SRC + '.mutbak'

RECOVERY_BLOCK = """  if ! git pull --rebase --autostash "$REMOTE" "$BRANCH"; then"""

MUTATIONS = [
    # The inversion. During a rebase the replayed commit is "theirs"; picking
    # "ours" keeps the run that already pushed and looks like a clean pass.
    dict(name='R1  --theirs becomes --ours during the rebase',
         anchor='        git checkout --theirs -- "$f"',
         replace='        git checkout --ours -- "$f"',
         expect="the later run's content wins"),

    # THE ORIGINAL DEFECT, restored. `|| true` swallows the exit code but not
    # the state: the tree stays mid-rebase and every later push and pull fails.
    dict(name='R2  the 2026-09-13 shape restored: || true on the rebase',
         anchor=RECOVERY_BLOCK,
         replace="""  git pull --rebase --autostash "$REMOTE" "$BRANCH" || true
  if false; then""",
         # EXPECTED ON THE CONTENT ASSERTION, NOT THE EXIT CODE, and the reason
         # is a finding. Under the old shape this script exits 0: the rebase
         # leaves a detached HEAD at the OTHER run's commit, and
         # `git push origin HEAD:main` from there succeeds as a no-op. So the
         # old loop does not merely fail — it can report success while silently
         # discarding the probe result it was called to record.
         #
         # The live runs failed instead only because the workflow's bare
         # `git push` refuses a detached HEAD. Same corruption, louder symptom.
         expect="the later run's content wins"),

    # A permission failure retried five times is indistinguishable from a lost
    # race, which is the requirement the old comment claimed and did not meet.
    dict(name='R3  every push failure treated as a race',
         anchor="""  if ! grep -qE 'non-fast-forward|fetch first|Updates were rejected|behind its remote' "$err"; then""",
         replace='  if false; then',
         # The exit code alone cannot discriminate: without the guard the loop
         # still exits 1, just after five pointless retries and four sleeps. The
         # message is the only externally visible difference between "failed
         # because it lost a race" and "failed because the token is wrong",
         # which is the distinction the original comment claimed and the
         # original loop did not make.
         expect='and says so instead of retrying into silence'),

    # The ledger is in the same directory this step stages. Widening the
    # regenerated list to the directory discards another run's deliveries.
    dict(name='R4  the regenerated list widened to the whole outbox',
         anchor='    outbox/*-latest.json|outbox/*-latest.txt) return 0 ;;',
         replace='    outbox/*) return 0 ;;',
         expect='a conflict in the appended ledger fails rather than picking a side'),

    # Refusing is only half of it — refusing and walking away from a
    # half-rebased tree leaves the next run to fail on state it did not create.
    dict(name='R5  refusal stops cleaning up after itself',
         anchor="""        echo "conflict in $f is not a regenerated artifact; refusing to pick a side"
        git rebase --abort || true""",
         replace="""        echo "conflict in $f is not a regenerated artifact; refusing to pick a side\"""",
         expect='and leaves no half-rebased tree behind'),
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
    if after == before:
        bad += 1
        print(f"  NO EFFECT  {m['name']}", file=sys.stderr)
        continue
    shutil.copy(SRC, BAK)
    open(SRC, 'w', encoding='utf-8').write(after)
    try:
        r = subprocess.run(['bash', CHECK], capture_output=True, text=True)
        out = r.stdout + r.stderr
    finally:
        shutil.move(BAK, SRC)
    red = [l for l in out.splitlines() if l.startswith('FAIL')]
    if r.returncode == 0:
        bad += 1
        print(f"  NOT CAUGHT  {m['name']}\n          check still passed", file=sys.stderr)
    elif not any(m['expect'] in l for l in red):
        bad += 1
        print(f"  WRONG REASON  {m['name']}\n          no FAIL line mentioned \"{m['expect']}\"."
              f"\n" + "\n".join(red[:6]), file=sys.stderr)
    else:
        print(f"  caught  {m['name']}\n          by \"{m['expect']}\" ({len(red)} red)")

subprocess.run(['bash', '-n', SRC], check=True)
print(f"\nran {len(MUTATIONS)} mutation(s) against {CHECK}; {SRC} restored and parsing")
sys.exit(1 if bad else 0)
