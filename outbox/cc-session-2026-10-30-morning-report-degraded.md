# Session 2026-10-30 — the Morning Report template says why it was written, and the replay found why

Spec: the owner's question "why is the late brief a template?", then "What is the result of the deploy?" (07:14 ET) after a deploy planned for 04:50 ET was not started.
Task document: `docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md` (Status IN PROGRESS: Task 1 and Task 2 done, Task 3 is the owner's call).

## HEAD progression

field-relay-nba: `e7bb7830` (start) → `e38d51b6`, `e52a2402` (automated outbox and docs commits, fast-forwarded) → **`719fc0eb`** (the code) → this close-out.
Deploy RELAY Worker run 41053986527: every check step green, wrangler uploaded 2246.39 KiB, Worker version `2b9aa701`, `/health` RELAY OK at 2026-10-30T12:21:38Z.
jubilant-bassoon and field-laboratory: no change.

## What was built, per commit

`719fc0eb` feat: the Morning Report records why it wrote the template.
- `callProxyDetailed` keeps why a null came back (`http-<status>`, `bad-json`, `no-text`) and the `X-FIELD-Model` header; `callProxy` delegates to it.
- The recap selection, the prompt and the team-name guard are exported functions (the inline code moved).
- `morning_report.value` carries `degraded` and, on a template morning, `degraded_reason` with `proxy_failure` or `guard.first`. The rejected prose is not stored: the route is public.
- `scripts/check-morning-report-degraded.mjs` (40 assertions) and `scripts/mutate-morning-report-degraded.mjs` (19 mutations) run in deploy.yml before the deploy.
- `scripts/probe-morning-report-guard-replay.mjs` and `.github/workflows/morning-report-guard-replay.yml` (dispatch only; 2.5 s between calls).

This close-out: the task document with the replay result, this file, the HANDOFF entry.

## Verified E2E

- Before the push, in the real clone with the change staged: the new check 40 of 40; the 19 mutations each caught for the stated reason; 91 of the other checks pass and 5 fail identically on the unchanged tree (they need `RELAY_SHARED_SECRET` or an OIDC token); the 14 mutation scripts that touch files this change touched pass on both trees (15 of 15 steps each).
- Old code against new code through `recomputeMorningReport`, 9,000 generated cases: the same prompt, the same text written to D1 and KV, the same `aiCalls`; 0 differences. Three deliberate changes to the new code were each detected.
- After the push: deploy green; the replay (run 41054042599, 12 calls on the production prompt, call and guard) found the cause below.

## What the replay found

The proxy answered 12 of 12. The guard rejected accurate prose on 2026-10-27 and 2026-10-29, never for a city. Its score test is a plain substring: hockey 5-1 and 4-1 are found inside the basketball scores 125-124 and 124-103, and a 2-0 matches a second game with the same score. The three samples per date are byte-identical, so these are 4 observations. A corrective retry was accepted on 3 of 6 and fails on 10-27 for the same reason. The 2026-10-28 stored template was not reproduced, and the other 14 template mornings are unexplained.

## STAGED

The `degraded` key on a real row. Blocked by: the first cron with the new code, Sat 2026-10-31 09:00Z. Unblocked by that run writing the row for 2026-10-30.
Verify: `curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/morning_report/2026-10-30?x=1"` shows `data.value.degraded`, with `degraded_reason` when true.
Automated: scheduled task `trig_01YXBNhWJFgRU3SHCY9KMPsR` reads it at 2026-10-31T09:15Z and appends the result to the task document.

## Carry-forwards

1. The fix (owner's choice; four candidates in the task document, recommendation 1: find a score as a whole number and count it as explained when any game with that score has its teams named).
2. A manual `POST /analytics/morning-report/recompute?date=2026-10-29` (one LLM call, relay secret, overwrites the template row, needs a `circadian-late` recompute after) was not fired: Rule 78.
3. `field_pick` is the 57-character pass line on 19 of 19 days it has a row. Seen, not investigated.
4. The cause of the other 14 template mornings.
