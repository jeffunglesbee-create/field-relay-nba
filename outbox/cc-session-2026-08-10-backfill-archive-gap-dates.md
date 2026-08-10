# CC-CMD-2026-08-09-backfill-archive-gap-dates — Result

## Status: STOPPED at Task 3. The task's premise is falsified. **Confidence: 97** — in the finding, not in a completion; nothing was completed and nothing should be.

Branch `main` throughout. Second CC-CMD written per Rule 87:
`docs/CC-CMD-2026-08-10-archive-gap-real-write-path.md`.

## Tasks 1 and 2 — gates ran, both PROCEED

`scripts/preflight-archive-backfills.mjs`, run via
`.github/workflows/archive-gap-probe.yml` (sandbox egress to
`*.workers.dev` is 403; CI is the established proxy).

```
gapStillEmpty: "PROCEED"
  still-empty gap dates: ["2026-08-05","2026-08-06"]
espnServesGapDates: "PROCEED"
  20260805: HTTP 200, events=15
  20260806: HTTP 200, events=13
```

So nothing else had backfilled them, and the source still serves them.
Both gates cleared. The work was correctly authorised to proceed.

## Task 3 — the backfill returned success and did nothing

`outbox/run-archive-gap-backfill-*.log`:

```
2026-08-05: HTTP 200 {"ok":true,"skipped":true,"reason":"backfill already exists",
                      "date":"2026-08-05","existing_id":"slate_2026-08-05_backfill"}
2026-08-06: HTTP 200 {"ok":true,"skipped":true,"reason":"backfill already exists",
                      "date":"2026-08-06","existing_id":"slate_2026-08-06_backfill"}
remaining zero-days 07-30..08-09: ["2026-08-05","2026-08-06"]
=== RESULT: FAIL ===
```

Two HTTP 200s with `ok:true`, and the zero-day list identical to the one
the preflight had produced minutes earlier.

## What it actually is

`/archive/backfill?date=` (route at src/index.js:10430) calls
`executeBackfill(env, date)` at src/index.js:6507. That function's first
statement is

```js
'SELECT * FROM regular_season_games WHERE date = ?'
```

and it generates a journalism brief from the rows it finds. It is a
**consumer** of archived games, not a producer. On a date with no games
it produces an empty brief, stores it under
`slate_<date>_backfill`, and returns `ok:true`.

That stored brief is also why the second call reports `skipped` — the
first invocation had already created the artifact whose existence the
route guards on. The route is behaving exactly as written. The CC-CMD
asked it for something it was never built to do.

**The route that writes `regular_season_games` is `POST /archive/game`**
(src/index.js:11060-11215). No GET endpoint fills an archive gap.

## Why this is reported rather than worked around

The obvious next move — write the POSTs and finish the job in this
session — is the wrong one, and not for reasons of caution.

The CC-CMD's Task 3 specifies a mechanism, and its done condition
("re-run the zero-day query and see the dates disappear") is satisfiable
by a completely different mechanism. Substituting the mechanism silently
would leave a session log saying "backfill-archive-gap-dates: DONE" while
the thing that ran shares nothing with the thing that was specified. The
next session reading that would inherit the false claim that
`/archive/backfill` backfills games — which is precisely the claim that
cost this session a workflow run to disprove.

The correct route (Rule 88) is to record the falsification and write the
mechanism into its own spec, which is what the second CC-CMD is.

There is a second, harder reason. The same session's CFL backfill
assumed a write path's behaviour and turned 5 rows into 7 by POSTing
against a mismatched id. Writing to `/archive/game` from inside a CC-CMD
that never probed that route would be the identical class of error, one
task later.

## What this failure says about the checks

Both gates passed and the operation still did nothing, because both gates
measured **preconditions** — is the target still empty, does the source
still have data — and neither measured whether the **mechanism** could
have the intended effect. A gate on the tool would have been a single
probe: does `/archive/backfill` contain an INSERT?

The `ok:true` is the sharper lesson. A response that reports success for
a no-op is not distinguishable from success by any check that reads the
status code. The done-condition query is what caught it, which is Rule 90
doing exactly its job — the artifact was the row count, not the HTTP
response.

## Scope held

No code was changed. No rows were written or deleted on those dates. The
only artifacts are the preflight log, the failed backfill log, and the
second CC-CMD.

## Confidence gate

**97**, in the finding. The mechanism claim is read directly from the
function body at HEAD rather than inferred from behaviour, and the
behaviour independently corroborates it: two `ok:true` responses, zero
rows, an unchanged zero-day list, and a `skipped` reason that names the
brief artifact the function stores.

Not 100 because I did not execute a control — POSTing one game to
`/archive/game` for one gap date and watching the row appear would prove
the alternative path works, not merely that this one doesn't. That
control belongs in the second CC-CMD, where it is Task 3, rather than
here where it would be the scope substitution this document argues
against.

## Residual

None carried. The deferred work is
`docs/CC-CMD-2026-08-10-archive-gap-real-write-path.md`, which probes the
write route before using it, re-verifies the ESPN claim rather than
inheriting this session's measurement, and states a done condition in
rows-and-scores rather than HTTP status.
