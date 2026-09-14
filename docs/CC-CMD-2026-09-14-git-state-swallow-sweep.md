# CC-CMD-2026-09-14 — eight workflows still hide a failed pull behind `|| true`

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
