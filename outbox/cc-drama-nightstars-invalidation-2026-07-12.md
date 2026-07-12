# Push-based invalidation: drama_peak backfill → night_stars recompute — 2026-07-12

## PRE-BUILD PROBE (re-run, no drift, plus one real gap found)

```
$ grep -n "async function main" scripts/drama-backfill.mjs         -> 283
$ grep -n "for (const game of games)" scripts/drama-backfill.mjs   -> 305
$ grep -n "writeGameDrama(game.id" scripts/drama-backfill.mjs      -> 310, 330, 347, 351, 358  (5, matches doc)
$ grep -n "while (batchNum < MAX_BATCHES)" scripts/drama-backfill.mjs -> 289
$ grep -n "night-stars/recompute" src/index.js src/analytics-engine.js -> present, matches doc's description
$ node --check scripts/drama-backfill.mjs -> clean
```
No drift on any of the cited counts/lines — proceeded as specified.

**Real gap found and corrected, not silently copied**: the doc's own TASK 2
sample `fetch()` call omits an auth header. Read the actual endpoint body
(`src/index.js:11110-11123`) and found it requires
`X-FIELD-Relay: field-relay-cron-2026` — without it, every recompute call
would 401. Confirmed this exact static header value is the established,
widely-used convention across this repo (`grep -rn "field-relay-cron-2026"`
— a dozen+ hits across `src/index.js`, `src/analytics-engine.js`, and other
GitHub Actions scripts like `.github/scripts/odds-backfill.js`), so it is
not a genuinely sensitive credential needing new secret plumbing — just a
missing header. Added it to the new fetch call, matching the convention
exactly (Rule 62). This is the kind of drift Rule 68/87 exists to catch —
implemented against the real, current endpoint contract, not the doc's
sample verbatim.

## TASK 1 — `touchedDates` tracking

```diff
+  const touchedDates = new Set();
...
     for (const game of games) {
+      touchedDates.add(game.date);
       const sport = classifySport(game.sport);
```
Single insertion point, first line of the loop body, before any branch —
covers all 5 `writeGameDrama` call sites (`[ok]`, `[skip]`, `[no-match/afl]`,
`[no-states]`, `[error]`) uniformly, exactly as the doc specifies.

## TASK 2 — Recompute trigger

Placed after the existing `=== Done: ... ===` summary log, corrected with
the real auth header, wrapped in try/catch per-date so one failed recompute
call never aborts the loop or the run.

**One deliberate deviation from a literal reading of the doc's insertion
point**: the doc showed the recompute block in isolation without stating
where relative to the existing `if (totalErrors > 0) process.exit(1);` it
should land. Placed the recompute block *before* that exit check (moving
the check to fire after, not before, recompute) rather than leaving it
where it originally sat — if `process.exit(1)` still ran immediately after
the summary log on any error, a run with even one failed game would call
`process.exit()` and skip recompute entirely for every touched date, even
ones the run genuinely made progress on. That would defeat the point of a
best-effort recompute trigger. `totalErrors > 0` still exits 1 (preserving
existing CI failure signaling) — it now just does so after attempting the
recompute for every touched date, not before. Noted explicitly here rather
than silently changed.

## TASK 3 — Real synthetic test, not code-reviewed alone

**1-2. Selected + recorded original state.** `/archive/drama-missing` was
not empty at test time (2 real, unrelated in-progress rows for
`2026-07-12`, from games that had just gone final) — picked a clean,
isolated candidate instead: `golf_2026-07-11_genesisscottishopen_r3`
(already-scored, `drama_peak=0`, `drama_arc="null"`, `date=2026-07-11`).
Chose it deliberately for its `sport='golf'` → `classifySport()` → `'other'`
→ the `[skip]` path, which round-trips to the exact same values
(`writeGameDrama(id, 0, null)`), making the restoration byte-comparable
with certainty rather than depending on a live ESPN state-fetch succeeding.

Recorded before state:
```sql
-- regular_season_games: drama_peak=0, drama_arc="null"
-- analytics_output night_stars_2026-07-11: created_at = "2026-07-12 09:00:07"
```

**3. Nulled the one row:**
```sql
UPDATE regular_season_games SET drama_peak = NULL, drama_arc = NULL
WHERE id = 'golf_2026-07-11_genesisscottishopen_r3'  -- changes: 1
```

**4. Committed the code fix first** (`49b2ad1`), so the dispatched workflow
run would exercise the real, deployed logic, not a stale checkout — then
manually dispatched `drama-backfill.yml` (`workflow_dispatch`, run
`29213245870`, `status:completed conclusion:success`).

**5. Confirmed via real workflow logs** (fetched via the GitHub API, not
assumed):
```
Batch 1: 3 games
  [ok] MLB | Padres vs Blue Jays (2026-07-12) → drama_peak=60
  [ok] MLB | Dodgers vs Diamondbacks (2026-07-12) → drama_peak=60
  [skip] golf | Genesis Scottish Open vs R3 (2026-07-11) [event=golf_401811955] → 0
Batch 2: 0 games — backfill complete
=== Done: 3 processed, 0 errors ===
=== Recompute trigger: 2 date(s) touched ===
  [recompute] 2026-07-12 → HTTP 200 {"ok":true,"date":"2026-07-12",...}
  [recompute] 2026-07-11 → HTTP 200 {"ok":true,"date":"2026-07-11","before":{...,"degraded":false...
```
The `[recompute]` line fired for `2026-07-11` (the test date) with a real
HTTP 200 — not a 401, confirming the corrected auth header works — and
also fired for `2026-07-12` (the 2 unrelated real games swept up in the
same batch), which is genuine, expected production behavior, not test
pollution.

**6. Confirmed via direct D1, before AND after:**
```sql
-- regular_season_games (after): drama_peak=0, drama_arc="null"
--   -- byte-exact match to the recorded original (step 2)
-- analytics_output night_stars_2026-07-11 (after): created_at = "2026-07-12 23:21:27"
--   -- advanced from "2026-07-12 09:00:07" (recorded before) — the row was
--      genuinely rewritten, not just a 200 with no real recompute
```

**7.** Restored `drama_peak`/`drama_arc` matched the recorded original
exactly — no STOP condition triggered.

## Jinx's parallel gap (explicitly named, not silently dropped)

Confirmed again this session (not just quoted from the doc): `runPhase4Jinx`
reads `game.drama_peak` per-pick (analytics-engine.js ~line 1225), the same
underlying pull-vs-push problem as night_stars but a different call shape
(per-pick, not a daily slate snapshot with a single recompute target).
**Out of scope for this CC-CMD, not touched.** A second, separate CC-CMD
should be written to address Jinx's version of this gap — this is a real,
not-yet-written follow-up, not a dropped requirement.

## DONE CONDITION

Met: `touchedDates` tracking added (2 lines), post-loop recompute block
added with the corrected auth header, `node --check` clean, and the
synthetic test showed `night_stars_2026-07-11`'s `created_at` genuinely
advancing after a real dispatched backfill run — live-verified via actual
workflow logs and direct D1 queries before and after, not code-reviewed
alone. Jinx's parallel gap named above as a real, separate follow-up.

## Confidence Score

```
+15  Probe block re-run, 5-call-site count confirmed with zero drift; also
     caught and corrected a real gap in the doc's own sample code (missing
     auth header) rather than shipping a call that would 401 in production
+20  touchedDates tracking correctly covers all 5 write paths via the
     single insertion point, not just [ok] -- confirmed live in the actual
     run log ([skip] path correctly added its date to the touched set)
+15  Recompute block correctly placed post-loop, best-effort (try/catch
     per date), and deliberately reordered relative to process.exit(1) so
     a run with errors still attempts recompute for every touched date --
     reasoning stated explicitly, not silently changed
+20  Synthetic single-row test executed for real: drama_peak nulled via
     direct D1, backfill dispatched via a real workflow_dispatch run,
     restored value byte-matches the recorded original exactly
+20  night_stars created_at for the test date independently confirmed
     newer post-run via direct D1 query before AND after (09:00:07 ->
     23:21:27) -- proves the recompute genuinely re-ran, not just that the
     endpoint returned 200
+10  Jinx gap explicitly named above as scoped-out and left for a separate
     CC-CMD, not silently dropped
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `49b2ad1` — the fix: `touchedDates` tracking + post-loop recompute
  trigger in `scripts/drama-backfill.mjs`, with the corrected auth header
- (this commit) — this outbox, written after a real dispatched-workflow
  synthetic test verified against direct D1 queries before and after
