# Claude Code Command — Pre-Game Slate Seeding (enables opening_odds capture)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-pregame-slate-seed-2026-06-30.md.

## CONTEXT

No automated pre-game row-seeding exists for any league except World Cup
(`handleWCAdminSeed` — manual, admin-auth-gated, single-game, not a cron).
Every other league's `regular_season_games`/`postseason_games` row is only
created by (a) a client opening the app triggering a live `GameDO` write,
or (b) the catch-up loop creating it post-final. `snapshotCronOdds()`
(opening_odds capture) only attaches odds to EXISTING rows — if nobody
visits the app while a game is live, there's no row for `opening_odds` to
ever land on, and it's unrecoverable once the game starts.

Live proof (2026-06-30 session): the UTC-boundary catch-up fix backfilled
3 MLB + 1 WNBA game from 6/30 that finished with nobody watching. All 4
show `hasClosing: true` (the new capture works) but `hasOpening: false`
permanently — `[ODDS STORY]` can never fire for them.

**IMPORTANT — simpler than originally scoped:** this does NOT need a new
cron. `handleJournalismCycle` already fetches every league's ESPN
scoreboard on every existing 15-min tick and builds `gameMeta` containing
ALL of today's games — final, live, AND pre-game (each entry already
carries `isFinal: comp?.status?.type?.completed === true`). The existing
catch-up loop (~line 5627-5660) filters this down with `if (!gm.isFinal
|| !gm.eventId) continue;` before archiving. The fix is a second,
parallel pass over the SAME already-fetched `gameMeta` — no filter on
`isFinal`, so pre-game and live games get skeleton rows too — not a new
fetch, not a new schedule.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "async function handleJournalismCycle" src/index.js
sed -n '5590,5665p' src/index.js   # gameMeta build + existing (isFinal) catch-up loop
grep -n "pathname === '/archive/game'" src/index.js
grep -n "ON CONFLICT(id) DO UPDATE" src/index.js
grep -n "const ODDS_QUOTA_FLOOR" src/index.js
```

Confirm exactly what `/archive/game`'s `ON CONFLICT` clause does when
`home_score`/`away_score` are omitted or null in the POST body — this
CC-CMD depends on `COALESCE(excluded.home_score, home_score)` correctly
preserving any existing real score and inserting NULL only for genuinely
new (pre-game) rows. Do not assume — read it directly and confirm before
writing Task 1.

## TASK 1: Seed skeleton rows for all of today's games

Immediately after the existing `isFinal`-filtered catch-up loop
(~line 5660, right where `_catchupFilled` logging happens), add a second
loop over the SAME `gameMeta` array — this time with NO `isFinal` filter
(only require `gm.eventId`). For each entry not yet in the archive (reuse
the exact same `SELECT home_score ... LIKE '%'||shortId||'%'` existing-row
check already used above), POST to `/archive/game` with `home_score` and
`away_score` omitted/null (do not send 0 or any placeholder — must be a
true skeleton row so downstream code can distinguish "not yet played"
from "0-0"). Include `venue`, `source_id`, and `start_time` (same field
added for closing-odds capture) so `opening_odds`'s consumer has what it
needs later.

Wrap the entire block in try/catch (Rule 5 — must never break the
journalism cycle). Name it distinctly from the existing catch-up
variables (e.g. `_seededCount`) so log lines stay distinguishable.

## TASK 2: Explicit scope boundary — do not touch quota logic

`snapshotCronOdds()`'s existing `ODDS_QUOTA_FLOOR` guard is the correct,
sufficient mechanism for handling the resulting increase in
opening-odds-eligible rows — do not add new quota-prioritization logic in
this CC-CMD. This is a known, accepted tradeoff: seeding more rows means
more competition for the same daily Odds API quota, and on high-volume
days some sports may now hit the floor sooner than before. That's
acceptable and observable later via `/odds-story/preview`'s
`missingOpening` counts — it is explicitly NOT something to solve here.

## TASK 3: Verification — CC-side scope is build/CI only

Same constraint as every CC-CMD this session: CC's egress blocks
`*.workers.dev`. Done condition for CC is code committed, CI green,
deploy completed (GitHub Actions API, not the live endpoint). State in
the outbox doc that live verification — confirming skeleton rows appear
for tomorrow's slate ahead of first pitch, and that `opening_odds`
subsequently attaches to them — is a chat-side follow-up for tomorrow,
not something checkable tonight (no games are pre-game right now).

## TASK 4: Outbox manifest (last task)

Write `outbox/cc-pregame-slate-seed-2026-06-30.md` covering: what the
probe confirmed about the `ON CONFLICT`/COALESCE behavior for null
scores, what was built, CI/deploy status, and any deviation from this
spec with reasoning.
