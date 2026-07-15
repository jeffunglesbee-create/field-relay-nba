# CC-CMD: JOURNALISM_QUEUE failure visibility + WC26 finals sweep gap — outbox

**Date:** 2026-07-15
**Doc:** docs/CC-CMD-2026-07-15-queue-dlq-wc26-sweep-gap.md
**Commit:** (this outbox is committed alongside the fix commit; see git log for hash)

## Confidence score: 89/100 — below the 95 commit threshold, committed on explicit user override

Per the CC-CMD's instruction ("Do not commit unless confidence >= 95. If score < 95, report verbatim and stop"), the score was computed, reported verbatim to the user, and the session paused without committing. A repo Stop hook then flagged the uncommitted working tree. Rather than resolve that conflict unilaterally, the user was asked directly via AskUserQuestion whether to commit anyway, wait for live dead-hours verification (~4+ hours away), discard the change, or split the diff. **The user chose "Commit now anyway"** — an explicit, informed override of the 95 gate, made with the exact score breakdown and the specific unverified piece (TASK 1b's live cron-firing) disclosed beforehand. This is documented here so the override is traceable, not silently absorbed into a clean-looking score.

## TASK 0 — Probe (20/20)

Re-probed every line reference in the CC-CMD doc against current HEAD (not reused from when the doc was written) via fresh `grep`:
- `writeWCResult` — `src/index.js:2037` (confirmed unchanged)
- `handleJournalismCycle` — `src/index.js:6144` (pre-edit)
- Queue consumer `async queue(batch, env, ctx)` — `src/index.js:14835` (pre-edit)
- `job.type === 'game-brief'` branch — `src/index.js:14842` (pre-edit)
- `wrangler.toml` `max_retries = 3`, line 157, confirmed no `dead_letter_queue` key exists anywhere in the file.

Confirmed the `queue()` consumer has exactly two branches — `job.type === 'game-brief'` and the `jobId` fallback route — and only `game-brief` has the silent-drop-on-final-failure pattern; the `jobId` route already writes a `{status:'failed'}` KV marker on final failure.

Live current coverage-gap count (not reused from the prior session's "8"): **0**, confirmed two independent ways:
1. `regular_season_games` (sport='FIFA World Cup', `finalized_at IS NOT NULL`, `espn_event_id IS NOT NULL`) joined against `briefs` (`brief_type='game_recap'`, matched with/without `espn:` prefix) via `NOT EXISTS` — 0 rows.
2. Direct content check on the most recently finalized game (England vs Argentina, `espn_event_id=760515`, finalized 21:05:36 UTC today) — confirmed its `briefs` row (`game_id='760515'`, `source='cron'`) contains a real generated recap ("Argentina defeated England 2-1..."), not a placeholder.

**Real, unplanned finding during probing:** `wc_results` (lives in `WC2026_DB`, a *separate* D1 binding from `briefs`/`regular_season_games` in `ARCHIVE_DB`) carries **two parallel row sets per match** — legacy `football:{id}` rows from an earlier API-Sports-based writer (created 2026-06-12) and current `espn:{id}` rows from the ESPN pipeline (created 2026-07-05, evidently a backfill). Only the `espn:` rows are relevant to brief generation (`writeWCResult`'s `game.id` is always `espn:{eventId}` for the current pipeline). `pickWC26BriefGaps` filters to `game_id LIKE 'espn:%'` specifically for this reason — confirmed live via the public `/wc/results` endpoint (`wc_results` isn't in `/d1/execute`'s `ALLOWED_TABLES`, so this route was used instead for read verification).

## TASK 1a — Fix: `game-brief` queue failure marker (25/25)

Added a KV write on final failure (`msg.attempts >= 3`) inside the `game-brief` catch block (`src/index.js`, inside `async queue()`): writes `{status:'failed', error, failedAt, sport}` to **`brief:game:{eventId}:failed`** — a NEW, separate key, not the existing `brief:game:{eventId}` key. Checked for an existing `:failed`-suffix convention first (Rule 62) — found none elsewhere in the codebase; the `jobId` route's own failure marker overwrites a single evolving `jobs:{jobId}` key rather than using a suffix. Deliberately did NOT reuse that exact key for `game-brief`, because `brief:game:{eventId}` holds the real generated brief consumed by: the dedup check earlier in the same function (`parsed.contextHash === job.gameHash`) and downstream brief readers. Overwriting it with a failure marker on a later failed attempt would destroy a previously-successful brief from an earlier, valid game state — a real, avoided regression, not a hypothetical one.

No `wrangler.toml` changes. Attempts 1 and 2 still call `msg.retry()` with zero KV writes, unchanged from before.

**Verified:** 17 forced-condition assertions (`/tmp/.../scratchpad/test-failure-marker.mjs`, code deleted after use) covering attempts 1, 2, 3, and 5 (Cloudflare Queues can occasionally redeliver past `max_retries` on edge cases) — all pass. Confirms: no premature ack/write on attempts 1–2; correct key, shape, and field values on attempt 3+; success key never touched.

## TASK 1b — Fix: WC26 finals coverage sweep (28/35)

Added `pickWC26BriefGaps(env, limit)` (`src/index.js`, placed immediately before `pickNextBackfillDate`): queries `WC2026_DB.wc_results` (`phase='group'`, `game_id LIKE 'espn:%'`) and `ARCHIVE_DB.briefs` (`brief_type='game_recap'`) separately — cross-DB join isn't possible since they're different D1 bindings — and diffs them in JS, normalizing the `espn:` prefix both ways (the same mismatch documented in the prior session's outbox). Returns up to `limit` oldest-first gaps.

Wired into `handleJournalismCycle`'s existing dead-hours block (`if (!isLiveHours) { ... }`, UTC 02:00–10:00), right after the existing series-preview backfill, in its own try/catch (Rule 5 — never breaks the cron). For each gap found (capped at 3/tick — Rule 76/78, bounded and cost-conscious): a per-game KV tried-marker (`wc26_sweep:tried:{game_id}`, 30-day TTL, mirrors the existing `backfill:tried:{date}` convention) prevents retrying a game that fails deterministically; a cross-check compares `extractWCGroup('', home, away)` (team-name-only derivation, no `round` string available from the D1 row) against the already-known `wc_results.group_id` before calling `writeWCResult` — on mismatch, skip and mark tried rather than risk filing under the wrong group. `writeWCResult` is called directly (not duplicated) with a minimal synthetic `game` object built from the D1 row.

No new cron entry, no `wrangler.toml` change — confirmed via `git diff wrangler.toml` (empty).

**Verified, logic-level:**
- Set-diff logic: 6 forced-condition cases (`/tmp/.../scratchpad/test-wc26-gap-diff.mjs`) — bare/prefixed id matching, genuine-gap detection, limit capping, date-ordering. All pass.
- Group cross-check: `extractWCGroup('', home, away)` run against **all 81 real group-stage games played so far this tournament** (pulled live from `/wc/results`, filtered to `phase='group'` and `espn:`-prefixed) — **0 mismatches** against the known `group_id`. Notably, no false confidence from an incomplete team-name map: e.g. "Bosnia-Herzegovina" (hyphenated) isn't itself a key in `_WC_TEAM_GROUP` (only "bosnia and herzegovina"/"bosnia & herzegovina" are), but every real fixture involving that team also involves an opponent whose name *is* a direct map hit, so the `home || away` fallback still resolves correctly in all 81 cases. This is disclosed as a real, non-hypothetical edge in the underlying map — not a bug in this sweep, but worth knowing: a future fixture where *neither* team's name is a clean map hit would correctly trip the mismatch-skip safety check rather than silently misfile, which is exactly the scenario the cross-check exists for.

**NOT verified — the disclosed gap (7 points docked):** the sweep only runs inside `handleJournalismCycle`'s dead-hours branch (UTC 02:00–10:00). At the time of this dispatch it was UTC ~21:40 (live hours). The admin trigger `/journalism/run?force=true` was checked and confirmed its `force` flag only bypasses a KV-cache check inside the *live-hours* branch (line ~6838), not the `isLiveHours` gate itself — so it cannot be used to force the dead-hours branch on demand. Two ways to force a live test were considered and rejected as out of scope for this dispatch: (a) adding a new bypass mechanism to `handleJournalismCycle` — an unrequested structural change; (b) writing a synthetic missing-brief row directly into `WC2026_DB.wc_results` — `wc_results` isn't in `/d1/execute`'s `ALLOWED_TABLES` allowlist, and adding it wasn't authorized. Waiting ~4+ hours in-session for the real dead-hours window was also rejected as impractical for a single dispatch. **Net effect: the sweep's own diff/cross-check logic is thoroughly verified in isolation; its actual firing inside the live cron has not been observed.**

## TASK 2 — Verify (16/20)

- `node --check src/index.js`: clean.
- `git diff --stat`: only `src/index.js` touched, 97 insertions / 3 deletions. `wrangler.toml` untouched.
- 17 + 6 + 81 = 104 total passing forced-condition/cross-check assertions across both fixes.
- Real live "before" state confirmed: 0 current WC26 brief gaps (TASK 0).
- **Not obtained:** a real live "after" state showing the sweep closing an actual gap, and no genuine end-to-end cron-firing — same disclosed limitation as TASK 1b.

## DONE CONDITION — partially met, disclosed honestly

`game-brief` queue jobs that exhaust retries now leave a real, queryable failure record — this is fully shipped and verified. WC26 games that go final are *intended* to be guaranteed a brief within one `handleJournalismCycle` cycle regardless of client re-requests — the code implementing this is written, unit-verified at the logic level (including against 81 real games), and deployed, but its live cron-firing behavior has not yet been directly observed in this session. No `wrangler.toml` changes made (confirmed). No redundant regeneration risk found in the diff logic (verified via forced tests), though this too hasn't been observed against a real live gap since none currently exists.

## Recommended follow-up (not a new CC-CMD — this is a verification-only residual, per Rule 87)

After the next UTC 02:00–10:00 window, check `session_health` or query `briefs`/KV for `wc26_sweep:tried:*` keys to confirm the sweep fired at least once (even a no-op "0 gaps found" tick is confirmation the code path executed without error). If a genuine WC26 gap appears before then (a game finalizes without a client re-requesting its date), that will double as the real end-to-end proof this dispatch couldn't obtain.
