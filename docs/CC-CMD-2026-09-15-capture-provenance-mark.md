# CC-CMD-2026-09-15 — mark the run-clock captures, do not repair them

**Status:** BUILT, dry-run only. **The write is not authorised** and the
workflow will not perform it without the literal input `apply`.

## Why a mark and not a repair

58 archived closing lines carry a `captured_at` that is the worker's clock
rather than the snapshot the data came from. They predate `a1937eb`
(2026-08-22T21:11:07Z). The obvious repair — write the noon anchor instead —
was verified and refused (`outbox/captured-at-repair-verify-*.log`):

| | rows |
|---|---:|
| anchor changes nothing a consumer reads | **57** |
| anchor flips a kickoff verdict it cannot support | **1** |

```
EPL_2026-08-22_hull_manunited
  kickoff  2026-08-22T11:30Z
  stored   2026-08-22T10:00:37.362Z -> verified true
  anchor   2026-08-22T12:00:00Z     -> verified false
```

The endpoint serves the snapshot **at or before** noon, so the true capture sits
in a window ending at 12:00 and this match started at 11:30. Either verdict is a
guess. `servedAt` would settle it and was never stored.

**A better timestamp is not available. What IS knowable is the window.**

## What gets written

One additive key on the blob. `captured_at` unchanged, `_kickoff` unchanged
(1383 rows carry it; its contract is in CONTRACTS.md).

```json
"_capture": {
  "measured": false,
  "stored_is": "run-clock",
  "window_end": "2026-08-22T12:00:00Z",
  "kickoff_decidable": false
}
```

`kickoff_decidable` is the field that earns the mark: it is `false` exactly when
the match started before the window closed, which is the EPL row's state and is
sayable without overwriting anything.

## Pieces

| file | what it is |
|---|---|
| `src/odds-capture-provenance.js` | the rule, pure. 29 assertions, 12 mutations, all caught |
| `scripts/run-capture-provenance-mark.mjs` | the executor. **Dry run unless `--apply`**, and its `d1()` refuses a non-SELECT in dry run |
| `.github/workflows/capture-provenance-mark.yml` | runs the rule's own checks first, then a dry run; applies only on the literal input `apply` |
| `scripts/watch-run-clock-closing-stamps.mjs` | the automated follow-up |
| `docs/run-clock-closing-baseline.txt` | `58` today |

## The automated follow-up

`scripts/check-captured-at-explicit.mjs` stops **this repo's source** from
reintroducing the shape. It cannot see a different writer, a manual
`/d1/execute`, or a route added later.

So the watch reads the archive daily (`40 11 * * *`) and fails when unmarked
run-clock closing stamps exceed the baseline. It is deliberately **not** scoped
to `source: draftkings` — the 58 came from one route, but the hazard is the
shape, and pinning the watch to the route that produced it would blind it to the
next one. It also prints the newest run-clock stamp seen: anything after
2026-08-22T21:11:07Z is a new writer rather than residue.

Raising the baseline to make a red run green is named in the script as the thing
that ends the watch.

## Done condition

After an authorised apply: `unmarked = 0` for the shape, `captured_at altered by
the mark = 0` (the executor re-reads and asserts both), and the watch green with
`docs/run-clock-closing-baseline.txt` lowered to `0` in the same commit.

## Scope boundary

Do not modify `captured_at`. Do not modify `_kickoff`. Do not widen the
executor's selection beyond the measured shape. The `kickoffMark` state collapse
(`verified: false, late_minutes: null` meaning both "late by an unknown amount"
and "unreadable") is recorded in the previous CC-CMD and is **not** in scope
here — changing it moves 1383 existing marks.

---

## Correction (2026-09-15, same day) — the population is 874

Everything above that says **58** was measured through a keyhole. The same
population, measured three times:

| count | how it was selected | what it is |
|---:|---|---|
| 22 | rows the `odds_history` JOIN reached | that table holds 184 rows |
| 58 | `source='draftkings'` AND no `total` | the first examples, described |
| **874** | carrying `_oddsProof` with a run-clock stamp | **the writer's own signature** |

The first two describe the examples in hand. Only the third is the property that
makes a row wrong.

**The first watch run failed, and was right to.** It counted every millisecond
stamp — 916 — against a baseline of 58. The arithmetic was the smaller error;
the design claim behind it ("the hazard is the shape") is false, because
`AmbientDO._captureClosingOdds` stamps `new Date()` at the moment it captures a
live price and there the clock **is** the measurement.

The fix is a positive discriminator, not an exclusion list: `extractOddsForGame`
writes `_oddsProof` on every blob and AmbientDO never does. The predicate now
lives once, in `src/odds-capture-provenance.js`, shared by the executor and the
watch — two copies drift, and a watch gating a different set than the executor
marks can never reach zero.

**The split is the opposite of what was assumed:** 874 replayed, **42** live —
not the ~858 live I expected. Wrong by twenty times, in the direction that
matters.

**Newest stamp in the gated set: `2026-08-22T10:01:04.210Z`** — eleven hours
before `a1937eb` fixed the path. All 874 are residue, and nothing has produced a
new one since. Measured, not assumed.

### Current state

| | |
|---|---:|
| dry run plans | **874** |
| already marked | 0 |
| kickoff not decidable from the window | **1** (`EPL_2026-08-22_hull_manunited`) |
| baseline committed | 874 |

The write remains **unauthorised**. The workflow applies only on the literal
input `apply`.

---

## APPLIED and verified (2026-09-15T14:15:55Z, run 34980428015)

```
--- 1. plan
    to mark                  : 815
    already marked (no-op)   : 59
    of the plan, kickoff NOT decidable from the window : 0
--- 3. change_log: 874 marked row(s) not yet attributed  (includes rows from an earlier interrupted run)
    874 entries written
--- 4. re-read
    rows of this shape now marked : 874
    still unmarked                : 0
    captured_at altered by the mark : 0  (must be 0)
```

Watch green at baseline **0**: `0 unmarked / 874 marked`, 42 live captures
counted and not judged. `docs/run-clock-closing-baseline.txt` lowered to `0`.

### The first apply failed, and the failure paid for itself

`FAIL: fetch failed`, eighteen seconds in, **printing no count**. 874 sequential
POSTs to one Worker makes a transient transport error ordinary rather than
exotic. Recovering the state took a separate query: **59 marked, 815 not, and
none of the 59 carrying a `change_log` entry** — step 3 never ran. That is the
same unattributable state `CC-CMD-2026-09-14` Task 1 spent a whole task
reconstructing, reproduced by this executor.

Three fixes, one per thing the failure showed:

| | |
|---|---|
| transport retries | five attempts, exponential backoff, **transport only** — an HTTP response the Worker produced is a real answer and is not retried |
| `change_log` derived from the archive | the set is "marked but not logged with `capture_provenance`", so the re-run repaired the 59 orphans. A plan-derived set would have orphaned them permanently: a re-run does not re-plan a marked row |
| the count printed where it is read | `N/874 marked before failing: <reason>` in the committed log |

The `874 entries written` line against a plan of 815 is that second fix working
rather than a coincidence.

### `kickoff_decidable: 0` undecidable

The `min(anchor, run clock)` refinement removed the last one before any row was
written. `MLB_2026-07-04_rangers_tigers` shows `window_end=2026-07-04T00:00:38.713Z`
— the clock closing the window twelve hours earlier than the noon anchor.
