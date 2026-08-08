# CC-CMD-2026-08-09-backfill-archive-gap-dates

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-backfill-archive-gap-dates.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

`CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap` confirmed that no
MLB or WNBA rows were archived on 2026-08-05 or 2026-08-06 — zero rows
under any label, in either table. It was investigation-scoped and
forbade applying a fix, so the repair is this CC-CMD.

**These dates cannot self-heal.** The catchup path only reaches
yesterday; both are now days old. 2026-08-07 already recovered on its
own (its rows were written 2026-08-08 13:46) and must NOT be touched.

## Task 1 — probe before writing anything

```
node scripts/archive-gap-probe.mjs      # via .github/workflows/archive-gap-probe.yml
```
Confirm 2026-08-05 and 2026-08-06 still hold zero MLB/WNBA rows. If they
are now populated, something else backfilled them — stop, record that,
and do not run a second backfill over existing rows.

Then read the real `/archive/backfill` handler from HEAD (locate by
`pathname === '/archive/backfill'`) and record: what parameters it
takes, whether it is date-ranged or single-date, and whether it upserts
or inserts. Do not infer the parameter names.

## Task 2 — verify ESPN actually still serves those dates

The archive writer reads ESPN scoreboards. ESPN's retention for a
past-dated scoreboard query is not assumed here — probe it:

```
html_probe https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260805
html_probe https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260806
```
Use `ESPN_API_BASE` read from `src/index.js`, not written from memory —
`site.api.espn.com` 403s Worker egress and is the wrong host.

**Artifact:** the `events` array length for each date. If either is 0,
ESPN no longer serves it and the backfill cannot succeed; record that
and stop rather than running a job that will write nothing.

## Task 3 — run the backfill for exactly those two dates

Only 2026-08-05 and 2026-08-06. Not 08-07 (already recovered), not a
range that spans it.

## Task 4 — Done condition (artifact, not a claim)

Re-run `scripts/archive-gap-probe.mjs` and commit its log. Pass A must
show, for BOTH dates, `regular_season_games` rows under `sport='MLB'`
with a non-zero count, and pass C must show no remaining zero-day
between 2026-07-30 and 2026-08-09. Quote those lines in the outbox.

Row counts do not need to match neighbouring days exactly — the real
slate size varies (08-03 had 8, 07-30 had 10). Non-zero with plausible
scores is the bar; identical-to-neighbours is not.

## Explicitly NOT in scope

- Do not touch 2026-08-07.
- Do not modify the archive writer, the cron, or the catchup window.
- Do not attempt to fix the root cause — that is
  `CC-CMD-2026-08-09-diagnose-0805-pre-403-miss`.

## Outbox

`outbox/cc-session-2026-08-09-backfill-archive-gap-dates.md`: the Task 2
probe output, the backfill invocation used, and the Task 4 probe lines.
