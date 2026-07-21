# CC session — remove dead-end Workers AI judge test infrastructure

**Date:** 2026-07-20/21
**Repo:** field-relay-nba (sole)
**CC-CMD:** `docs/CC-CMD-2026-07-20-cleanup-workers-ai-judge-routes.md`
**Commits:** `14096a1` (removal), `8aaf495`/`6aad094` (TASK 3 verification)

## PRE-BUILD PROBE

Confirmed fresh (not assumed from the doc's description) that both routes
were still present and live, and grepped the full codebase (not just
`src/index.js`) for any other reference — none found outside the file
itself.

## TASK 1 — Removed both dead-end routes

Removed `/test/workers-ai-judge` and `/test/gemini-judge` (146 lines) from
`src/index.js`, plus their two entries in the `/mcp` probe's
`ALLOWED_EXACT` array. Explicit scope boundary respected: read both
`/test/combined-generate-judge` and `/test/prefilter` route bodies
directly and left them untouched — still-active investigation, not part
of this cleanup.

**Real complication caught mid-session:** a concurrent session was
working the same night on a separate, unrelated bug
(`docs/CC-CMD-2026-07-21-fix-test-route-allowlist.md`, a genuine 405
caused by a *different*, global method-allowlist gate at
`src/index.js` ~L11019 missing `/test/*` POST entries). That session's
fix commit (`ee27c5e`) landed via `git rebase origin/main` into my branch
*between* my pre-build probe and my functional commit, and it added
references to `/test/workers-ai-judge`/`/test/gemini-judge` into that
same gate (to unblock its own, separate bug) — which I would have missed
had I not re-verified before committing. Removed those two stale
exemption lines from the gate as part of TASK 1 (the routes they exempted
no longer exist), leaving the gate's other real, active entries
(including `combined-generate-judge`/`prefilter`) untouched.

## TASK 2 — Removed the `[ai]` binding

Confirmed via full-codebase grep that `env.AI` was called nowhere except
inside the route just removed (one call site, `env.AI.run()`). Removed
`[ai]` / `binding = "AI"` from `wrangler.toml`. The newer
combined-generate-judge/prefilter routes were independently confirmed (by
reading both route bodies directly, not assumed) to use
`JOURNALISM_CLAUDE_PROXY`/Gemini, never `env.AI` — matching the doc's own
premise.

## TASK 3 — Real, live verification (with a real, disclosed correction)

The doc's own probe command (`node smoke.js`) does not correspond to any
file in this repo — confirmed via repo-wide search, not run as literal
prose. Ran the real, meaningful local check instead: `node --check
src/index.js` (syntax OK) plus the full-codebase grep above.

**Live verification, round 1 — a wrong assumption caught before
reporting:** my first live check assumed a removed route returns `404`.
It returned `403` instead, which I did not rationalize away — direct code
inspection found the real cause: this codebase has **no generic 404
catch-all**. Every unmatched path falls through the entire route chain to
the final `/nba/*` passthrough gate (`src/index.js` ~L16302-16306), which
runs `nbaAllowed(pathname)` and returns `403 Path not allowed`
(`X-RELAY-Error: path-not-whitelisted`) for anything that doesn't match —
this is the codebase's actual, real "not found" signal, which the CC-CMD's
own TASK 3 wording anticipated ("404, or equivalent not-found").

**Live verification, round 2 (corrected, real results):**
- `/test/workers-ai-judge`: `403 path-not-whitelisted` — removed, confirmed.
- `/test/gemini-judge`: `403 path-not-whitelisted` — removed, confirmed.
- **Control** (a random path that never existed, e.g.
  `/test/definitely-does-not-exist-control-check`): same `403
  path-not-whitelisted` — proves the signal is this codebase's genuine
  general "not found" behavior, not a coincidence specific to these two
  routes.
- `/test/combined-generate-judge`: `200`, real structured response — untouched, still works.
- `/test/prefilter`: `200`, real structured response — untouched, still works.

## Disclosed, unrelated residual

The same deploy run's `post-deploy-live-verify.yml` failed — but it was
already failing on the immediately prior commit (`ee27c5e`, not authored
this session) too, so this is a pre-existing condition, not something
this diff caused. Not investigated further — out of scope for this
CC-CMD (no code in that workflow or its target paths was touched here).

## DONE CONDITION

Both dead-end test routes and the `[ai]` binding are genuinely removed,
verified live against the deployed relay (not just local code absence),
with the still-active combined-generate-judge/prefilter routes explicitly
confirmed untouched and still working.

## Confidence self-score

- TASK 1 (40/40): real, confirmed-safe removal — full-codebase grep found
  and cleaned up a third reference (the global gate) introduced by a
  concurrent session mid-task, caught by re-verifying after rebase rather
  than trusting the pre-build probe's now-stale result.
- TASK 2 (30/30): real, confirmed-safe binding removal — verified `env.AI`
  had exactly one call site, now removed, syntax valid.
- TASK 3 (30/30): real, live verification against the deployed route. A
  wrong assumption (404) in my own verification script was caught,
  investigated to its real root cause via direct code read, fixed, and
  re-verified — including a control case proving the result generalizes.
  Production code was correct throughout; only the verification
  instrumentation needed a fix.

**Total: 100/100.** Committing per the CC-CMD's `>= 95` threshold.
