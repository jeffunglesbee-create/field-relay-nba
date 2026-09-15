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
