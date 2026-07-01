# Claude Code Command — Fix UTC Date-Boundary Archive Gap

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-utc-boundary-catchup-fix-2026-06-30.md.

## CONTEXT

Discovered live during the closing-odds capture session (2026-06-30):
`regular_season_games` has ZERO MLB rows for either 2026-06-29 or
2026-06-30, despite full slates played both nights — confirmed via direct
D1 query (`/d1/execute`) and live scores (e.g. PHI 8–0 PIT finished
~2026-07-01T00:40Z and is completely absent from the archive).

ROOT CAUSE: `handleJournalismCycle`'s `dateKey = new
Date().toISOString().slice(0,10)` is recomputed fresh on every cron tick
with no lookback. The catch-up gap-fill loop (~line 5630-5650, inside
`handleJournalismCycle`) only fetches ESPN's scoreboard for that single
current UTC date. Once UTC rolls past midnight (~20:00 EDT), any game
ESPN still indexes under the prior calendar date drops out of every
future tick's visibility — permanently, no re-check mechanism exists.
Most MLB games start 18:00–22:00 EDT (22:00–02:00 UTC) and finish after
UTC midnight, so this affects the majority of evening games nightly.

**CRITICAL CONSTRAINT — read before touching anything:** `dateKey` /
`espnDate` is also used earlier in the SAME function to build
`gameLines`/`gameMeta` for the actual journalism narrative content
("tonight's games"). That single-date scoping is intentional and
load-bearing — it was added June 1 2026 specifically to fix the "EPL
phantom" bug (stale prior-matchday games leaking into "tonight's games"
narrative when a league had no current fixture). **Do not broaden that
scope.** The fix here must be an isolated, separate ESPN fetch used ONLY
by the catch-up gap-fill sub-loop to find missed finals — it must never
feed into `gameLines`/`gameMeta` or any journalism-facing content path.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "async function handleJournalismCycle" src/index.js
sed -n '5286,5300p' src/index.js   # dateKey/espnDate computation
grep -n "_catchupFilled" src/index.js   # the existing catch-up loop
grep -n "const hour = new Date().getUTCHours" src/index.js
```

Confirm the exact bounds of the existing catch-up loop (currently
iterating `gameMeta` built from the single `espnDate` fetch) before
adding a second, parallel fetch. Confirm whether an hour-gate pattern
already exists elsewhere in this function that could reasonably bound
when the yesterday-check runs (e.g., only during the UTC hours where a
boundary-crossing game is plausible) — do not invent a new gating scheme
if a usable pattern already exists nearby.

## TASK: Add an isolated yesterday-catch-up fetch

Inside `handleJournalismCycle`, after the existing catch-up loop that
uses today's `gameMeta`, add a second, self-contained block:

1. Compute yesterday's date key (`dateKey` minus 1 day, UTC).
2. For each league in the same `LEAGUES` array, fetch ESPN's scoreboard
   for yesterday's `espnDate` equivalent — same endpoint pattern as the
   existing fetch, just a different date param.
3. Build a **separate** local array (not `gameMeta`, not `gameLines` —
   name it distinctly, e.g. `yesterdayFinals`) containing only events
   where `comp?.status?.type?.completed === true`.
4. Run the exact same catch-up logic already in place (existing-row
   check via `SELECT home_score ... LIKE '%'||shortId||'%'`, skip if
   already archived, else `POST /archive/game` with the same body shape
   used by today's catch-up, including `home_score`, `away_score`,
   `venue`, `source_id`, and — since this CC-CMD's prior session already
   added it — `start_time: gm.startTime` for the closing-odds capture to
   have a chance to fire on these too).
5. Wrap the entire yesterday-check block in try/catch — per Rule 5, this
   must never break the main journalism cycle if ESPN's yesterday
   scoreboard fetch fails or times out.
6. Do NOT merge `yesterdayFinals` into `gameLines`, `gameMeta`, or
   anything that reaches the journalism prompt. This block exists solely
   to POST missed finals to `/archive/game` — nothing more.

## TASK 2: Verification — CC-side scope is build/CI only

Same constraint as prior CC-CMDs this session: CC's egress blocks
`*.workers.dev`. Done condition for CC is code committed, CI green,
deploy completed (GitHub Actions API, not the live endpoint). State in
the outbox doc that live verification — confirming 6/29 and 6/30 MLB
rows actually backfill into `regular_season_games` after this deploy's
first few cron ticks — is a chat-side follow-up.

## TASK 3: Outbox manifest (last task)

Write `outbox/cc-utc-boundary-catchup-fix-2026-06-30.md` covering: what
the probe confirmed about the existing catch-up loop's exact structure,
what was built, CI/deploy status, and any deviation from this spec with
reasoning. Explicitly confirm the EPL-phantom guard (single-date scoping
of `gameLines`/`gameMeta`) was left untouched.
