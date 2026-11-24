# Claude Code Command — `scripts/check-deploy-commit-results.sh` goes red when several copies run at once

**Repo:** field-relay-nba · **Branch:** main — commit directly, no feature branch or PR · **Type:** B (a check that fails without a defect in what it checks)
**Filed:** 2026-11-24, found while landing item 3 of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` (a whole-gate sweep of two trees ran at the same time; this check was
red on one of them and green on the other). **Status:** FILED, not dispatched. **Confidence gate:** >= 95 before any commit.

## What was measured (2026-11-24, this sandbox; no credits, no network)

- Alone, on either tree: `bash scripts/check-deploy-commit-results.sh` exits 0, 59 of 59 assertions, 5.8 to 6.9 s (6 runs).
- Eight copies at once, started together from one tree: main's tree 12 of 16 runs exit 1; the patched tree (main plus accounting-edges item 3) 17 of 24 exit 1.
- The assertions that fail are the lost-race cases: "a push that loses every retry warns and does not fail the run" (got 1, want 0), "and says so as a warning", and "a push rejected with
  'HTTP 403 from the proxy' / 'Authentication failed for the account' fails the step as a permission defect" (got 0, want 1). Output of the failing case contains
  `fatal: pathspec 'outbox/health-sources-*.json' did not match any files`.
- NOT identified: which shared resource the copies collide on. The script makes its own `mktemp -d` and unsets every `GIT_*` variable, so a fixed path is not the cause; a timing
  dependence (the step under test runs against real clones and a hook) is the guess and is untested.

## Why it matters

`guards.yml` runs it on every push, alone, on a runner, where it has been green; it went red here only because two sweeps overlapped. A check that can be made red by CPU load will one day
be red on a runner during a busy window and be read as a defect in `deploy.yml`'s Commit results step (Rule 77: the reader will investigate the step, not the check).

## Tasks (probe first, Rule 87)

1. **Probe:** run `for k in 1 2 3 4 5 6 7 8; do (bash scripts/check-deploy-commit-results.sh > /tmp/p-$k.log 2>&1; echo $k $?) & done; wait` and keep the failing logs. Then find the shared
   resource by running two copies and diffing what each reads and writes (`strace -f -e trace=file` or an `inotifywait` on `$TMPDIR`).
2. **Fix the cause in the check, not by retrying:** if it is shared state, make it per-copy; if it is a time window, make the window part of the case instead of the clock.
3. **Mutation first (Rule 90):** `scripts/mutate-deploy-commit-results.py` must still catch every mutant it catches today.

## Done condition (Rule 89)

```
for k in 1 2 3 4 5 6 7 8; do (bash scripts/check-deploy-commit-results.sh > /tmp/p-$k.log 2>&1; echo $?) & done; wait    # eight 0s; was 4 of 16 on main
python3 scripts/mutate-deploy-commit-results.py                                                                          # as many caught as before
```
Record both outputs in `outbox/`.
