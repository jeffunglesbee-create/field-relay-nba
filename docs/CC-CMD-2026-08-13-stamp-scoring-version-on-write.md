# CC-CMD-2026-08-13-stamp-scoring-version-on-write

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## State at HEAD

`briefs.scoring_version` exists (`430dfdf`), history is labelled — 1941 era-1,
1158 era-2, 1 era-3, 56 boundary-date rows deliberately NULL
(`outbox/jq-scoring-version-backfill-*.log`) — and `/quality/report` prefers
the stored value, falling back to `eraForDate(row.date)`.

**Nothing writes the column.** Every new scored brief lands NULL and is
covered by the date fallback. That fallback is correct *only while scores are
written at generation time*. The moment anything rescores old text — which
`CC-CMD-2026-08-13-jq-dim1-unit-and-taper` may motivate — a row's date stops
predicting its formula and the fallback silently mislabels it.

So this is not tidying. It is closing the window before the thing that breaks
it is built.

## Why it was not done in the same pass

There are **13** `INSERT INTO briefs` sites plus at least two
`ON CONFLICT ... quality_score = excluded.quality_score` updates. Stamping
them blind is exactly the change Rule 13 exists to stop. They need
enumerating, and the ones that write a score need distinguishing from the ones
that write `quality_score = NULL` and leave scoring to a later path.

## TASK 0 — enumerate, from HEAD

```
grep -n "INSERT INTO briefs" src/index.js
grep -n "quality_score = excluded.quality_score" src/index.js
grep -n "let finalScore" src/index.js
```

For each site record: does it write a non-null `quality_score` at insert
time, or NULL-then-update elsewhere?

**Artifact:** that table committed to `outbox/`, one row per site, before any
edit. A site that writes NULL must NOT be stamped — stamping a version onto a
row with no score asserts a scoring that did not happen.

## TASK 1 — stamp only the sites that score

Use `CURRENT_SCORING_ERA` from `src/journalism-quality.js` — already exported
and already imported by `src/index.js`. Do not hardcode `3`; the whole point
is that the constant moves when the formula does.

Scope boundary: do not refactor the INSERTs, do not unify them, do not change
column order for tidiness. One added column value per qualifying site.

## TASK 2 — the fallback must become dead, and be seen to be

Once writes are stamped, `eraForDate` remains only for pre-column rows. Do NOT
delete it — those 3,156 rows are real and 56 of them are permanently NULL by
design.

**Artifact:** after 24h of live traffic, the share of NEW scored briefs
carrying a non-null `scoring_version`:

```sql
SELECT scoring_version, COUNT(*) FROM briefs
 WHERE quality_score IS NOT NULL AND date >= date('now','-1 day')
 GROUP BY scoring_version
```

Pass is **zero NULLs** among rows dated after this deploys. A NULL there means
a scoring path was missed in TASK 0, and names which day to look at.

## DONE CONDITION

1. The TASK 0 site table, committed.
2. The 24h query above returning no NULL bucket for post-deploy dates.
3. `/quality/report` showing `era_scoped: true` for at least one brief_type —
   proving the stored version is actually feeding calibration rather than the
   fallback doing all the work.

## Explicitly NOT in scope

- Do not rescore or backfill any `quality_score`.
- Do not relabel the 56 boundary-date rows. They are correctly NULL: era
  `from` carries a time of day, `briefs.date` does not.
- Do not change `eraForDate`, `SCORING_ERAS`, or the calibration logic.

## Outbox

`outbox/cc-session-2026-08-13-stamp-scoring-version-on-write.md`
