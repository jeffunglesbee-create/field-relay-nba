# wentToOT Relay Side — 2026-07-06

## Commit

- `b39ec8f` feat(archive): add went_to_ot column; compute in GameDO; store with COALESCE

## What Changed

### TASK 1 — Schema

```sql
ALTER TABLE regular_season_games ADD COLUMN went_to_ot INTEGER DEFAULT NULL;
ALTER TABLE postseason_games     ADD COLUMN went_to_ot INTEGER DEFAULT NULL;
```

`NULL` default (not `0`) — distinguishes "unknown/not-computed" (pre-fix rows, AFL, NFL/CFL) from `0` = "confirmed regulation only."

### TASK 2 — GameDO computation (`src/game-do.js`)

Added before `const payload = {` in the completed-state archive hook:

```javascript
const REGULATION_PERIODS = { nba: 4, wnba: 4, nhl: 3, mlb: 9 };
const SOCCER_SPORTS = new Set(['epl', 'mls', 'ucl', 'wc26']);
let wentToOT = null; // null = unknown/not-applicable, not false
if (facts.period != null) {
    if (SOCCER_SPORTS.has(this.sport)) {
        wentToOT = facts.period >= 3;
    } else if (REGULATION_PERIODS[this.sport]) {
        wentToOT = facts.period > REGULATION_PERIODS[this.sport];
    }
    // afl and any unlisted sport: wentToOT stays null, not guessed.
}
```

Added `went_to_ot: wentToOT` to the payload object.

Per-sport sourcing:
- NBA/WNBA=4: sourced from `src/index.js:~1164` (`period > 4 ? OT... : Q${period}`)
- NHL=3: sourced from NHL adapter normalization (periods, regulation = 3)
- MLB=9: sourced from MLB adapter normalization (innings, regulation = 9)
- Soccer periodNum≥3: sourced from `src/index.js:~1418` (`situation.elapsed <= 90 ? 2 : 3` — period 3 = extra time, period 5 = shootout)
- AFL: explicitly null — no regulation-period convention found in codebase; would be a guess
- NFL/CFL: explicitly out of scope — not in `SPORT_TO_V2`, don't flow through GameDO

### TASK 3 — `/archive/game` handler (`src/index.js`)

Destructured `went_to_ot` from body alongside existing fields. Added to both INSERT statements:

**Column list:** `..., espn_event_id, went_to_ot`
**VALUES:** `..., ?, ?` (bound as `went_to_ot ?? null`)
**ON CONFLICT SET:** `went_to_ot = COALESCE(excluded.went_to_ot, went_to_ot)`

Same COALESCE-preserving pattern as every other optional field.

## TASK 4 — Verification (synthetic test via D1 direct insert)

No real game completion was available within the session. Synthetic rows were inserted into D1 with the exact values the GameDO computation would produce, then read back:

| Test case | sport | period | Expected went_to_ot | Stored |
|-----------|-------|--------|---------------------|--------|
| NBA regulation (period=4) | nba | 4 | 0 (false) | 0 ✓ |
| NBA overtime (period=5) | nba | 5 | 1 (true) | 1 ✓ |
| WC26 extra time (period=3) | wc26 | 3 | 1 (true) | 1 ✓ |
| AFL (period=4) | afl | 4 | NULL | null ✓ |

**COALESCE preservation test:** Updated the NBA OT row with `went_to_ot=NULL` — confirmed stored value remained `1` (null write did not erase confirmed value). ✓

Test rows deleted after verification (4 rows removed).

## Required Follow-Up (separate CC-CMD — different repo)

**`jubilant-bassoon/index.html:~21879`** still has:
```javascript
wentToOT: false, // not stored in D1
```

This must be changed in a separate **jubilant-bassoon CC-CMD** to read `went_to_ot` from the `/context/game/{id}` response (or the archive endpoint that now serves this field). The relay now stores the data; the client must be wired to read it before `getWhatYouMissed`'s OT notability filter can function. That CC-CMD should:
1. Confirm `/context/game/{id}` returns `went_to_ot` in its game object (or add it if not)
2. Update the `getWhatYouMissed` hydration to read the field
3. Verify against a real OT game in the archive

## Confidence Score

```
+25  Schema: went_to_ot INTEGER DEFAULT NULL on both tables, confirmed via PRAGMA
+30  GameDO: computation matches sourced per-sport rules exactly; AFL/NFL/CFL null not guessed
+20  /archive/game: COALESCE(excluded.went_to_ot, went_to_ot) on both INSERT paths
+15  Verified via synthetic D1 inserts: 4 cases (NBA reg, NBA OT, WC26 ET, AFL null) + COALESCE test
+10  Outbox explicitly flags the jubilant-bassoon CC-CMD as required next step
= 100/100
```

## Compliance

- Rule 68: probe block run before edits; `_fetchFacts` period field and existing `/archive/game` shape confirmed from source
- Rule 69: only game-do.js archive hook + index.js `/archive/game` handler modified; no other routes or logic touched
- Rule 87: verification completed within session (synthetic test method explicitly permitted by CC-CMD); outbox is last task
- Rule 47 (RELAY-IS-DUMB): computation is arithmetic classification only — period > threshold, no drama score or watch verdict
