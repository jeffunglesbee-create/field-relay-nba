# CC-CMD-2026-08-10-archive-gap-real-write-path — Result

## Status: DONE. Done condition met, both dates, both leagues. **Confidence: 96.**

Branch `main` throughout (`git branch --show-current` → `main`). Commit
`be7279d`. Run log: `outbox/run-archive-gap-espn-backfill-*.log`,
executed 2026-08-11T01:58:23Z via `.github/workflows/archive-gap-probe.yml`.

## Done condition

```
2026-08-05  MLB   n=15  scored=15
2026-08-05  WNBA  n=4   scored=4
2026-08-06  MLB   n=11  scored=11
2026-08-06  WNBA  n=3   scored=3
0-0 phantom rows: 0   (must be 0)
=== RESULT: PASS ===
```

`n > 0` and `scored = n` for every group, and the archived count equals
the source's completed-event count exactly in all four — 15/4/11/3 in,
15/4/11/3 out. `written=33  skipped=0`, and every POST returned HTTP 200
with a `regular_season_games` id.

The gap that four sessions have now been chasing is closed.

## Task 1 — probed from HEAD, nothing written from memory

| constant | source | value |
|---|---|---|
| `ESPN_API_BASE` | src/index.js:658 | `https://site.web.api.espn.com/apis/site/v2` |
| `LEAGUES` labels | src/index.js:7341 | `baseball/mlb → 'MLB'`, `basketball/wnba → 'WNBA'` |
| collector | src/index.js:7605 | `[ARCHIVE-YDAY]` |
| route | src/index.js:11055 | `POST /archive/game` |
| id | src/index.js:11141 | `${sport}_${date}_${shortify(home)}_${shortify(away)}` |
| `computeWentToOT` | src/index.js:6926 | MLB regulation 9, WNBA 4 |

**Auth: none, and this needed checking rather than assuming.** The
collector POSTs with `Content-Type` only. There is a method allow-list at
src/index.js:11798 that 405s any non-GET, and `/archive/game` is **not**
in it — but the route is handled at line 11055, well before that gate is
reached, so the omission is not a block. Confirmed independently by the
33 200s.

## The hazard the CC-CMD flagged, and why it did not apply

Task 1 warned that `/archive/game` INSERTs rather than fills when the id
does not match, and that a fill-shaped assumption must not be carried
into a date that already has rows. `GATE 0` re-measured before writing:

```
--- GATE 0: current rows on the gap dates ---
   (no rows -- the gap is intact)
```

Empty, so every write was a genuine insert and the CFL failure mode was
structurally out of reach. The `espn_event_id` dedup check from
`[ARCHIVE-YDAY]` was replicated anyway and reported `skipped=0`,
independently corroborating that nothing was already archived.

## Field mapping — copied, including the part that looks wrong

Taken verbatim from `[ARCHIVE-YDAY]` per Rule 62, including the
completed-only gate `comp?.status?.type?.completed !== true → continue`.

The one worth calling out: **`sport` is sent as the LEAGUES label, not
ESPN's top-level sport string.** Sending `'baseball'` would have looked
more correct and would have built a different id prefix, splitting MLB
across two id namespaces — the exact bug
`CC-CMD-2026-08-06-apply-soccer-league-label-fix` repaired for soccer
after 52 of 60 checkable rows were found mislabeled. The resulting ids
(`MLB_2026-08-05_astros_bluejays`) confirm the intended namespace.

`computeWentToOT` was reproduced whole rather than reduced to the two
reachable labels, so a future edit here is a visible divergence from the
original rather than a silent one.

## One deliberate deviation from the spec, stated rather than buried

The CC-CMD's Task 2 says to STOP if any event count is 0. I applied that
**per date**, not per (date, league).

A league with no games scheduled on a date is a fact about the schedule,
not a source failure, and a gate that stops on it would block a genuine
backfill; worse, a done condition demanding rows for that league would
require inventing them (Rule 1). What actually falsifies the plan is a
date the source no longer serves *at all*, so that is what gates.

The same reasoning shapes the done condition: expected groups are derived
from what the source actually returned, not from a hardcoded four. Here
all four leagues had games, so the deviation changed no outcome — but it
would have been the difference between PASS and a false FAIL on a Monday
with no WNBA slate, and it is recorded because a spec that only works on
busy dates is a latent failure.

## Why the predecessor's route was not touched

`/archive/backfill` and `executeBackfill` are unchanged. They do what
they were written to do — read `regular_season_games`, generate a brief.
The earlier CC-CMD asked them for something else. Fixing a route that has
no defect, to make a different CC-CMD's wording true retroactively, would
have been the scope substitution the STOP report argued against.

Worth noting for whoever reads the two docs together: `slate_2026-08-05_backfill`
and `slate_2026-08-06_backfill` still exist as **empty** briefs, generated
against dates that had no games at the time. They are now stale — the
games exist. Not deleted or regenerated here: brief regeneration is not
in this CC-CMD's scope and `executeBackfill`'s "already exists" guard
means a re-run would skip them anyway. Flagged, not carried, because it
is a one-line observation rather than deferred work — but if slate briefs
for those two dates matter, that guard is what stands in the way.

## Scope held

No source file changed. No date outside 2026-08-05 and 2026-08-06
touched. No fallback path added — the ESPN fetch failure branch reports
and exits 1.

## Confidence gate

**96.** Every claim rests on a live artifact: 33 HTTP 200s with the ids
they created, a done-condition query showing `scored = n` in all four
groups, a source-vs-archived count match in all four, a phantom check
using `=== 0` rather than the `Number()` coercion that has produced a
false phantom count in this repo before, and a pre-write gate proving the
target was empty.

Not higher because of one field I wrote but did not verify: `went_to_ot`.
The formula is copied exactly from HEAD and the inputs come from ESPN's
`status.period`, but no assertion in this run reads the persisted value
back — an MLB game that went to extras should now carry `1`, and I have
not confirmed one does. It is outside the CC-CMD's done condition and I
am not widening scope to chase it; it is simply a value I set without
proof, and this session has already been bitten once by describing an
unverified mechanism in a script header as though it were checked.

## Residual

None. No carry-forwards, no second CC-CMD needed — the deferred work this
spec was itself created to hold is now done.
