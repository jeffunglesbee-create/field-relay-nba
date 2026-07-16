# Claude Code Command — Add a permanent structural probe for the streams field

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

**Explicit user authorization for this specific CI/CD pipeline change, given in chat.** This CC-CMD exists because the prior dispatch's own outbox (`outbox/broadcast-chip-durable-fix-2026-07-16.md`) correctly flagged it as worthwhile but out of that dispatch's own scope, and the user has now authorized it directly.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/deploy-streams-probe-2026-07-16.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`buildStreamsFromESPN(comp)` was added earlier tonight (`277fdc7`) and wired into all 5 real V2-path adapters, closing the gap where `gameNetwork()`'s 28 client-side call sites had nothing to read for any sport. No permanent CI assertion exists for this — a future regression (a refactor accidentally dropping the `streams:` line from one adapter, a change to ESPN's real field names breaking `buildStreamsFromESPN` silently) would only be caught by someone manually re-running tonight's checks, not automatically.

## TASK 0 — Probe

Read `deploy.yml`'s existing `STRUCTURAL N` probes in full — the real, current numbering, the real assertion style/format each one uses, and how they access live data (if any already do, versus purely static code checks). Match this dispatch's new probe to whatever convention is actually established, not a guessed format.

## TASK 1 — Fix

Add a new `STRUCTURAL N+1` probe asserting `streams` is present and non-empty for a real, current game with known broadcast data. **Design for robustness against real day-to-day variation, not a hardcoded game/date that will go stale:**
- Query a real, current live endpoint for a sport reliably in-season and broadcasting nationally on a predictable cadence (reason through which sport/day-of-week combination is actually safe against a real no-games day — don't assume one without checking a real schedule).
- If the check would have zero real candidate games on some real days (a genuine off-day, an all-star break, offseason), design the probe to skip gracefully on those days rather than fail the whole deploy — a false failure from "no games today" is worse than no check at all, since it trains someone to ignore red CI.
- Prefer checking the field's *presence and shape* generically (does at least one real game in a real response carry a well-formed `streams` array) over asserting a specific broadcaster name, which would be a much more fragile, false-positive-prone check.

## TASK 2 — Verify

Real forced-condition test: confirm the new probe genuinely passes against today's real data. Real regression test: temporarily comment out (in a disposable local check, not committed) the `streams:` line from one adapter, confirm the new probe would have caught it, then confirm the real code is restored and passes again. Run the full existing `deploy.yml` structural/probe suite locally or via a real CI dispatch, confirm nothing else regressed from this addition.

## DONE CONDITION

A permanent, real CI check exists that would have caught tonight's original bug (or a future regression of the same fix) automatically, without depending on anyone manually re-running today's checks — designed to fail only on a genuine regression, not on a genuine, expected no-games day.

**Confidence scoring:**
- TASK 0 (25 pts): matches the real, existing STRUCTURAL convention exactly, not guessed
- TASK 1 (50 pts): probe is genuinely robust against real schedule variation, checks presence/shape not a fragile specific value, degrades gracefully rather than false-failing on a real off-day
- TASK 2 (25 pts): real pass confirmed today, real regression-catch confirmed via a genuine (reverted) negative test, full suite confirmed non-regressed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
