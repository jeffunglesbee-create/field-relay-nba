# CC-CMD: Fix sweepKVBriefs sport mislabeling (58 real rows show sport='espn')

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Source:** found while investigating session_health's degraded-quality
list. 58 `game_recap` rows (all `source:'kv_sweep'`, all real WC26
games) have `sport='espn'` — not a real sport, fragmenting these games'
numbers out of the real `FIFA World Cup 2026` grouping in every
sport-based aggregate.

**Honest scope note:** the exact original writer that produced a KV key
with "espn" in the sport-slot position was searched for but not found —
none of the current `brief:game:*` write sites in this file produce that
shape. Rather than keep chasing an unconfirmed historical writer, this
fixes it at the point of consumption instead, which closes the bug
regardless of whether the original cause was ever identified, and
protects against any similarly-malformed key in the future too.

**Target time:** ~20 min

## PROBE BLOCK
```bash
sed -n '4436,4460p' src/index.js   # sweepKVBriefs parsing + existing gameRow lookup
```
Confirm the citation matches before editing. Confirm live: the JOIN
below still returns real sport values for the known-bad game_ids.
```sql
SELECT b.game_id, b.sport AS wrong_sport, g.sport AS real_sport
FROM briefs b JOIN regular_season_games g ON b.game_id = g.espn_event_id
WHERE b.sport = 'espn' LIMIT 5;
```

## REAL ROOT CAUSE

`sweepKVBriefs` (line ~4436) parses `sport` directly from the KV key
shape (`brief:game:{sport}:{id}` → `parts[0]`), trusting it blindly.
For these 58 rows, whatever wrote the original KV key put "espn" in
that position — likely meant as a source/provider tag from an earlier
integration phase, not a sport label. The function already does a
separate archive lookup a few lines later (for `gameCtx`, home/away/
score) keyed by the *same* `gameId` — it just never uses that lookup's
own `sport` column, which is the actual authoritative value.

## TASK 1 — Prefer the archive's sport over the KV-key-parsed one

Extend the existing `gameRow` query (line ~4454) to also select `sport`:
```sql
SELECT sport, home, away, home_score, away_score FROM regular_season_games WHERE espn_event_id = ? LIMIT 1
```
(same addition to the `postseason_games` fallback query). Then, after
this lookup runs, override the KV-parsed `sport` variable with the
archive's value when a match exists:
```javascript
if (gameRow && gameRow.sport) sport = gameRow.sport; // archive is authoritative; KV-key segment is not
```
Note: `sport` is currently declared `const` (line ~4440) — change to
`let` to allow this reassignment. This makes the archive's own sport
column win whenever a real game record exists, regardless of what the
KV key's segment said — closing this bug even without ever confirming
who originally wrote the malformed key, and protecting against any
future key with a similarly wrong segment.

## TASK 2 — One-time backfill of the 58 existing bad rows

```sql
UPDATE briefs SET sport = (
  SELECT g.sport FROM regular_season_games g WHERE g.espn_event_id = briefs.game_id
  UNION ALL
  SELECT g.sport FROM postseason_games g WHERE g.espn_event_id = briefs.game_id
  LIMIT 1
)
WHERE sport = 'espn'
  AND EXISTS (
    SELECT 1 FROM regular_season_games g WHERE g.espn_event_id = briefs.game_id
    UNION ALL
    SELECT 1 FROM postseason_games g WHERE g.espn_event_id = briefs.game_id
  );
```
Run the equivalent `SELECT` first to confirm exactly which rows and what
they'll become before running the `UPDATE`. Report the real row count
changed. If any `sport='espn'` rows have no matching archive record at
all (so the JOIN can't recover a real value), leave those as `'espn'`
and report them explicitly rather than guessing or silently dropping
them.

## TASK 3 — Verification

- `node --check src/index.js`
- Re-run the diagnostic JOIN from the probe block after the UPDATE —
  confirm zero rows remain with `sport = 'espn'` that have a real
  archive match.
- Confirm `sport` is genuinely `let` now, not still `const` (a stale
  `const` would fail at runtime the first time this code path executes
  post-deploy, not at review time — check this explicitly, don't just
  eyeball the diff).

## DONE CONDITIONS
- [ ] Probe block confirms citation and live JOIN result before editing
- [ ] `gameRow` query extended to include `sport` (both regular_season_games and postseason_games branches)
- [ ] `sport` changed from `const` to `let`, override logic added
- [ ] Backfill UPDATE run after a SELECT preview; real row count reported
- [ ] Any un-recoverable `espn`-sport rows (no archive match) explicitly reported, not silently left unmentioned
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+30  Task 1 — archive-preferred sport override added correctly, `const`→`let` change verified functional
+30  Task 2 — backfill executed safely (preview-then-update), real row count reported
+20  Task 3 — re-run JOIN confirms zero remaining recoverable espn-sport rows
+10  Any unrecoverable rows explicitly reported, not glossed over
+10  Outbox states plainly that the original upstream writer was never identified — this fixes the symptom robustly, not the unconfirmed root cause

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-06-kv-sweep-sport-mislabel-fix.md.
Execute both tasks: (1) make sweepKVBriefs prefer the archive's own
sport column over the KV-key-parsed value whenever a real game record
exists (change sport from const to let), (2) backfill the 58 existing
sport='espn' rows via the same archive JOIN, preview via SELECT first.
Report the real row count changed and explicitly flag any rows that
couldn't be recovered. Do not commit unless confidence >= 95. If score
< 95, report verbatim and stop.
