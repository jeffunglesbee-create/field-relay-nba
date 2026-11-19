# CC-CMD-2026-09-14 — eight workflows still hide a failed pull behind `|| true`

> **CLOSED 2026-09-14.** All eight converted; the ratchet reads
> `0 still swallow, 0 allowed`. The done condition's second half was restated —
> the conflict path is proven once against the shared script all ten now call,
> not ten times over. Result:
> `outbox/cc-session-2026-09-14-git-state-swallow-sweep.md`.

Filed per Rule 87.4 from `CC-CMD-2026-09-13-probe-commit-race-unrecoverable`,
which fixed this shape in `_reusable-probe.yml` and measured where else it lives.
Not deferred without a spec, and not silently folded into that CC-CMD's scope.

## Measured 2026-09-13

`grep -rn "pull --rebase --autostash.*|| true" .github/workflows/*.yml`, with the
recover-then-swallow form excluded:

```
brief-sport-authority-census.yml
codex-overwrite-diagnostics.yml
codex-queue-adjudicate.yml
codex-undetermined-watch.yml
odds-coverage-census.yml
provenance-census.yml
session-health-queue-probe.yml
timetravel-window-watch.yml
```

Two more — `collision-cleanup.yml` and `identity-ambiguity-watch.yml` — carry
`|| git rebase --abort || true`. That is a LESSER defect and deliberately not on
the list.

**MEASURED 2026-09-14, not asserted.** `scripts/check-abort-form-loop.sh`
extracts the real loop text from each YAML and races it. Both, for both
workflows:

```
ends on a branch, not detached          main
leaves no half-rebased tree             no
exits non-zero rather than succeeding   1
the losing run's content does NOT land  the other run's
```

So the exclusion is earned: it recovers state. **And the cost is larger than
"lesser defect" suggested** — the losing run fails and its artifact never lands.
For `identity-ambiguity-watch` that is a lost measurement, and a lost
measurement in a watch is exactly the failure the watch exists to prevent.

**AND THE URGENCY WAS OVERSTATED, corrected 2026-09-14 before acting on it.**
The conflicting race is not the shape these two can ordinarily produce. Both
write a filename unique per run, so the everyday race is a plain
non-fast-forward that the abort form replays cleanly — measured:

```
a race with no content conflict succeeds    rc 0
and this run's artifact lands               yes
```

A conflict needs two runs of the SAME workflow landing in the same second, which
produces the same filename with different content. Rare, and real: three probe
runs were dispatched within nine seconds on 2026-09-13.

**CONVERTED ANYWAY, 2026-09-14** — `scripts/probe-commit-retry.sh`, with
`PROBE_AUTHOR_NAME` so each keeps its own committing identity. Defence in depth
against a rare failure, not a live outage, and the doc says which.

Both are now off this CC-CMD's list. Remaining: the eight.

## Why it matters

`|| true` swallows the exit code but not the STATE. A content conflict leaves a
detached HEAD with unmerged files; every later push fails with "You are not
currently on a branch" and every later pull with "Exiting because of an
unresolved conflict". The remaining attempts are guaranteed failures with real
sleeps between them, and the run reports the symptom of its own damage rather
than the original race. Measured on runs 34737627491 and its NFL EPA sibling:
both probes succeeded, both runs concluded failure.

## Already held

`scripts/check-git-state-swallow.mjs` runs in `deploy.yml` as a RATCHET: the
eight above are allowed, a ninth fails the build, and a fixed workflow must be
removed from the list or the check goes red for a stale entry. So this cannot
get worse while it waits.

## Task 0 — DONE 2026-09-14. The artifact, and it changes Task 1.

Every one of the eight, read rather than assumed:

| workflow | stages | class | converts as-is? |
|---|---|---|---|
| `brief-sport-authority-census` | `outbox/` | REGENERATED (stamped json + rewritten log) | yes |
| `codex-overwrite-diagnostics` | `outbox/` | REGENERATED | yes |
| `codex-queue-adjudicate` | `outbox/` | REGENERATED | yes |
| `session-health-queue-probe` | `outbox/` | REGENERATED | yes |
| `codex-undetermined-watch` | `outbox/codex-undetermined-watch.log` | REGENERATED | **no — narrow staging** |
| `odds-coverage-census` | `outbox/odds-coverage-census.log` | REGENERATED | **no — narrow staging** |
| `timetravel-window-watch` | 2 named files | REGENERATED | **no — narrow staging** |
| `provenance-census` | 3 outbox files **+ `src/route-provenance.js`** | **MIXED — see below** | **no** |

Not one of the eight appends to a `.log`: every workflow writes with `>` or
`tee`, none with `>>`. Checked, because "log" reads like "appended" and the fix
differs.

### The one that is not like the others

**`outbox/provenance-census-history.json` IS APPENDED.**
`scripts/provenance-census.mjs:212-219` reads the file, drops today's row,
pushes a new one and rewrites — it accumulates a series across days, and its own
comment says why: *"a single census says how bad it is, a series says whether
anything is being done about it."*

Two runs racing across a day boundary each hold a different history, and
take-ours would discard the other's reading. `is_regenerated` in
`scripts/probe-commit-retry.sh` matches `outbox/*-latest.json`, which this file
is not, so the shared loop would refuse it and abort — **correct by
construction, and now confirmed rather than hoped.**

`provenance-census` also stages `src/route-provenance.js`, outside `outbox/`
entirely. The shared loop stages `outbox/` and would silently drop it.

### What that means for Task 1

**`scripts/probe-commit-retry.sh` needs a staging parameter before four of these
eight can convert.** Three stage a single named file deliberately, and widening
them to `outbox/` would sweep unrelated artifacts into their commits — including
`outbox/.drive-uploaded`, which is the appended ledger this whole CC-CMD exists
to protect. `provenance-census` needs that plus a path outside `outbox/`.

Four convert with no change at all.

## Tasks

0. ~~**Read each of the eight before changing it.**~~ **DONE — see above.** They do not all stage the same
   paths or write the same commit message, and two are not probes at all. **The
   artifact is a per-workflow line: what it stages, what message it commits, and
   whether any file it writes is APPENDED rather than regenerated.** The
   appended case exists in this repo — `outbox/.drive-uploaded` — and a
   take-ours applied to it discards another run's Drive deliveries.

1. **Convert the four whose staging already matches** — `brief-sport-authority-census`,
   `codex-overwrite-diagnostics`, `codex-queue-adjudicate`,
   `session-health-queue-probe`. No script change needed.

1b. **Give the script a staging parameter**, then convert the three that stage a
   single named file. Widening them to `outbox/` is not an option: it would
   sweep `outbox/.drive-uploaded` into their commits, which is the appended
   ledger this CC-CMD exists to protect.

1c. **`provenance-census` last, and possibly not at all.** It stages a path
   outside `outbox/` and writes an APPENDED history. Either the script grows
   both capabilities or this workflow keeps its own loop with the `|| true`
   replaced by an abort — **record which, and why**, rather than forcing it.

2. **Remove each converted workflow from `KNOWN`** in
   `scripts/check-git-state-swallow.mjs` in the same commit. The check fails on
   a stale entry, so this cannot be forgotten.

3. **Mutation (Rule 90).** For any workflow given a loop that is not the shared
   script, drive it through `scripts/check-probe-commit-retry.sh`'s harness or
   an equivalent. A retry loop that has only ever run unconflicted has proven
   nothing — which is how the original shipped.

4. **Outbox manifest** per Rule 67.

## Done condition

`scripts/check-git-state-swallow.mjs` reports `0 still swallow, 0 allowed`, and
every converted workflow has a committed run showing a real conflict resolved —
not "the loop looks right" (Rule 89).

## Not claimed

That the eight are the only sites. The grep covers `pull --rebase --autostash`;
a `git merge … || true` or a `git cherry-pick … || true` would not have matched
it, though the check's own pattern does cover those verbs going forward.

## Found and fixed 2026-11-18: `scripts/probe-commit-retry.sh` did not check its own `git add` or `git commit`

Status above is unchanged. One more instance of the class this CC-CMD closed, found by a read-only reviewer of the odds_history repoint workflow and built the same day under the owner's "Rule 42" order for the items recorded and not built. **This section replaces an earlier note of the same date that said the script is shared by "all ten" workflows and that the fix is a bare `git add ... || exit 1`. Both were untested premises and both were wrong:** 55 workflow files execute the script directly (43 with the default `outbox/`, 12 with explicit paths) and 19 more reach it through `_reusable-probe.yml`, 74 in all; and a bare `|| exit 1` would have turned a benign case red in every caller whose earlier step wrote no file, because `git add` exits 128 on a pathspec that matches nothing.

- **The defect.** The script runs under `set -uo pipefail` with no `-e`. Its `git add` was unchecked and the next test is `git diff --cached --quiet`, so any add that failed left an empty index and the script printed "nothing to commit", exited 0 and pushed nothing. Reproduced three ways on 2026-11-18, each against the unfixed script: a held `index.lock` with a real file present (exit 0, nothing pushed); two pathspecs of which one matches nothing (git stages NOTHING then, so the file that did exist stayed uncommitted, exit 0); and an explicitly ignored path (exit 0). A fourth, found by the review below: a refused `git commit` fell through to a push of the unchanged HEAD and printed "pushed on attempt 1".
- **The fix (committed with this note).** Each path is staged on its own under `LC_ALL=C`; a pathspec that matches nothing ("did not match any files") is skipped; every other add error exits 1 and names the path; git's own words are printed after every add, success included; a `PROBE_PATHS` that splits into nothing fails; a refused commit exits 1 before any push. The harness `scripts/check-probe-commit-retry.sh` went from 25 to 48 assertions (an index.lock, an ignored explicit path, an empty pathspec, an absent path first, in the middle and last, a successful add's warnings, a blank `PROBE_PATHS`, a refused commit, and a localised git through a `PATH` shim) and `scripts/mutate-probe-commit-retry.py` from 10 to 18 mutants, all caught for their named reason. Run against the unfixed script (`HEAD`'s copy), 14 of the 48 assertions go red and the original 25 still pass. The check now also runs in `guards.yml` (about 7 seconds), because it ran only in `deploy.yml` and `_reusable-probe.yml`, so an edit confined to `scripts/` was verified by nothing on the push that landed it.
- **Why the German.** The empty-pathspec test reads git's English message, so the add runs under `LC_ALL=C`. `de_DE.UTF-8` is not installed in the sandbox, so a mutant that asked for it changed nothing and was NOT caught; the harness uses a `git` shim that answers in German unless `LC_ALL=C`, which makes that dependency testable. German is arbitrary: any non-English text would do. It proves the script sets `LC_ALL=C` for the add, not that a real localised git honours it.
- **Four-lens review before the commit** (caller blast radius over 55 of 55 direct callers and 19 of 19 reusable callers, shell semantics, the harness, CI coverage and stale text): safe to ship or safe after fixes from all four, 0 blocks, 0 regressions. No currently-green caller turns red and none commits something different. Its gaps were closed in the commit: a successful add's stderr had been silenced, `continue` versus `break` was untestable (only the present-first order was tried), a whitespace-only `PROBE_PATHS` read as "nothing to commit", the refused commit above, a header that said THREE RULES over four, and the wrong counts.
- **Behaviour changes a caller could notice, none reachable today.** Several paths now commit the subset that exists (before, one missing path stranded all of them): the two multi-path callers are `provenance-census` (all four paths tracked, and it commits only after every producing step succeeded) and `timetravel-window-watch` (both tracked). An explicit path that git ignores now fails the script and commits nothing from that call; `.gitignore` has five patterns and none matches any caller's path (0 of 28 tracked matches ignored).
- **Found by the review, recorded, not built, each with its reason.** (1) The push-race test reads git's English text too and has no `LC_ALL=C`: it has never failed on a GitHub runner (C.UTF-8) and has no measured failure path, so it is left as it was. (2) `deploy.yml`'s "Commit results" swallows a failed add with `|| echo` and prints "Nothing to commit - no push needed." with exit 0: the same class, in the sole deploy path, outside this script. **BUILT 2026-11-19 (owner order "fix deploy.yml's swallowed add"), see the next section.** (3) `scripts/mutate-probe-commit-retry.py` rewrites the checked-in script in place and restores it in a `finally`; a kill skips the `finally` and leaves the mutated source and an untracked `.mutbak`: the other mutation harnesses in `scripts/` mutate copies, which is the safer pattern. (4) `timetravel-window-watch.yml` interpolates `${STATE}` into its commit message but defines it nowhere, so every subject ends empty. (5) With a narrow `PROBE_PATHS`, anything an earlier step pre-staged in the index is committed when every path is skipped. None has a demonstrated failure in a caller today.

## Found and fixed 2026-11-19: `deploy.yml`'s `Commit results` step swallowed a failed add and a refused commit

Status above is unchanged. Item (2) of the list the 2026-11-18 section recorded and did not build, built the next day on the owner's order "fix deploy.yml's swallowed add". The step is the last of the `verify` job in the sole deploy path (`.github/workflows/deploy.yml`).

- **The defect, as it stood in `HEAD`.** `git add outbox/live-verify-*.md || echo "(no live-verify artifact to stage)"` and the same for `health-sources`: any add failure (a held `index.lock`, an explicitly ignored artifact) was reported as "no artifact to stage". And `if ! git commit ...; then echo "Nothing to commit - no push needed."; exit 0; fi`: a refused commit (a hook, a missing identity) was reported as nothing to commit. Either way the step went green with the verification note never committed, which is what run 32659418899 did for the second artifact. The `|| echo` was the 2026-08-06 cure for a real problem (an unmatched glob aborts a `bash -e` step), so a bare `|| exit 1` was never an option: `git add` exits 128 on a pathspec that matches nothing, and stages NOTHING when any pathspec in the call fails.
- **The fix.** `stage()` runs one `LC_ALL=C git add -- "$@"` per glob (each glob in its own call, so an absent live-verify artifact cannot strand a present health-sources one). It skips only a call whose output says "did not match any files" and carries no `error: ` or `warning: ` line; any other failure prints git's own words and exits 1 naming the first path. The commit is now tested with `git diff --cached --quiet` (staged content, not tree state) and a refused `git commit` exits 1 before any push. The push-retry loop is unchanged (a lost race still warns and exits 0, a permission failure still exits 1).
- **Why one call per glob and not per file.** The first version staged each expanded path on its own. The review measured the real shape: the verify job checks out 412 `live-verify` and 195 `health-sources` artifacts, so that version ran 607 `git add` calls, about 4.4 s against 0.06 s for the old two calls, growing by two calls per deploy. The shell expands a glob to existing names only, so a single call per glob keeps every guarantee (an ignored artifact is named explicitly and still fails) at the old cost.
- **The check.** `scripts/check-deploy-commit-results.sh` extracts the step's own text from the workflow and runs it under `bash -e` (what GitHub uses for a `run:` step with no `shell:`; seen in the log of a real verify job, run 44443119261, which also showed git 2.56.1 and a 2.2 s step) through real clones and a real bare remote: 59 assertions. Run against `HEAD`'s step, 13 of the 59 go red; against the fixed step, 0. The cases: no artifact; normal deploy; the real shape (old artifacts tracked); every glob staged; a name with a space; a held `index.lock`; an ignored first and second artifact (fails closed); a refused commit; a localised git (a `PATH` shim that answers in German unless `LC_ALL=C`); a no-match arriving with a warning line, with an error line, and with only a hint; a stray untracked file with no artifact; a writer ahead; a modified tracked file plus a writer ahead; a push rejected twice and then landing; every retry lost; and each of the five permission words on its own. It also asserts the step's keys (`name` and `run` only, wherever they sit) and the `verify` job's header keys (no `continue-on-error`, `if`, `defaults`).
- **The mutants.** `scripts/mutate-deploy-commit-results.py`: 30 mutants of the step (D1 to D26), each a plausible regression or a restoration of the old defect, each caught for the reason it names, each run on a temp copy so the real deploy workflow is never rewritten. Plus three tests of the check's own safety: H1 (without the line that unsets every `GIT_*` variable, a hostile environment leaks into the check), H2b (without its guards the check runs the step in the caller's repository: 8 commits pushed to a throwaway origin) and H2a (with them it exits 2 and pushes nothing). The whole harness runs under a hostile git environment on purpose. The 19 mutants of the first version were the ones I could think of; the review wrote five more that the check did not catch, and the check, not the mutants, was wrong each time.
- **`guards.yml` runs the check (about 3 s) and `--anchors-only`** (every mutant anchor still occurs exactly once in `deploy.yml`; broken on purpose first: two stale anchors printed `2 STALE` and exited 1). `deploy.yml` does not trigger on its own edit (`paths: src/**, wrangler.toml, workers/**`), so `Repo guards` is where an edit to this step is verified. The mutants (about 4 minutes) run in no workflow.
- **Three-lens review before the commit (shell semantics, the check and harness, blast radius): no bug the change adds; one important gap in my check and several smaller ones, all fixed in the commit.** Important: a step-level key written AFTER the `run:` block was never read, so a trailing `continue-on-error: true` passed 47/47 and would have turned every loud failure above back into a green run. The smaller ones: the per-file loop above; the check was not hermetic (this sandbox exports `GIT_CONFIG_COUNT=3`, and a leaked `GIT_AUTHOR_NAME` let a mutant that changes the identity pass); a failed clone would have run the step in the CALLER's repository and pushed with its credentials (reproduced: 8 commits pushed to a throwaway origin); the assertion "does not claim there was no artifact" could not fail for the original text (its substring was `no artifact to stage`, the original said `no live-verify artifact to stage`); an unquoted `"$@"` and five other regressions (error-only no-match, a porcelain test, a loop that does not stop after the push, each permission word, `--autostash`) passed the check; the extractor took the first step with that name in the file rather than the one in `verify`; and the coverage line said less than it claimed.
- **Premises the review refuted, so they are not carried:** `exit 1` inside the function does end the step; `continue` and `return` inside a case inside a loop inside a function behave; `rc=0; out="$(...)" || rc=$?` keeps the status under `-e`; a spaced or bracketed file name reaches git whole; nested paths do not match the shell glob; the comment's claim that a failed pathspec stages nothing is true; the extracted text equals PyYAML's parsed `run:`; no other step in the job stages anything; `.gitignore` has five patterns and none touches `outbox/`; and 15 gate scripts that read `deploy.yml` give identical exit codes on the old and the new file.
- **A behaviour change the owner should know about, not a defect.** A real add or commit error now turns the `verify` job red, and `verify` runs after `deploy`, so the whole Deploy run reads `failure` after a green deploy. Three `workflow_run` probes (`game-thread-ws-probe.yml`, `provenance-runtime-probe.yml`, `nfl-epa-route-probe.yml`) require the run to have concluded `success`, so they are SKIPPED, not failed, and nothing reports the skip; and `scripts/watch-undeployed-src.mjs` takes the newest run that concluded `success`, so it would call every `src/**` commit since then `undeployed`. It is not reachable today: 0 of 412 tracked `live-verify` and 0 of 195 `health-sources` artifacts are ignored, both are always written by earlier steps in the same job, and a fresh checkout has no hooks. It is the same trade the 2026-07-31 split of `rule90-staleness-monitor.yml` out of `verify` made the other way for a different reason (a failure there is not a deploy failure). The owner ordered the fix, so the step fails; if a red verification note should NOT disable the probes, the way out is to move the commit into its own job and a second workflow, not to swallow the error again.
- **Recorded, not built, each with its reason.** (1) The step's `PUSH_LOG` is a fixed `/tmp/verify-push.log`, so two runs of the check at once share it, and a stale line from the other run can flip a lost-race case to the permission path: pre-existing, outside the order, only a developer running the harness during the check could hit it. (2) The skipped empty-glob case still prints git's `fatal: pathspec ... did not match any files` into a green step: it is the evidence the classifier acts on, and it is not reachable in the real checkout, where the globs always expand to tracked files. (3) The shared script's substring classifier (`scripts/probe-commit-retry.sh`) shares one weakness with this step: a no-match that arrives with an unreadable-directory message is judged by the `error:`/`warning:` lines, which a hosted runner cannot produce (it runs as an owner of its own checkout).
- **Runner git, VERIFIED 2026-11-19.** The check ran on 2.43.0 here (the sandbox's proxy blocks a newer git) and then on the runner: `Repo guards` run 44447582817 (push of `f699ca6` and `1bb8b9b`), step "the deploy workflow's Commit results step fails loudly on a real add or commit error", `PASS: 59/59 assertions`, COVERAGE line `on git 2.56.1`, 0 FAIL lines; the anchors-only step read `30 of 30`. So the no-match wording, its exit code 128 and the `error:`/`warning:` handling are observed on 2.56.1 in real clones, not only read. (Read from the saved job log by searching it for the COVERAGE, PASS, anchors and FAIL lines, not by reading all 4,851 lines.)
- **NOT verified, and the reason it is not.** The first real execution of the fixed step with the runner's checkout (shallow, `fetch-depth: 200`) and token: see STAGED below. A 403 on the push is simulated by a pre-receive hook, and a permission-denied directory cannot be made as root.
- **STAGED: the fixed `Commit results` step on a real deploy.** What is staged: the step as committed, verified locally against real clones and by `Repo guards`. Blocked by: `deploy.yml`'s `paths` filter (`src/**`, `wrangler.toml`, `workers/**`), so a push that edits only the workflow does not deploy; a deploy cannot be dispatched without the owner's order. Unblocked when: the first push that touches `src/**` or `wrangler.toml` deploys. Verify: the Deploy run that follows concluded `success`, its `verify` job's `Commit results` step concluded `success`, and that step's log contains `Pushed verification note on attempt 1.` (or `attempt N` after a lost race), contains no `::error::`, and shows the commit on `main` with subject `chore: post-deploy live verification` carrying two files. A scheduled read of exactly that is armed: `trig_013uHQASMQUZkuX8ciwEnw1A` (2026-11-19 21:00Z; re-arms daily up to 3 times while no such run exists).
