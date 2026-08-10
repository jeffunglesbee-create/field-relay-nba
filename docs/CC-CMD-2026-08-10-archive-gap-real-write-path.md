# CC-CMD-2026-08-10-archive-gap-real-write-path

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-10-archive-gap-real-write-path.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

`CC-CMD-2026-08-09-backfill-archive-gap-dates` Task 3 rested on a premise
that turned out to be false, and it was written as a second CC-CMD rather
than a carry-forward because the deferred half is real work, not a
follow-up check.

That CC-CMD instructed `GET /archive/backfill?date=YYYY-MM-DD` for
2026-08-05 and 2026-08-06 and expected `regular_season_games` rows to
appear. Executed (`outbox/run-archive-gap-backfill-*.log`), both dates
returned HTTP 200:

```
{"ok":true,"skipped":true,"reason":"backfill already exists",
 "date":"2026-08-05","existing_id":"slate_2026-08-05_backfill"}
```

and the zero-day list was unchanged: `["2026-08-05","2026-08-06"]`.

Reading `executeBackfill` (src/index.js:6507, reached from the route at
src/index.js:10430) explains it: the function runs
`SELECT * FROM regular_season_games WHERE date = ?` and generates a
journalism brief from what it finds. It is a **consumer** of archived
games, not a producer. On an empty date it produces an empty brief,
stores it, and returns `ok:true` — which is why the failure was silent.

So `/archive/backfill` cannot fill an archive gap, and no amount of
re-running it will. The route that writes `regular_season_games` is
`POST /archive/game` (src/index.js:11060-11215).

## Task 1 — probe first, per Rule 87

Read from HEAD, not from this document:

```
grep -n "pathname === '/archive/game'" src/index.js
sed -n '11060,11100p' src/index.js     # field names + id construction
grep -n "ESPN_API_BASE" src/index.js   # the host that does not 403 Worker egress
```

Record: the exact accepted body field names, the id construction for a
caller with no `series_key`, and the auth header.

**Known from the CFL repair, and load-bearing here:** the id is
`${sport}_${date}_${shortify(home)}_${shortify(away)}`, and the upsert is
`ON CONFLICT(id)`. A write whose id does not match an existing row
**INSERTs a new row rather than filling the old one** — this is exactly
how `run-cfl-seed-backfill.mjs` turned 5 CFL rows into 7 on 2026-08-10.
On these gap dates there are no existing rows at all, so that hazard does
not apply; do not carry a fill-shaped assumption into a date that already
has rows.

## Task 2 — confirm ESPN still serves the gap dates

The preflight measured this on 2026-08-10 and both dates returned events.
That claim is now inherited, so re-measure it (Rule 72) before writing:

```
curl -s "https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260805" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.events?.length)'
```

**Artifact:** the event count for MLB and WNBA on both dates. If any is
0, STOP — a backfill against a date the source no longer serves writes
nothing and would report success.

## Task 3 — write one script, run it via CI

`scripts/run-archive-gap-espn-backfill.mjs`, dispatched through
`.github/workflows/archive-gap-probe.yml` (sandbox egress to
`*.workers.dev` is blocked; this is the established proxy).

For each of MLB and WNBA × 2026-08-05 and 2026-08-06: fetch the ESPN
scoreboard, take **completed events only** (gate on status, the same way
the collector does — grep `[ARCHIVE-` blocks for the existing convention
rather than inventing one), and POST each to `/archive/game`.

Field mapping must be copied from the existing collector, not composed.
Any field with no source value is `null` — inventing a venue is a Rule 2
violation.

## Done condition

Not "the POSTs returned 200". The rows must exist and be scored:

```sql
SELECT date, sport, COUNT(*) n,
       SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END) scored
  FROM regular_season_games
 WHERE date IN ('2026-08-05','2026-08-06') AND sport IN ('MLB','WNBA')
 GROUP BY date, sport
```

**Artifact:** that result committed to `outbox/`. Pass requires `n > 0`
and `scored = n` for every group, and `0-0 phantom rows: 0` (count rows
where `home_score = 0 AND away_score = 0` — use `=== 0`, not `Number()`
coercion, which reads NULL as 0 and has produced a false phantom count in
this repo before).

## Explicitly NOT in scope

- Do not modify `executeBackfill` or `/archive/backfill`. It is doing
  what it was written to do; the earlier CC-CMD asked it for something
  else.
- Do not backfill any date outside 2026-08-05 and 2026-08-06.
- Do not add a fallback path if the ESPN fetch fails — report and stop.

## Outbox

`outbox/cc-session-2026-08-10-archive-gap-real-write-path.md`: the Task 1
probe output, the Task 2 event counts, the POST responses, and the done
condition query result.
