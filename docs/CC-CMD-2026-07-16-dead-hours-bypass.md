# Claude Code Command — One-time bypass of the journalism cron dead-hours gate

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

**Explicit, direct user authorization for this specific action, given in chat: "One time approval to bypass dead hours."** This is a real CI/CD-adjacent behavior change to a deliberate, intentional scheduling gate — treat it with the same care as any other explicitly-authorized override tonight (matching the `jq-judge-live-probe.yml`/`jq-calibration-force-probe.yml` precedent), not as a standing instruction to remove the gate.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/dead-hours-bypass-2026-07-16.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`handleJournalismCycle`'s `isLiveHours` gate (`hour>=10 || hour<=2` UTC) is deliberate, pre-existing, correct behavior — not a bug, not touched by tonight's UTC-rollover fix. Two real, currently-open threads are blocked on it:

1. **`journalism-cron-utc-rollover`'s write-side verification** — the `getFieldDateKey()` fix deployed at ~03:00 UTC, right as the gate flipped to dead-hours. No fresh `cron`-sourced write has been observed since; the WNBA `espn:401857070` recap specifically (Valkyries 88 @ Fever 75) is the concrete test case.
2. **`jq-judge-live-verify-and-calibration-watch`'s TASK 2** — needs real elapsed time and real volume of new-formula (`6aed3bb`) briefs to observe whether `brief_type_calibration` trends downward as designed. One forced synthetic row already proved the pipeline wiring works; this needs real games, not another synthetic.

## TASK 0 — Probe

Re-confirm the exact current `isLiveHours` gate condition and where it's checked within `handleJournalismCycle` (line numbers will have drifted). Confirm the real, current UTC hour at execution time to confirm the gate is genuinely blocking right now (don't bypass a gate that isn't actually closed).

## TASK 1 — One-time bypass, not a permanent change

Do not edit `isLiveHours` or its call site in `src/index.js` — that would be a real, permanent behavior change requiring its own separately-scoped review, not what was authorized. Instead, using the same sanctioned CI-as-proxy pattern already established tonight (a one-shot `workflow_dispatch` probe with unrestricted runner egress), manually trigger the real, deployed `handleJournalismCycle` logic for this one occasion — either by directly invoking the relay's own cron-equivalent route if one exists and is reachable, or by building a minimal one-shot probe script/workflow that calls the same real function the cron would call, bypassing only the time gate for this single invocation. Confirm which path is real and available before choosing.

## TASK 2 — Verify

Real, live D1 check confirming new `cron`-sourced brief rows appear post-bypass — specifically confirm `espn:401857070`'s recap now exists with the real 88-75 result. Real `/quality/report` check confirming new-formula scores are accumulating in the calibration pool. Confirm the gate itself (`isLiveHours`) is genuinely unmodified in the committed code — this was a one-time operational bypass, not a code change, and the repo should reflect that.

## DONE CONDITION

Both blocked verifications (UTC-rollover write-side, calibration real-data accumulation) get real data to observe from this one-time bypass, without any permanent change to the dead-hours gate's own logic.

**Confidence scoring:**
- TASK 0 (20 pts): confirms the gate is genuinely active right now before bypassing it
- TASK 1 (50 pts): genuine one-time bypass via a sanctioned CI-as-proxy mechanism, gate itself left untouched in the committed code
- TASK 2 (30 pts): real D1/quality-report confirmation that both blocked threads now have real data

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
