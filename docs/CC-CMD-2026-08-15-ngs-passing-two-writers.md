# CC-CMD — two independent writers own nfl/{year}/ngs-passing.json

**Date:** 2026-08-15
**Repos:** jeffunglesbee-create/field-relay-nba AND jeffunglesbee-create/jubilant-bassoon
**Branch:** main in both — commit directly. No PRs.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git log --oneline -5
```

---

## CONTEXT — found while fixing the NFL-B pipeline, measured from source

The same R2 object is written by two unrelated jobs, from two different source
files, on two different schedules, with two different envelopes:

| | jubilant-bassoon | field-relay-nba |
|---|---|---|
| writer | `scripts/build-ngs-data.py` | `src/nfl-r2.js` → `runNFLR2Update` |
| trigger | `nfl-ngs-update.yml`, Mon 07:00 UTC | cron, Wed 12–15 UTC (`src/index.js` ~8725) |
| source | `nextgen_stats/ngs_passing.parquet` | `ngs_passing/ngs_passing.csv` |
| key | `nfl/{year}/ngs-passing.json` (year computed) | `nfl/2026/ngs-passing.json` (**hardcoded**) |
| envelope | `updated, season, targetYear, source, data` | `updated, source, data` (+`season`/`targetYear` as of this session) |

Neither knows about the other. **Wednesday wins**, every week, because it runs
last — so any field only the Monday writer emits is stripped for 5 days out of 7.
That is how the season-label fix would have quietly died: `build-ngs-data.py` was
corrected to stamp the data's real season, and the relay would have overwritten it
with an envelope that has no season at all.

A same-session patch (`src/nfl-r2.js`) now stamps matching `season`/`targetYear`
so the two envelopes agree. **That is a stopgap, not the fix.** Two writers racing
for one key is the actual defect, and the patch only makes the race harmless for
the fields we happen to know about today.

Also latent, and NOT fixed here: the relay hardcodes `nfl/2026/` while the read
route computes the year dynamically (`src/index.js` ~15797,
`month >= 7 ? year : year - 1`). From August 2027 the route reads `nfl/2027/`
and this cron still writes `nfl/2026/`. The GitHub-raw fallback added in `680ac26`
masks it for `ngs-passing`, but `player-stats.json` and `pfr-rec.json` have no
outbox copy and would simply go missing.

## PRE-BUILD PROBE BLOCK

```bash
# relay
grep -n "nfl/2026/" src/nfl-r2.js
grep -n "nflYear\|NFL_R2_FILES" src/index.js | head
# client
grep -n "upload_to_r2\|nfl/{year}" ../jubilant-bassoon/scripts/build-ngs-data.py
# what is actually in R2 right now, and which writer produced it
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/nflverse/ngs-passing.json" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
             console.log({source:d.source, season:d.season, targetYear:d.targetYear,
                          rows:Object.keys(d.data||{}).length, updated:d.updated})'
```

The `source` string identifies the winner: `"nflverse NGS parquet"` = the client
pipeline, `"nflverse NGS via CF Worker"` = the relay cron.

## TASK 1 — Decide which writer owns this key, and record the decision

One writer must own it. Deciding factors to establish from the probe, not assume:
row counts from each source, field coverage (does the CSV path carry every field
the parquet path does?), and freshness.

Rule 60 says the relay owns the data contract — but here the relay is the *worse*
source: `ngs_passing.csv` is the legacy per-file format, while the parquet is what
`nflreadpy` actually maintains (recorded in the 2026-06-11 NGS investigation and
re-confirmed by the pipeline's own logs: seasons 2016–2025 present in the parquet).
Do not resolve this on rule-citation alone; probe both and compare coverage.

## TASK 2 — Retire the loser

If the client pipeline wins: remove `ngs-passing` from the `tasks` array in
`runNFLR2Update` and say so in `src/nfl-r2.js`'s header comment. Leave
`player-stats` and `pfr-rec` alone — they have no second writer.

If the relay wins: remove the passing table from `build-ngs-data.py` and its
outbox entry, and drop `ngs-passing.json` from `NFLVERSE_OUT_ALLOWED` (added in
`680ac26`) since there would no longer be a GitHub-raw copy to serve.

Either way the surviving writer must keep emitting `season` + `targetYear`.

## TASK 3 — Fix the hardcoded year in the relay writer

`nfl/2026/` → the same dynamic expression the read route uses. Both sides must
compute the year identically; if they disagree the object is written where nothing
reads it. Verify by asserting the computed key equals what the route requests.

## DONE CONDITION — artifact

After the change, one dispatch of the probe command above must show:

- exactly ONE `source` value across two consecutive weeks spanning both cron days
  (Mon and Wed) — quote both outputs in the outbox doc,
- `season` present and equal to the max season in `data`,
- `rows` > 0.

"Only one writer now" without the two-week output is a Rule 89 violation, since
the collision is only observable across both schedules.

## TASK 4 — Outbox manifest

`outbox/cc-session-2026-08-15-ngs-passing-two-writers.md`: commit hashes in both
repos, the probe outputs, which writer won and why (with the coverage numbers),
and a confidence gate.
