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
    # The .txt arm of the regenerated list had never been exercised until the
    # check grew a fixture for it. An untested arm of a list that decides what
    # gets overwritten is the same class of gap as an untested retry loop.
    dict(name='R6  the regenerated list loses its .txt arm',
         anchor='    outbox/*-latest.json|outbox/*-latest.txt) return 0 ;;',
         replace='    outbox/*-latest.json) return 0 ;;',
         expect='a -latest.txt conflict resolves too'),

    # The exit at the bottom had never run. Without it the loop would fall off
    # the end and report success after failing every attempt.
    dict(name='R7  exhausting every attempt reports success',
         anchor='echo "exhausted $ATTEMPTS attempts"\nexit 1',
         replace='echo "exhausted $ATTEMPTS attempts"\nexit 0',
         expect='a push refused forever exhausts the attempts and fails'),
    # A shared loop that stamps its own name erases which workflow wrote a row.
    dict(name='R8  the shared loop stamps its own name on every commit',
         anchor='git config user.name "${PROBE_AUTHOR_NAME:-reusable-probe-bot}"',
         replace='git config user.name "reusable-probe-bot"',
         expect="the caller's identity is used when given"),
    # Widening a narrow caller sweeps outbox/.drive-uploaded into its commit —
    # the appended ledger this loop refuses to auto-resolve. The staging
    # parameter exists to prevent exactly that.
    dict(name='R9  the staging parameter is ignored and outbox/ is always staged',
         anchor='LC_ALL=C git add -- "$p" 2>"$err"',
         replace='LC_ALL=C git add -- outbox/ 2>"$err"',
         expect='a narrow PROBE_PATHS stages only that file'),

    # A single unquoted default would stage one path and silently drop the rest.
    dict(name='R10 several paths collapse to the first',
         anchor='PATHS=(${PROBE_PATHS:-outbox/})',
         replace='PATHS=("${PROBE_PATHS:-outbox/}")',
         expect='several paths stage together, including outside outbox/'),

    # THE DEFECT FOUND 2026-11-18, restored: an add that fails is read as an empty
    # index and reported as "nothing to commit", exit 0, with the log never pushed.
    dict(name='R11 a failed git add is swallowed again',
         anchor="""    echo "git add failed for $p for a reason that is not an empty pathspec; not reporting 'nothing to commit'"
    exit 1""",
         replace="""    echo "git add failed for $p, carrying on"
    continue""",
         expect='a git add that fails (a held index.lock) is a failure, not nothing to commit'),

    # The other direction: git add exits 128 on a pathspec that matches nothing,
    # and 74 workflows rely on that being a clean exit when their earlier step
    # wrote no file. A guard that fails on every add error breaks them all.
    dict(name='R12 an empty pathspec is treated as a failure',
         anchor="""    if grep -q 'did not match any files' "$err"; then""",
         replace="""    if false; then""",
         expect='a pathspec that matches nothing is not a failure'),

    # git stages NOTHING when any one pathspec fails, so adding every path in one
    # call strands the file that exists. Joining the paths into one pathspec is the
    # same shape: it matches nothing and the file that does exist stays behind.
    dict(name='R13 the paths are added as one pathspec again',
         anchor='for p in "${PATHS[@]}"; do',
         replace='for p in "${PATHS[*]}"; do',
         expect='and does not strand the one that exists'),

    # The empty-pathspec test reads git's English message. A localised git would
    # print something else, the test would miss it, and every caller whose earlier
    # step wrote no file would fail. LC_ALL=C is what prevents that.
    dict(name='R14 the add no longer forces the C locale',
         anchor='LC_ALL=C git add -- "$p" 2>"$err"',
         replace='git add -- "$p" 2>"$err"',
         expect='a localised git does not turn an empty pathspec into a failure'),

    # A skip that stops at the first miss passes the present-first case and strands
    # every path after an absent one.
    dict(name='R15 the skip of an empty pathspec stops the loop instead of continuing',
         anchor="""      echo "nothing matched $p; skipping it"
      continue""",
         replace="""      echo "nothing matched $p; skipping it"
      break""",
         expect='and both present files are committed'),

    # git's own words are the only way an operator sees a skipped directory.
    dict(name='R16 git stderr is printed only when the add fails',
         anchor="""  cat "$err"
  if [ "$rc" -ne 0 ]; then""",
         replace="""  if [ "$rc" -ne 0 ]; then
    cat "$err\"""",
         expect="a successful add's warnings are still printed"),

    # A mis-set variable that splits into nothing runs no add at all.
    dict(name='R17 an empty path list is allowed',
         anchor='if [ "${#PATHS[@]}" -eq 0 ]; then',
         replace='if false; then',
         expect='a PROBE_PATHS of only whitespace is a failure, not nothing to commit'),

    # The commit was the unchecked line two below the add.
    dict(name='R18 a refused commit falls through to the push',
         anchor="""if ! git commit -m "$MESSAGE"; then
  echo "git commit failed; nothing was pushed"
  exit 1
fi""",
         replace="""git commit -m "$MESSAGE\"""",
         expect='a git commit that is refused is a failure'),
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
