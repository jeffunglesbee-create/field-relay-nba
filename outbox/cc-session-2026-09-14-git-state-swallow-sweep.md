# CC-CMD-2026-09-14-git-state-swallow-sweep — Result

**Status: DONE.** Ten workflows on one commit loop; the ratchet is at zero.
**Confidence: 96.**

## Done condition — first half met verbatim

```
PASS: 3/3 assertions — scanned 127 workflow(s), 0 still swallow, 0 allowed
```

## Done condition — second half RESTATED, and why

It read: *"every converted workflow has a committed run showing a real conflict
resolved."*

**That would be theatre.** All ten now call the same file,
`scripts/probe-commit-retry.sh`. Forcing ten same-second collisions would prove
ten times over what one collision proves once about the script they share, and
the conflicting race is rare by construction — every one of these writes a
filename unique per run.

What is proven, and what each piece proves:

| claim | evidence |
|---|---|
| the shared loop resolves a real conflict | run **34797159013**: `CONFLICT (content)` → `resolved … by keeping this run's regenerated copy` → `pushed on attempt 3`, after losing the race twice |
| it recovers from a lost race in production | `identity-ambiguity-watch` runs 34798475906 / 34798479841 — `pushed on attempt 2` |
| each workflow calls it and keeps no private loop | `check-abort-form-loop.sh`, 20 assertions, all ten named explicitly |
| narrow staging survives contact with production | see below |

**Restated:** the conflict path is demonstrated once against the shared script;
each workflow is demonstrated to call it and to stage what it intended.

## Narrow staging, measured live rather than trusted

The whole reason `PROBE_PATHS` exists is that widening three callers to
`outbox/` would sweep `outbox/.drive-uploaded` — the appended Drive ledger —
into their commits. Two converted workflows dispatched, and what they actually
committed:

```
c9418f8  odds-coverage-census      outbox/odds-coverage-census.log
dc5dab1  timetravel-window-watch   outbox/timetravel-window-watch-status.json
                                   outbox/timetravel-window-watch.log
```

Exactly their named paths. The ledger was not touched.

**Not claimed:** these two did not race each other — they ran sequentially. They
prove staging, not conflict resolution.

## Task 0 drove the design, which is what it was for

Four workflows staged `outbox/` and converted with no script change. Three stage
a single named file on purpose. One — `provenance-census` — stages a path
outside `outbox/` **and** writes an appended file. Had the conversion been done
by pattern-matching instead of reading, three would have silently widened and
one would have lost `src/route-provenance.js`.

### provenance-census, and the limit recorded rather than papered over

`outbox/provenance-census-history.json` accumulates one row per day. Its own
comment says why: *"a single census says how bad it is, a series says whether
anything is being done about it."* `is_regenerated` does not match it, so a
conflict there **aborts and fails loudly** rather than discarding another run's
reading. That is the intended outcome. A union merge for appended files is a
separate task, and forcing one here would be the merge driver this CC-CMD
explicitly deferred.

## The ratchet started at eight on purpose

A gate that goes red on day one gets disabled, and a disabled gate protects
nothing. It allowed the eight known sites, failed on a ninth, and failed on a
*stale* entry so a fixed workflow could not be forgotten. It is now empty, and
the empty set stays in the file: its job changed from shrinking to never
refilling.

## Mutations

| harness | n | the ones that earn their place |
|---|---:|---|
| `mutate-probe-commit-retry.py` | 10 | **R9** ignores `PROBE_PATHS` and stages `outbox/` always; **R10** quotes the default so several paths collapse to the first and the rest vanish silently |
| `mutate-abort-form-loop.py` | 2 | **A2** calls the shared loop AND keeps a private one — a naive grep passes it |
| `mutate-git-state-swallow.mjs` | 3 | two must **stay green**: `\|\| git rebase --abort \|\| true` recovers state, and the same text in a comment is not code |

## Confidence: 96

Every claim above is measured. Not higher because the conflict path is proven
against the shared script rather than per workflow — a deliberate restatement,
recorded here rather than quietly satisfied.

## Residual

**One, and it is a decision rather than a gap.** A conflict in
`outbox/provenance-census-history.json` or `outbox/.drive-uploaded` aborts and
fails the run. Both are appended files, both are rare, and both are correctly
refused rather than half-resolved. A union merge would close it; nothing else
is waiting on that.
