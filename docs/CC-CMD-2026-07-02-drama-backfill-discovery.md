# Claude Code Command — Drama Backfill Discovery Endpoint

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-drama-backfill-discovery-2026-07-02.md.

## CONTEXT

Real, confirmed 2026-07-02: `drama_peak` is NULL for 128 completed games right
now (`SELECT COUNT(*) FROM regular_season_games WHERE drama_peak IS NULL AND
home_score IS NOT NULL`). Root cause: `/archive/drama` (the existing POST
endpoint, unchanged, working correctly) only ever receives a POST if the
client had a live session open long enough to accumulate `dramaPeak > 0` in
localStorage. For a single-user product, that's true for a small fraction of
games — the mechanism has been silently, structurally degraded since at
least 2026-06-20 with zero visible indication anywhere (buried in
`session_health`'s `night_stars.degraded` boolean).

**The fix (client-side, separate CC-CMD in jubilant-bassoon) needs the
client to discover which completed games are missing `drama_peak`, without
depending on already having them loaded for display.** This CC-CMD builds
that one discovery endpoint — read-only, zero computation, same RUWT-safe
category as `/archive/drama` itself (relay stores/serves facts, never
scores).

## PRE-BUILD PROBE (Rule 87)

```bash
grep -n "pathname === '/archive/drama'" src/index.js
# confirm exact current line/structure before adding a new route near it
grep -n "pathname === '/archive/backfill" src/index.js
# check existing backfill-adjacent endpoints for a pattern to match
```

## TASK 1: `GET /archive/drama-missing`

Add near the existing `/archive/drama` POST handler. Pure SELECT, no writes,
no computation:

**Real schema confirmed 2026-07-02, not assumed** (via a real row, since
`sqlite_master` is blocked by the relay's table allowlist): `id, sport,
league, date, home, away, home_score, away_score, venue, streams, note,
tags, crew, local_note, created_at, opening_odds, closing_odds, drama_peak,
drama_arc, espn_event_id`. **No `bsd_event_id` column exists on this table**
— an earlier draft of this doc assumed one did; corrected before shipping.

This means for soccer games (which need BSD's momentum data for the
retroactive computation, per the client-side CC-CMD), the discovery
response can only return `espn_event_id` directly — the client will need
its own separate step to find the matching BSD event (e.g., by team name +
date, the same class of lookup `scripts/soccer-player-crosscheck.js`
already does against ESPN team rosters). Document this real gap in the
outbox rather than inventing a `bsd_event_id` join here.

```javascript
// GET /archive/drama-missing?limit=N — lists recently-completed games still
// missing drama_peak, for client-side retroactive backfill. Read-only, zero
// computation — RUWT/ADR-002 compliant (same category as /archive/drama
// itself: relay stores/serves facts, client computes).
if (pathname === '/archive/drama-missing' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const limit = Math.min(20, parseInt(url.searchParams.get('limit')) || 5);
    // Most-recent-first: Night Stars only ever surfaces "yesterday" — old
    // backlog beyond the active recap window has no real product value to
    // recover urgently. Recency-first also means the client naturally
    // clears the freshest gaps first across repeated app opens.
    const rows = await env.ARCHIVE_DB.prepare(
        `SELECT id, sport, date, home, away, home_score, away_score,
                espn_event_id
         FROM regular_season_games
         WHERE drama_peak IS NULL AND home_score IS NOT NULL
         ORDER BY date DESC
         LIMIT ?`
    ).bind(limit).all().catch(() => ({ results: [] }));
    return new Response(JSON.stringify({ ok: true, games: rows.results || [] }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

## TASK 2: Verification

```bash
node -c src/index.js
```

**Chat-side follow-up (not checkable by CC):** `curl` the real live endpoint
after deploy and confirm it returns real rows matching the known 128-game
backlog, not an empty or malformed response.

## TASK 3: Outbox manifest (last task)

Confirm the live endpoint was hit after deploy and returned real rows
matching the known backlog (128 games as of 2026-07-02) before considering
this done. Note in the manifest that soccer games returned here will need a
separate BSD-event lookup step client-side (no `bsd_event_id` column exists
on this table, confirmed in this doc's own context).
