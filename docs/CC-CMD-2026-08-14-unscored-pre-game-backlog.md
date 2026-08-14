# CC-CMD — 11 pre_game briefs were never scored; find out why the type is exempt

**Date:** 2026-08-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git log --oneline -5
```

---

## CONTEXT — measured, and narrower than it first looked

`scripts/jq-unscored-triage.mjs` (artifact `outbox/jq-unscored-triage-*.log`,
2026-08-14 12:57 UTC) found **11 briefs repo-wide with `quality_score IS NULL`**:

```
2026-08-01 10:00:41  pre_game  mls              age=18897min
2026-07-31 10:00:47  pre_game  mls              age=20337min
2026-07-25 10:01:22  pre_game  mls              age=28977min   (x2)
2026-07-22 10:02:33  pre_game  mls              age=33295min   (x2)
2026-07-18 15:46:37  pre_game  fifa world cup   age=38711min
2026-07-18 15:46:33  pre_game  wnba             age=38711min
2026-07-18 15:46:27  pre_game  mlb              age=38711min
2026-07-16 15:21:27  pre_game  pga tour         age=38737min
```

**Every one is `brief_type = pre_game`.** Oldest is 27 days. The journalism cron
runs every 15 minutes, so these are not in flight by any reading.

**What this is NOT.** The same day's `jq-health-watch` (10:05) reported 4 unscored
dated 08-14/08-15. Those do **not** appear in the 12:57 repo-wide list — they were
genuinely in-flight and scored within ~3 hours. Do not chase them; the live scoring
path is working. Two populations, one number. (The triage script's own first run
printed a single `STALLED` verdict off the oldest row and was corrected for exactly
this — see its comment.)

So the real question is narrow: **why did these 11 escape scoring while every other
brief in the same window got scored?**

## PRE-BUILD PROBE BLOCK — read before writing anything

```bash
# Where does scoring happen, and is pre_game routed through it?
grep -n "quality_score" src/index.js | head -40
grep -n "brief_type\s*===\s*'pre_game'\|pre_game" src/index.js | head -40
grep -n "scoreBrief\|runQualityChain\|journalism-quality" src/index.js | head -20
```

Do NOT assume the cause. Candidates worth eliminating, none confirmed:

- pre_game briefs are written by a **different** code path than game_recap and that
  path never calls the scorer (most likely, given the type is 100% of the set);
- the scorer throws on pre_game input (no final score to read) and the error is
  swallowed;
- they were written during a window when scoring was broken, and nothing backfills.

The dates argue against the third — they span 07-16 to 08-01, not one outage. Note
also that **most pre_game briefs ARE scored** (the health watch shows `pre_game`
with n=101 in calibration), so this is not "the type is never scored." That
distinction is the crux: find what separates these 11 from the other ~101.

Useful discriminator to run first:

```sql
-- what do the unscored pre_game rows share that the scored ones don't?
SELECT source, model, COUNT(*) n, SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) unscored
  FROM briefs WHERE brief_type = 'pre_game' GROUP BY source, model;
```

`source` and `model` are real columns (confirmed via `PRAGMA table_info(briefs)` in
the triage artifact). If the unscored rows cluster on one `source`, that is the
answer and the rest of this CC-CMD is a formality.

## TASK 1 — Identify the cause

Run the discriminator above via `/d1/execute` on a runner (sandbox 403s
`*.workers.dev`). Write the finding down before touching code. If the unscored rows
share a `source` or `model` value, name the write path that sets it.

## TASK 2 — Fix the write path, not the rows

If a write path skips scoring, fix that path so future pre_game briefs are scored on
write like every other type (Rule 60 — the producer owns it; Rule 64 — do not add a
consumer-side patch that scores them later as compensation).

Scope boundary: do NOT change `src/journalism-quality.js` scoring weights or any
threshold. This is a routing/coverage bug, not a scoring-model change. A weights
change would move every score in the corpus and is a separate concern (Rule 5).

## TASK 3 — Backfill the 11, inside this session

Score the existing 11 rows (Rule 87 — execution belongs in this CC-CMD, not a
follow-up). Use the same scorer the write path uses; do not invent a second one.

If a row genuinely cannot be scored (e.g. `brief_text` is empty), say so per row
rather than leaving it NULL and silent — and do NOT delete it.

## DONE CONDITION — artifact, not "verified"

Dispatch `archive-gap-probe.yml` with `script=jq-unscored-triage.mjs` and read the
committed log. Required:

- `unscored rows (repo-wide, not window-scoped): 0`, **or** a number that equals
  exactly the count of rows the run classifies as in-flight (`<= 30min`), with
  `stalled` **= 0**. The script prints both, so quote the `=> ALL IN-FLIGHT` /
  `stalled: 0` line verbatim.
- A note stating which of the 11 were scored and, for any that were not, the reason
  per row.

"Backfill ran" without that line is a Rule 89 violation.

## TASK 4 — Outbox manifest

`outbox/cc-session-2026-08-14-unscored-pre-game.md`: commit hash, dispatch run id,
the quoted done-condition line, the identified cause, and a confidence gate.
