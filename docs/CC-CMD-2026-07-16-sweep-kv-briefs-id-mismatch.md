# Claude Code Command — Fix sweepKVBriefs's id-construction mismatch (repeatable synthetic-row contamination)

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/sweep-kv-briefs-id-mismatch-2026-07-16.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`sweepKVBriefs` (`src/index.js:5022`, runs every cron tick) builds its own id as `game_recap_${gameId}_${sweepDate}`, distinct from the real queue consumer's `game_recap_${sport}_${eventId}` (line ~15268). Because the two schemes never produce the same string for the same real game, `sweepKVBriefs`'s `ON CONFLICT(id) DO NOTHING` insert essentially never collides — it always inserts a *new*, parallel row for whatever's currently sitting in `brief:game:*` KV, real or synthetic, on every cron tick until that KV entry's 1-hour TTL expires.

**Confirmed live, twice, tonight — a genuinely reproducible bug, not theoretical:** a synthetic test row (`mlb_game_2026-07-16_g2`) was deleted from `briefs` at `14:11:02`, then reappeared — same id, fresh `created_at` — at `14:17:28`, 6 minutes later, from the same leftover KV entry being swept again. This will keep recurring on its own until the KV entry's TTL naturally expires, independent of any further CI test activity.

**Do not assume the fix is simply "make sweepKVBriefs collide" without considering what it would then do on collision** — `sweepKVBriefs` exists specifically to catch cases where KV has a real brief but D1 doesn't (the exact "fresh KV, stale D1" shape from tonight's archive-write investigation). If its id scheme is corrected to match the real consumer's, this doesn't just stop the duplicate-row bug — it turns `sweepKVBriefs` into a genuinely more effective automatic safety net, since a corrected id could then let it *repair* a real stale/missing D1 row on the next cron tick, rather than just failing to collide with (and thus never touching) the row it should be checking against. Whether that repair should happen via `DO NOTHING` (current) or `DO UPDATE` (matching `/integrity/game-briefs`'s repair-path convention, shipped earlier tonight) is a real design decision TASK 0 must make with evidence, not assume either way.

## TASK 0 — Probe

Read `sweepKVBriefs` in full, current, real source. Confirm its exact current id-construction logic and conflict behavior. Confirm the real queue consumer's exact current id-construction logic at its current line (will have drifted from ~15268). Decide, with real reasoning: should the corrected sweep use `DO NOTHING` (preserve current "never touch an existing row" caution) or `DO UPDATE` (become an active repair mechanism, consistent with `/integrity/game-briefs`)? Consider: `sweepKVBriefs` runs unconditionally every cron tick, unlike `/integrity/game-briefs` which is opt-in and rate-limited by being manually invoked — an automatic `DO UPDATE` running every ~15-20 seconds during live hours is a meaningfully different risk profile than an on-demand repair call, and should be reasoned about explicitly, not copied by default.

## TASK 1 — Fix

Correct `sweepKVBriefs`'s id construction to match the real consumer's scheme exactly (reusing the same construction, not a re-derived parallel one — check whether a shared helper already exists per the "Shared by all 6 real enqueue sites" convention noted elsewhere in this file, and reuse it if so). Apply the `DO NOTHING`/`DO UPDATE` decision from TASK 0 with real reasoning stated in the outbox, not asserted without it.

## TASK 2 — Verify

Real forced-condition test: a KV entry shaped like the real consumer's, with an id matching a real existing `briefs` row — confirm the corrected sweep either correctly declines to duplicate it (if `DO NOTHING`) or correctly updates it without creating a second row (if `DO UPDATE`). A second test with a genuinely new game (no existing `briefs` row) — confirm the sweep still correctly inserts one, not zero. If reachable, a real live check: trigger a real sweep cycle, confirm no new duplicate rows appear for any already-covered game.

## DONE CONDITION

`sweepKVBriefs` uses the same id scheme as the real queue consumer, closing the repeatable duplicate-row contamination path found and manually worked around twice tonight. The `DO NOTHING`/`DO UPDATE` decision is made with real, stated reasoning about the different risk profile of an unconditional every-tick sweep versus an on-demand repair call.

**Confidence scoring:**
- TASK 0 (35 pts): confirms real current id schemes for both functions, reasons explicitly about the DO NOTHING vs DO UPDATE risk tradeoff rather than defaulting to either
- TASK 1 (40 pts): id construction genuinely corrected and reused rather than re-derived, conflict behavior matches TASK 0's reasoned decision
- TASK 2 (25 pts): real forced tests for both the collision and new-game cases, real live check if reachable

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
