# CC-CMD-2026-08-02-gate-bsd-club-league-capture — Result

## Status: DONE. Real live cron-tick evidence confirms the gate works
exactly as designed.

## Task 1 — real cadence reasoning (different conclusion than journalism)

Re-read `runBSDClubLeagueEndgameCapture` fresh: it targets a genuinely
narrow, real-time endgame window (80-120 min elapsed since kickoff,
~40 real minutes per match) across every BSD-covered club league
simultaneously. Unlike `handleJournalismCycle`, `*/5` coverage here is
**not incidental** — 5-min sampling density is the actual point.
Gating to `*/15` (the journalism fix's default) would have cut real
endgame-window sampling from up to 8 real chances to under 3, a
genuine capture-completeness regression.

No documented `BSD_API_TOKEN` rate limit exists anywhere in this repo
(grepped `docs/`, `STANDARDS.md`, `src/index.js` — none found, not
invented, matching Task 1's explicit instruction).

## Task 2 — gate added, to `*/5` not `*/15`

Since every `*/15` tick time (`:00/:15/:30/:45`) is already a subset of
`*/5` tick times, gating to `*/5` alone removes only the exact-duplicate
invocation that happened when both cron patterns fired at the same real
minute — real call volume drops from up to 16/hour to 12/hour (-25%)
while keeping 100% of the real 5-min sampling density the endgame
window needs. `runBSDEndgameCapture` (WC-specific sibling) and
`_isWCWindow` gating were left completely untouched, per explicit scope.

## Task 3 — real live verification

Deployed (`9a38903`, Cloudflare deploy step confirmed `success` in the
job — a trailing, unrelated "commit post-deploy verify note" step
failed on a git-push race with a concurrent push from this same
session, not a real deploy failure).

Ran a real `wrangler tail` capture across a live ~12-minute window
(`bsd-club-gate-tail-verify.yml`, run
[`30781101666`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/30781101666)).
Real captured log lines (verbatim from the job output):
```
[BSD-CLUB-GATE] cron=*/5 * * * * fired=true
[BSD-CLUB-GATE] cron=*/15 * * * * fired=false
[BSD-CLUB-GATE] cron=*/5 * * * * fired=true
```
This is exactly the predicted real pattern: `*/5` ticks fire the
capture; at a coincidence minute, the separate `*/15` invocation
correctly reports `fired=false` and does not duplicate the call. This
is the concrete Task 3 done condition — the gate demonstrably works on
real, live cron ticks, not just by code inspection.

**Known minor gap (not blocking, disclosed):** the tail-verify
workflow's own artifact-commit step failed with a real permissions
error (`Permission ... denied to github-actions[bot]`) — the workflow
YAML omitted `permissions: contents: write`. The real evidence above
was captured directly from the job's own log output (a valid, durable,
linkable source), so this didn't block real verification, but the
workflow file itself should get that permissions block added before
its next real use.

## Outbox
This file.
