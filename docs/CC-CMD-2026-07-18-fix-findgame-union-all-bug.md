# CC-CMD — Fix live UNION ALL schema-mismatch bug in findGame's espn: prefix lookup

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — real, confirmed live production bug

Commit `9ce9a10`'s own new post-deploy CI probe (`.github/workflows/post-deploy-live-verify.yml`) caught this on its very first run — genuinely working as designed, not a false alarm.

**Directly confirmed by replicating the exact real probe query myself:**
```
curl .../context/game/espn:760516
→ _errors: [{"source":"game","reason":"D1_ERROR: SELECTs to the left and right of
   UNION ALL do not have the same number of result columns: SQLITE_ERROR"}]
```

**Root cause, found via direct source inspection (`src/index.js` ~line 6307-6316):**
```sql
SELECT * FROM postseason_games WHERE espn_event_id = ?
UNION ALL SELECT * FROM regular_season_games WHERE espn_event_id = ?
LIMIT 1
```
`SELECT *` across two structurally different tables — `postseason_games` almost certainly has series-specific columns (`series_key`, `game_number`, etc.) that `regular_season_games` doesn't. `UNION ALL` requires both sides to have identical column counts; `SELECT *` on divergent schemas breaks this. This is a genuine schema-mismatch bug introduced by `9ce9a10`, not present before it — `node --check` (syntax-only) couldn't have caught it since it's a SQL string, not JS syntax.

**Impact:** every `/context/game/espn:{id}`-style request (the exact path the client now uses after today's `contextId` fix) currently returns `game: null` and zero briefs — actively broken in production right now, not a theoretical risk.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "UNION ALL SELECT \* FROM regular_season_games WHERE espn_event_id" src/index.js
# Confirm the real, current column sets differ (the actual cause) — don't assume, check
grep -n "CREATE TABLE regular_season_games\|CREATE TABLE postseason_games" src/index.js
```

If schema isn't defined in this file, query it directly via the D1 MCP tool (`PRAGMA table_info(postseason_games)` and same for `regular_season_games`) to confirm the real column-count/name mismatch before writing the fix — don't assume without checking.

---

## TASK 1 — Replace the single UNION ALL with two separate queries

```javascript
if (!row) {
    const m = /^[a-z]+:(\d+)$/.exec(id);
    if (m) {
        row = await env.ARCHIVE_DB.prepare(
            `SELECT * FROM postseason_games WHERE espn_event_id = ? LIMIT 1`
        ).bind(m[1]).first();
        if (!row) {
            row = await env.ARCHIVE_DB.prepare(
                `SELECT * FROM regular_season_games WHERE espn_event_id = ? LIMIT 1`
            ).bind(m[1]).first();
        }
    }
}
```

Real, minimal change — same real lookup intent (check postseason first, fall back to regular season), same real column access afterward (`row.opening_odds`, `row.drama_arc`, etc. — both tables' own native full row shape, no manual column alignment needed).

## TASK 2 — Real, literal verification

```bash
grep -n "SELECT \* FROM postseason_games WHERE espn_event_id" src/index.js
grep -n "SELECT \* FROM regular_season_games WHERE espn_event_id" src/index.js
node --check src/index.js
```
Paste real output — confirm the UNION ALL is genuinely gone, both real queries present.

## TASK 3 — Real, direct probe against the same failing case

```bash
node --check src/index.js  # syntax
git add src/index.js
git commit -m "fix: replace UNION ALL SELECT * (schema-mismatch bug) with two sequential queries in findGame espn: lookup"
git push -u origin main
```

After deploy, directly re-probe the exact same case that failed:
```bash
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/context/game/espn:760516
```
Confirm `game` is non-null and `_errors` no longer contains the `D1_ERROR`. This is the same real case the new CI probe checks — should also now pass on the next deploy's live-verify run.

---

## DONE CONDITION

The UNION ALL schema-mismatch is genuinely replaced with two sequential, schema-safe queries. Real probe against `espn:760516` (the exact case that failed) confirms `game` resolves and no `D1_ERROR` in `_errors`. Deploy green, and the post-deploy-live-verify workflow's own new probe passes on its next real run.

**Confidence scoring:**
- TASK 1 (50 pts): correct two-query replacement, same lookup semantics preserved
- TASK 2 (25 pts): real literal verification, UNION ALL confirmed removed
- TASK 3 (25 pts): real, direct probe against the exact failing case confirms the fix

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
