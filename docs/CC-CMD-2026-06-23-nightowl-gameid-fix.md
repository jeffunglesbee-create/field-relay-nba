# CC-CMD — /archive/brief: add espn_event_id fallback to D1 lookup

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** One surgical edit to /archive/brief D1 lookup in src/index.js

---

## BACKGROUND (verified from source)

The /archive/brief D1 lookup at L7133-7143 tries to find the game row
by primary key (`id`). This works for relay-generated briefs (game_id =
"MLB_2026-06-20_cubs_bluejays" format). It fails for client-archived
night_owl / mlb_game / wnba_game briefs because the client passes FIELD
internal IDs like "mlb_arizonadiamo_minnesotatwi" — a different format.

Fix: add a second lookup by `espn_event_id` column. The client's
`topGame.sourceId` (ESPN numeric event ID, e.g. "401696473") — once the
client fix ships — will match `regular_season_games.espn_event_id` which
is populated going forward from today's schema change.

**Verified facts:**
- D1 lookup at L7133-7143 (confirmed from source)
- No espn_event_id fallback present (confirmed missing)
- night_owl game_id format: "mlb_arizonadiamo_minnesotatwi" — no D1 match
- D1 id format: "MLB_2026-06-20_cubs_bluejays" — different
- D1 espn_event_id: populated going forward from today (schema added)

---

## PRE-BUILD PROBE

```bash
sed -n '7129,7155p' src/index.js
```

---

## TASK 1 — Add espn_event_id fallback

Find the D1 lookup block (verify exact lines from probe). The current block:

```javascript
const _gRow = await (async () => {
    const r = await env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score, note
         FROM regular_season_games WHERE id = ? LIMIT 1`
    ).bind(game_id).first().catch(() => null);
    if (r) return r;
    return await env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score, NULL as note
         FROM postseason_games WHERE id = ? LIMIT 1`
    ).bind(game_id).first().catch(() => null);
})();
```

Replace with:

```javascript
const _gRow = await (async () => {
    // Try 1: primary key match (relay-generated briefs)
    const r = await env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score, note
         FROM regular_season_games WHERE id = ? LIMIT 1`
    ).bind(game_id).first().catch(() => null);
    if (r) return r;
    // Try 2: espn_event_id match (client night_owl/mlb_game briefs pass
    // topGame.sourceId = ESPN numeric event ID as game_id)
    const r2 = await env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score, note
         FROM regular_season_games WHERE espn_event_id = ? LIMIT 1`
    ).bind(game_id).first().catch(() => null);
    if (r2) return r2;
    // Try 3: postseason primary key
    return await env.ARCHIVE_DB.prepare(
        `SELECT home, away, home_score, away_score, NULL as note
         FROM postseason_games WHERE id = ? LIMIT 1`
    ).bind(game_id).first().catch(() => null);
})();
```

---

## TASK 2 — Deploy and verify

```bash
# After deploy: archive a test night_owl brief with a known ESPN event ID
# and verify _archiveGameCtx gets populated (check AI Gateway logs or
# probe /quality/report for night_owl with above_240 > 0 tomorrow)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify"
```

Done condition: deploy success. Functional verification is overnight
(tonight's night_owl brief will be the first to benefit).

---

## TASK 3 — Outbox manifest

Write `outbox/cc-nightowl-gameid-fix-2026-06-23.md`:
- Commit + deploy run ID
- Confirm espn_event_id fallback added (3 tries: primary, espn_event_id, postseason)

---

## SCOPE
- Edit D1 lookup block in /archive/brief handler in src/index.js
- Single commit + deploy
- DO NOT touch journalism-quality.js, context-assembler.js, or jubilant-bassoon
