# CC-CMD: Track silent win-probability resolution failures — reuse the existing incident convention

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source:** a real, currently-silent failure path, found by tracing the
actual pick-resolution flow, not theorized. When a resolved pick's game
finishes, the client sends `pick_resolved` to `/user/event`. This relay
handler resolves a win probability server-side and attaches it to the
response — but if `resolveWinProbability()` returns falsy for any
reason, or throws (currently caught silently:
`catch (_) { /* non-fatal */ }`), execution falls through to
`return doResp;` with no probability ever attached, no record anywhere
that it happened. The client symptom (a resolved pick card showing no
percentage) is the last, least useful place this becomes visible.

**Deliberately not building new infrastructure.** `session_health`
already surfaces any `codex` row with `category='incident'` via
`open_incidents` — confirmed directly: `SELECT key, title FROM codex
WHERE category = 'incident' AND (status IS NULL OR status != 'resolved')`.
Writing correctly into this existing convention needs zero changes to
`session_health` itself.

**One real design choice, made explicitly, not left implicit:** a
single failure could recur often (any game, any sport, any night).
Writing a new codex row per occurrence would flood `open_incidents`
with near-duplicates over time, drowning out real, unrelated
incidents. Use one stable, upserted key instead — matching the same
aggregation pattern already established for `cc-cmd-queue` tracking
(same key, incremented `reminder_count`) rather than unbounded rows.

## PROBE BLOCK
```bash
sed -n '6862,6882p' src/index.js
grep -n "INSERT INTO codex" src/index.js | head -3
```
Confirm the exact failure branch and codex schema still match before
editing.

## TASK — Write a stable, upserted incident on failure

At the point `wp` comes back falsy or the catch fires (both currently
silent), add:
```javascript
if (evtBody?.type === 'pick_resolved' &&
    evtBody.sport && evtBody.predictedWinner &&
    evtBody.revealedProbability == null) {
    try {
        const wp = await resolveWinProbability(
            evtBody.sport,
            { gameId: evtBody.gameId, predictedWinner: evtBody.predictedWinner },
            env
        );
        if (wp) {
            evtBody.revealedProbability = wp.probability;
            evtBody.probabilitySource   = wp.source;
            resolvedWP = wp;
        } else {
            await _recordWpResolutionFailure(env, evtBody.sport, evtBody.gameId, 'resolveWinProbability returned null');
        }
    } catch (e) {
        await _recordWpResolutionFailure(env, evtBody.sport, evtBody.gameId, e.message || 'threw');
    }
}
```
Add the helper, using a single stable key, upserted (not a new row per
failure):
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
            ON CONFLICT(key) DO UPDATE SET title=excluded.title, content=excluded.content, status='open', updated_at=datetime('now')
        `).bind(
            `WP resolution failed ${count}x (most recent: ${sport} ${gameId})`,
            JSON.stringify({ count, recent })
        ).run();
    } catch (_) { /* best-effort tracking, must never break pick resolution itself */ }
}
```
Confirm the real `codex` table's actual conflict-resolution syntax
(`ON CONFLICT` vs. a manual select-then-insert-or-update) against how
existing `INSERT INTO codex` call sites in this file handle upserts —
do not assume SQLite's `ON CONFLICT` clause is used elsewhere the same
way without checking.

**This must never break real pick resolution** — wrap the whole
tracking call so a tracking failure can't turn into a resolution
failure. The existing `catch (_) { /* non-fatal */ }` around the outer
WP-resolution attempt must still allow `doResp` to be returned normally
even if `_recordWpResolutionFailure` itself throws.

## VERIFICATION

- `node --check src/index.js`.
- Confirm via real D1 query that the row upserts correctly on a second
  simulated failure (count increments, doesn't create a second row) —
  report the actual query result, not a hypothetical.
- Confirm a real `session_health` call surfaces this in `open_incidents`
  once at least one failure has been recorded — report the actual
  returned field.
- Confirm the existing, working resolution path (a real successful
  `pick_resolved` call with a valid probability) is completely
  unaffected — this is additive only to the failure branch.

## DONE CONDITIONS
- [ ] Probe block confirms citations before editing
- [ ] `_recordWpResolutionFailure` added, both failure branches (falsy `wp`, thrown exception) now call it
- [ ] Upsert confirmed via real D1 query — single row, count increments correctly
- [ ] Confirmed via real `session_health` call that this surfaces in `open_incidents`
- [ ] Confirmed the tracking call itself cannot break real pick resolution
- [ ] Confirmed the successful-resolution path is unaffected
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+25  Both failure branches correctly call the tracking helper
+25  Upsert verified via real D1 query, not assumed
+20  Confirmed via real session_health call that this surfaces correctly
+15  Confirmed tracking failure cannot break real resolution
+15  Confirmed successful-resolution path unaffected

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-wp-resolution-failure-tracking.md.
Add _recordWpResolutionFailure, called from both silent failure branches
in the pick_resolved WP handler (falsy wp, thrown exception). Use a
single upserted codex key ('wp-resolution-failures', category:incident),
not a new row per occurrence -- confirm the real upsert syntax against
existing codex INSERT call sites rather than assuming ON CONFLICT is
used the same way elsewhere. Verify via a real D1 query that it upserts
correctly, and a real session_health call that it surfaces in
open_incidents. The tracking call must never be able to break real
pick resolution. Do not commit unless confidence >= 95. If score < 95,
report verbatim and stop.
