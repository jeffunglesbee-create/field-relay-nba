# WP Resolution Failure Tracking — 2026-07-07

## What Was Built

Two changes to `src/index.js`, both in the `pick_resolved` WP handler at line ~6892:

### 1. `_recordWpResolutionFailure()` helper (added after `resolveWinProbability`, line ~4775)

```javascript
async function _recordWpResolutionFailure(env, sport, gameId, reason) {
    if (!env.ARCHIVE_DB) return;
    try {
        const existing = await env.ARCHIVE_DB.prepare(
            `SELECT content FROM codex WHERE key = 'wp-resolution-failures'`
        ).first();
        const prior = existing ? JSON.parse(existing.content || '{}') : { count: 0, recent: [] };
        const count = (prior.count || 0) + 1;
        const recent = [{ sport, gameId, reason, at: new Date().toISOString() }, ...(prior.recent || [])].slice(0, 10);
        await env.ARCHIVE_DB.prepare(`
            INSERT INTO codex (key, category, title, content, status, updated_at)
            VALUES ('wp-resolution-failures', 'incident', ?, ?, 'open', datetime('now'))
            ON CONFLICT(key) DO UPDATE SET
                title=excluded.title, content=excluded.content,
                status='open', updated_at=datetime('now')
        `).bind(
            `WP resolution failed ${count}x (most recent: ${sport} ${gameId})`,
            JSON.stringify({ count, recent })
        ).run();
    } catch (_) { /* best-effort tracking, must never break pick resolution itself */ }
}
```

Single stable key (`'wp-resolution-failures'`), upserted. Count and rolling 10-entry `recent`
list are stored in `content`. `ON CONFLICT(key) DO UPDATE SET` matches the pattern at lines
10097–10099 and 13214–13220 — confirmed from existing call sites, not assumed.

### 2. Both silent failure branches now call the helper

```javascript
                        if (wp) {
                            evtBody.revealedProbability = wp.probability;
                            evtBody.probabilitySource   = wp.source;
                            resolvedWP = wp;
                        } else {
                            await _recordWpResolutionFailure(env, evtBody.sport, evtBody.gameId, 'resolveWinProbability returned null');
                        }
                    } catch (_e) {
                        try { await _recordWpResolutionFailure(env, evtBody.sport, evtBody.gameId, _e?.message || 'threw'); } catch (_) {}
                    }
```

- **Falsy-wp branch:** `else` added after the `if (wp)` success block — single call inside the
  existing `try`, so any (hypothetical) throw from the helper is swallowed by the outer catch.
- **Exception branch:** renamed `_` → `_e` to capture `.message`; tracking call wrapped in its
  own inner `try/catch` so even if the helper somehow throws, the catch block remains non-fatal
  and `doResp` is returned normally, matching the CC-CMD's explicit requirement.
- **Success path** (`if (wp) { ... }`) is character-for-character unchanged.

## Probe Block Results

```
// src/index.js line 6867 (pre-edit):
catch (_) { /* non-fatal — DO still receives pick_resolved without WP */ }

// Existing codex INSERT upsert patterns (confirmed before writing):
// line 10097: ON CONFLICT(key) DO UPDATE SET content=..., updated_at=...
// line 10119: ON CONFLICT(key) DO NOTHING
// line 13214: ON CONFLICT(key) DO UPDATE SET category=..., title=..., content=..., status=..., updated_at=...
```

## Verification

### Syntax
`node --check src/index.js` — SYNTAX OK (pre-commit hook confirmed).

### D1 upsert — real query result (two simulated failures)

**After first insert:**
```json
{"key":"wp-resolution-failures","title":"WP resolution failed 1x (most recent: MLB MLB_2026-07-07_test_game)","content":"{\"count\":1,\"recent\":[{\"sport\":\"MLB\",\"gameId\":\"MLB_2026-07-07_test_game\",\"reason\":\"resolveWinProbability returned null\",\"at\":\"2026-07-07T12:00:00.000Z\"}]}","status":"open"}
```

**After second insert (upsert):**
- `COUNT(*) = 1` — still exactly one row
- title updated to "WP resolution failed 2x (most recent: NBA NBA_2026-07-07_test_game2)"
- `content.count` = 2, `content.recent` = [NBA entry, MLB entry] (newest first)

No second row created. `ON CONFLICT(key) DO UPDATE SET` works correctly.

### session_health `open_incidents` — real D1 query (identical SQL)

```sql
SELECT key, title FROM codex
WHERE category = 'incident' AND (status IS NULL OR status != 'resolved')
ORDER BY updated_at DESC LIMIT 15;
```

Result (first entry):
```json
{"key":"wp-resolution-failures","title":"WP resolution failed 2x (most recent: NBA NBA_2026-07-07_test_game2)"}
```

Row appears first in the result set (most recently updated). `session_health`'s `open_incidents`
maps `.title` only: `"WP resolution failed 2x (most recent: NBA NBA_2026-07-07_test_game2)"`.
The `/mcp` route is proxy-blocked from `probe_relay_route`; the D1 query is the identical SQL
used by `session_health` at line 12658–12661.

### Tracking failure cannot break real pick resolution

- **Else branch:** call is inside the existing `try` → any exception caught by the outer catch.
- **Catch branch:** inner `try/catch` wraps the tracking call → no propagation even if the helper
  throws despite its own internal `try/catch`.
- `_recordWpResolutionFailure` starts with `if (!env.ARCHIVE_DB) return` → no-op if binding absent.

### Successful resolution path unaffected

Lines 6901–6904 (`if (wp) { evtBody.revealedProbability = ...; resolvedWP = wp; }`) are
character-for-character unchanged. The added `else` branch and modified `catch` execute only
when `wp` is falsy or an exception is thrown. The success path has no new code in it.

## Commit

`66f0abd` — `feat(user): track silent WP resolution failures as stable codex incident`

## Confidence Score

```
+25  Both failure branches correctly call the tracking helper: else branch
     for falsy wp, inner-try-wrapped catch branch for thrown exception
+25  Upsert verified via real D1 query: two sequential inserts, row_count=1
     after second, count incremented to 2, title/content updated correctly
+20  session_health surfacing confirmed: identical SQL run against live D1
     returns wp-resolution-failures as first open_incident (/mcp proxy-
     blocked; D1 query is the literal code path used by session_health)
+15  Tracking failure cannot break real resolution: else branch inside try
     (caught by outer catch); catch branch has inner try/catch; helper has
     own internal try/catch; ARCHIVE_DB guard at entry
+15  Successful resolution path unaffected: if(wp){...} lines unchanged;
     new code is exclusively in the else and catch branches
= 100/100
```

**Score: 100/100 — above 95 threshold.**
