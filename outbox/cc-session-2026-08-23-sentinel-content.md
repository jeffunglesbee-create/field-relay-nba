# CC session 2026-08-23 — the sentinel reads content, not just presence

## The two-week fortnight

From `FIELD App — June 23 2026 Session — assembleContext Root Cause` (Drive):

FBref started returning HTTP 403 to GitHub Actions runner IPs on or before
2026-06-22. The soccer workflow received 403 for every request, parsed 0 squads,
wrote `{"teams": {}}` to R2, uploaded successfully, and exited 0. From the job
log for run 27957196348:

```
── FIFA World Cup 2026 ──
❌ Shooting: HTTP Error 403: Forbidden
❌ Misc: HTTP Error 403: Forbidden
0 squads with data
✅ R2 upload OK → soccer/fbref/wc2026.json   ← EMPTY teams: {}
```

`/health/sources` reported `soccer_fbref_wc | ok | stale: False` throughout,
because the sentinel asked two questions and neither of them was about content:

- does the R2 key exist? yes, it was written
- is it recent? yes, written that morning

Meanwhile `/journalism/context-probe` showed `contextLength=0` for every soccer
game. The two facts sat next to each other for a fortnight without meeting.

That session diagnosed it exactly and wrote the fix down:

> **Lesson:** Sentinel should validate team/entry count > 0 for FBref sources.
> Add as a carry-forward improvement to the Stale Data Sentinel.
> ...
> 2. Stale Data Sentinel improvement: add team/entry count > 0 check for FBref
>    sources. Current sentinel passes on empty files (file exists + recent
>    timestamp = "ok").

**It was never built.** The FBref sources were retired the next day
(`src/stale-data-sentinel.js`, comment dated 2026-06-23: *"FBref lost Opta
licence Jan 2026; pipeline retired"*), which deleted the instance and left the
defect. Six sources still route through the same two questions today.

## What was actually in the code

`entries` was already being computed:

```js
entries: d.data ? Object.keys(d.data).length : 0,   // line 39
```

`grep -n "entries" src/stale-data-sentinel.js` returned that one line. Nothing
compared it, nothing gated on it, nothing surfaced it as a verdict. A count
calculated and discarded is not a count.

`checkR2()` could not have counted anything even if someone had wanted to: it
called `.head(key)`, which returns size and upload time and never touches the
body. `nba_clutch_playoffs`, `nba_clutch_regular` and `nhl_series_stats` all go
through it.

## The change

**A source declares its floor.** `minEntries: 1` on the six content-bearing
sources, plus the container key its own consumer reads:

| source | check | container | why that key |
|---|---|---|---|
| `mlb_team_abs` | GitHub JSON | `data` | as before |
| `mlb_pitch_arsenals` | GitHub JSON | `data` | as before |
| `mlb_expected_stats` | GitHub JSON | `data` | as before |
| `nba_clutch_playoffs` | R2 | `teams` | `buildNBAClutchContext` reads `blob.teams[ha]` |
| `nba_clutch_regular` | R2 | `teams` | same |
| `nhl_series_stats` | R2 | `teams` | `buildNHLSeriesContext` reads `blob.teams[ha]` |

The container is the one the *consumer* reads, taken from
`src/context-assembler.js`, not chosen. Counting any other key would report
healthy while the prompt got nothing — which is the whole failure being fixed.

**`checkR2` opts into a body read.** Passing a container makes it `.get()` and
parse; without one it stays a `HEAD`, which is all a non-JSON artifact can
offer. Rule 78: `/health/sources` is a pull-only route with no cron caller
(`grep -rn "health/sources\|checkAllSources"` finds one route handler and zero
schedulers), so the extra R2 GET is per-request, never per-tick.

**Unreadable is a failure, not a pass.** If a source declares `minEntries` and
the count cannot be determined — bad JSON, missing container, a throw — that is
`empty: true`. A declared invariant that could not be evaluated has not been
satisfied. Treating it as satisfied is precisely how the fortnight happened.

**`empty` sets `stale`.** It is its own field so the diagnosis survives into the
response, and it also flips `stale`, because every consumer of this endpoint
reads `stale`. A new orthogonal flag that nothing reads would have reproduced
the original defect in a fresh location.

The verdict moved into a pure exported `sourceVerdict(source, data, now)` so it
can be fed synthetic rows.

## The negative control

`scripts/sentinel-content-check.mjs`, gated in `deploy.yml`. Eight assertions,
of which the load-bearing one is byte-for-byte the June-22 input:

```js
const emptyFresh = sourceVerdict(WITH_FLOOR, { ok: true, updatedMs: fresh, entries: 0 }, NOW)
check('a fresh source with zero entries is stale',
  emptyFresh.stale === true && emptyFresh.empty === true,
  'this is the exact shape that reported healthy for two weeks')
```

Four of the eight exist to stop the fix overshooting: a fresh populated source
must stay healthy; a source declaring no floor must be untouched (or this reds
every KV and D1 check that has no entries concept); an old populated source must
report as stale and *not* empty; `countEntries` must return `null` rather than
`0` for a container it could not find, because "empty" and "wrong key" are
different failures and only one of them is the file's fault.

The eighth is a registry invariant: any source that passes a container argument
must also declare `minEntries`. Opting into a body read without a floor reads as
protected and is not.

**Demonstrated to fail.** Stripping `minEntries` from the two NBA clutch entries
in a scratch copy:

```
  FAIL every source that reads a container declares a floor for it
       unpaired: nba_clutch_playoffs, nba_clutch_regular
1 failed
exit=1
```

## The live artifact

New verify-job step, `/health/sources content readout`. It writes
`outbox/health-sources-{run_id}.json` and prints one line per source with the
real entry count, then asserts two things that must hold on any live data:

1. the summary carries `empty` as a number — if it does not, the deployed build
   predates this change and the readout is describing the old sentinel
2. no in-season source reports `entry count unreadable`

Deliberately NOT asserted: that sources are non-stale or non-empty. Real data
going stale is an operations problem and must not block a deploy. A count this
code cannot *read* is a defect in this code, and does.

## Status

- **Gate:** VERIFIED. 8/8 pass; the registry invariant demonstrated failing.
- **Live:** the readout is the artifact. Its first run reports the true entry
  count for all six sources, which has never been measured.

## Files

- `src/stale-data-sentinel.js` — `countEntries`, container-aware `checkR2` /
  `checkGithubJson`, pure `sourceVerdict`, `minEntries` on six sources,
  `empty` in the summary
- `scripts/sentinel-content-check.mjs` — new
- `.github/workflows/deploy.yml` — gate step + post-deploy readout
