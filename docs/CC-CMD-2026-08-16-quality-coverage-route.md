# CC-CMD-2026-08-16 — put the coverage numbers on a GET route

**Filed by:** field-laboratory
**Severity:** low — read-only additive route. No scoring or alerting changes.
**Type:** expose work that already exists. No new computation.

## The ask, in one line

`scripts/jq-scoring-coverage.mjs` already computes everything below. It is
reachable only through `POST /d1/execute` with `X-FIELD-Relay`, so nothing
without that secret can see it. Put the same numbers behind a GET.

## What is ALREADY exposed — this narrows the ask

Credit first, because it removed most of what I was going to request.
`/quality/report` already carries:

- `unscored_types` and `unscored_count` — currently `[]` and `0`
- `brief_type_calibration` — p25/p50/p75, `count`, `era_scoped`, `era`, `window_count`
- `scoring_eras` — era 2 and era 3 with deploy shas and measured effects
- `window_straddles_era`

So "is anything unscored right now" is **already answerable** and the answer is
no. I had this listed as a Phase-2 blocker in field-laboratory and it was not
one. That correction is the main reason this CC-CMD is smaller than planned.

## What is not exposed, and why each matters

**1. The per-day coverage series.** `unscored_count: 0` is a point-in-time
snapshot. The watch item recorded in `jq-scoring-coverage.mjs`'s own header is
about whether era 3 *fills over time* — "era-scoped calibration activates once
era 3 holds >=5 scored briefs per type, expected within hours on a 15-minute
journalism cron". A snapshot cannot answer a question about a rate. The script's
`byDay` query already produces exactly this.

**2. `era3ByType`.** The script computes:

```sql
SELECT brief_type, COUNT(*) n FROM briefs
 WHERE scoring_version = 3 GROUP BY brief_type ORDER BY n DESC;
```

and then counts "types at the >=5 calibration floor". That count is the watch
item's actual success condition and it is visible nowhere.

**3. `scoring_version` on `/archive/query` rows.** The projection is currently
`id, date, brief_type, sport, game_id, brief_text, model, quality_score,
word_count, source, created_at`. A consumer holding a corpus of stored scores
cannot tell which formula produced any given one. field-laboratory has 592
`mlb_game` briefs spanning the `6aed3bb` boundary and has to partition them by
`created_at` against a hardcoded deploy timestamp, which is a workaround for a
field that exists in the table.

## The observation that prompted this

From `/quality/report`, 2026-08-15, `brief_type_calibration`:

| brief_type | count | window_count | era_scoped |
|---|---|---|---|
| epl_match | 5 | 46 | **true** (era 3) |
| game_recap | 57 | 594 | **true** (era 3) |
| mlb_game | 21 | 286 | **true** (era 3) |
| pre_game | 21 | 131 | **true** (era 3) |
| game_brief | 32 | 32 | **false** |
| narrative_context | 14 | 14 | **false** |
| night_owl | 153 | 153 | **false** |
| slate | 59 | 59 | **false** |

For the era-scoped types `count < window_count` — an era filter was applied. For
the other four `count == window_count`, meaning no filter: they fell back to
mixed-era calibration because their era-3 population is under the floor of 5.

**`night_owl` is the one worth explaining.** 153 briefs in the calibration window
and fewer than 5 in era 3. Either those briefs stopped being written after
2026-08-13, or they are being written without `scoring_version` stamped — in
which case they can never become era-scoped no matter how many accumulate, and
their calibration silently stays mixed-era forever.

I am not asserting which. I cannot see the column. That is the point of the ask.

## Requested

Add **`GET /quality/coverage?days=N`**, returning what
`jq-scoring-coverage.mjs` already assembles:

```jsonc
{
  "ok": true, "days": 7, "since": "2026-08-09",
  "byDay":   [{ "date": "…", "total": 0, "scored": 0, "unscored": 0, "era3": 0 }],
  "byType":  [{ "brief_type": "…", "sport": "…", "total": 0, "scored": 0, "unscored": 0 }],
  "era3ByType": [{ "brief_type": "…", "n": 0 }],
  "typesAtCalibrationFloor": 0,
  "totals": { "total": 0, "scored": 0, "unscored": 0 },
  "scoredPct": 0,
  "scoringHealthy": true
}
```

Read-only, no parameters beyond `days`, no secret. Adding it to the
`probe_relay_route` allow-list would let field-laboratory verify it the moment
it lands.

Second, smaller: add **`scoring_version`** to the `/archive/query` projection.

Explicitly **not** requested: `context_hash`. I asked about it earlier and have
since found no consumer that needs it, so it stays out.

## Falsifying query — run this BEFORE building the route

This CC-CMD's motivating observation is that four brief_types lack an era-3
population. Kill it if the data disagrees:

```sql
SELECT brief_type,
       COUNT(*)                                                  AS total,
       SUM(CASE WHEN scoring_version = 3 THEN 1 ELSE 0 END)      AS era3,
       SUM(CASE WHEN scoring_version IS NULL THEN 1 ELSE 0 END)  AS unstamped,
       MAX(created_at)                                           AS newest
  FROM briefs
 WHERE created_at >= '2026-08-13 03:20:00'
 GROUP BY brief_type
 ORDER BY era3 ASC;
```

Three outcomes, three different conclusions — decide from the row, not from this
document:

- **`era3 >= 5` for all eight types** → the calibration selector is not applying
  era-scoping when it could. A selector bug, not a data problem, and the route is
  a diagnostic for something already broken.
- **`unstamped > 0` for `night_owl`** → `scoring_version` is not being written by
  every writer, and those briefs can never be era-scoped. That is a bigger
  finding than this CC-CMD and should supersede it.
- **`newest` for `night_owl` predates 2026-08-13** → that writer simply stopped,
  the era-3 population is genuinely empty, calibration is behaving correctly, and
  **the observation above is wrong**. Say so and drop this section; the route
  request stands on its own regardless.

## Why field-laboratory is not just being given the secret

`X-FIELD-Relay` gates `/d1/execute`, which is a write path. Putting it in a
second repo's CI to read a summary widens the blast radius of a shared secret to
buy a number that a GET could serve to anyone. A read route needs no secret at
all, which is the whole reason this is the request rather than "grant access".

---
_Generated by [Claude Code](https://claude.ai/code)_
