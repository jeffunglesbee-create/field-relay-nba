# Session 2026-11-01 — a look at the relay from the sandbox, and Task 2 of the vendor-residual CC-CMD

**Date:** 2026-11-01 · **Repo:** field-relay-nba · **Branch:** main
**HEAD progression:** `f0fdf99` → `dcfb4f3` (the runner read path, the helper, Task 2, the staged experiment) → this close-out
**Tasks:** the owner's order "resolve how to get a look at the relay from sandbox, a runner perhaps", and `docs/CC-CMD-2026-10-13-vendor-residual-window.md` Task 2 (P5).
**Odds API credits spent:** 0. **Worker code changed:** none, so no deploy.

## What was built

| Piece | Where | Proved by |
|---|---|---|
| The runner side: an exact allow-list of five routes, GET only, no credential, redirects not followed, red if anything is refused or fails | `scripts/relay-read.mjs`, `.github/workflows/relay-read.yml` | self-test 58; `scripts/mutate-relay-read.mjs` 29 of 29 caught |
| The sandbox side: dispatch over REST, find the run by title, wait, FETCH the artifact (never pull), print | `scripts/relay-look.sh` | `scripts/check-relay-look.mjs` 11 (fake gh, local git remote); `scripts/mutate-relay-look.mjs` 9 of 9 caught |
| The guard that runs them when they change | `.github/workflows/runner-read-guards.yml` | the repo's own 49 guard steps run locally against the staged tree before the push: 47 pass, the other 2 need the live relay or its secret; CI result in the next section |
| How to use it, and when not to | `docs/relay-from-the-sandbox.md`; one line in `CLAUDE.md` | check-doc-citations passes; no `path:line` added |
| P5 arithmetic | `scripts/analyze-cfl-reconcile-gap.mjs` → `outbox/cfl-reconcile-gap.json` | self-test 10; 9 of 9 caught |
| The production experiment that decides H1 against H2 | `scripts/cfl-abort-experiment.mjs`, `.github/workflows/cfl-abort-experiment.yml` | 23 assertions; 14 of 14 caught; against a fake relay only |
| A local workerd attempt at H1, recorded as INVALID | `scripts/cfl-abort-local-workerd.mjs`, `outbox/cfl-abort-local-workerd-20261101.txt` | its own positive control failed (see below) |

## Why the policy is an allow-list and nothing else

The first version had a deny-list and an `allow_unlisted` dispatch input. An independent three-lens review (a policy lens, a workflow-and-helper lens, a test-adequacy lens; their findings were read, not summarised) reached **spending and writing routes through it**:

- `/v2/games` was on the allow-list as "free". For a soccer sport with a live game it calls `getWCPregameLambdas`, which charges the Odds API (4 credits per attempt) and fetches it, and it writes D1/R2/Durable Objects; for NHL/NBA finals it enqueues an LLM brief per game. **Removed.**
- With `allow_unlisted=true`: `/wc/match-wp`, `/wc/projections`, `/wc/elimination-traps` fetch `/wc/odds-probs` on the relay's own behalf (a spending route, reached by a name that was not on the deny-list); `/analytics/run` is an unauthenticated GET that runs the analytics engine (D1 DDL and writes, LLM calls); `/backfill/*`, `/integrity/briefs?repair=true`, `/schedule/ai-fallback` write. **The flag is gone, and with it the deny-list.**
- The shared secret opens `/web-fetch` (a fetch of any URL), `/admin` and `_forcePrimaryFail`. **No credential is sent**, by the code and by the workflow.
- `/budget/odds` makes one edge-cached call to the vendor's `/v4/sports`, which the vendor documents as free and the relay labels ODDS-FREE (measured `x-requests-last` 0 on one reading). Kept, and documented as a belief, because it is the route the drift, pairing and vendor watches already read every few hours.
- I had found one thing myself before the review ran: `/health/%2e%2e/cfl/odds-probs` passed a string-prefix policy and was SENT as `/cfl/odds-probs`. The review fuzzed the policy that fixed it (400,000 strings, no bypass of its deny-list); the exact-match rule leaves nothing to fuzz.

The review also found that the sandbox helper died on a dirty working tree (it ran `git pull --rebase`), died on one transient `gh` failure, and ended a failed run with "committed no artifact" and no run URL; and that the mutation harness printed CAUGHT for a mutant that merely crashed. Each is a scenario or a mutation now, and a mutation counts as CAUGHT only if an assertion fired.

## Task 2 (P5): what was measured

See `docs/CC-CMD-2026-10-13-vendor-residual-window.md`, Task 2, Result. In one paragraph: over the 11 windows that can be measured (the 12th contains the month reset), the CFL gap (`by_site` minus `credits_kept`, a whole number of 6-credit calls in 59 of 59 samples, 0 at six of seven other sites) sums to 1,962 against a ledger over-record of 2,076, Pearson r 0.925, and adding it back leaves the residual within 60 of zero in 10 of 11. **P5 bears on the residual.** H3 (the ledger is right), H4 (the clamp) and H5 (every site) are refuted. H1 (a client disconnect cancels the continuation) and H2 (the correction fails under load) stand.

**The local workerd attempt at H1 is invalid, and the record says so.** It ran 54 calls and every aborted call still completed. Its positive control, a handler that checks `request.signal` and stops, also completed in 6 of 6, through miniflare's Node proxy and directly on workerd's socket. A run that cannot see a disconnect cannot say the continuation survived one. The first version of that script printed only the 36 calls and the reading "workerd does not cancel"; the control is what withdrew it.

## Verified end to end vs staged

**VERIFIED end to end, live, 2026-11-01 13:27Z.** `bash scripts/relay-look.sh "/budget/odds?date=2026-11-01" "/health"`, run from this sandbox in the relay checkout, **66 s** wall clock (the workflow runs the policy self-test and its 29 mutations before it reads anything, which is most of that). The helper dispatched `relay-read.yml` over the REST API on the first attempt (no 422), found its run by title (`relay-read look13271419616`, so `run-name` drives `display_title` as designed), waited, fetched `outbox/relay-read-look13271419616-20261101T132809Z.json` that the runner had committed, and printed it. Run 41311323860, completed/success: `/budget/odds?date=2026-11-01` HTTP 200, 2,696 bytes, 2,274 ms (`used` 276, `source` `d1`, `by_site.handleCFLOddsProbs` 36); `/health` HTTP 200, 377 bytes, 142 ms (`RELAY OK`). 2 read, 0 refused, 0 failed. The sandbox itself still cannot reach the relay (`curl` exits 000), which is the point.

**CI on `dcfb4f3`, read from the Actions API after the push:** `Repo guards` (run 41311306083), `Workflow YAML Gate` (41311306087) and `Runner read path and CFL gap guards` (41311306124) all completed success. The last is the first run of all four harnesses on a real runner, so `jq`, `git init -b main` and the fake `gh` all work there, not only here.

**STAGED, Task 2b.** `cfl-abort-experiment.yml`. Blocked by: the owner's approval of up to 12 Odds API credits (`GET /cfl/odds-probs` charges 6 before the fetch and keeps them on a miss). Unblocked when: the owner dispatches it with `approval` equal to `APPROVED: up to 12 Odds API credits for the CFL abort experiment`, on a day and hour with no CFL games and more than an hour from the 05:30Z vendor reading. Verify: `node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(a.verdict,a.aborted_effective+"/"+a.aborted_calls,a.ledger_overrecord_left_credits)' outbox/cfl-abort-experiment-<stamp>.json` prints a verdict that does not start with `inconclusive` and `5/5`.

## Open, the owner's call

- Task 2b's approval (above). Its verdicts decide the next step: `abort-loses-refund-and-tally` names H1 and makes the candidate fix a one-function change (run the post-fetch reconcile under `ctx.waitUntil`), proposed to the owner with the 2026-10-18 ruling in view and not made here; `abort-loses-nothing` leaves H2, whose next step is enabling Workers Logs for one CFL day (also needs approval).
- Adding `field-relay-nba.jeffunglesbee.workers.dev` under Allowed domains in the environment's network settings makes the runner path unnecessary for the five routes (and opens every other route to a sandbox `curl`, with the consequences for credits that implies).

## Seen, not fixed

- `docs/CC-CMD-2026-10-23-odds-spend-without-need.md` already records that a `/v2/games` self-probe on a live soccer game charges a `getWCPregameLambdas` attempt; the review's finding on `/v2/games` is the same spend reached from the new tool, and is closed by not listing the route.
- `outbox/cfl-reconcile-gap.json` is regenerated by hand (`node scripts/analyze-cfl-reconcile-gap.mjs`); nothing refreshes it. It is a dated record of 2026-11-01, not a feed.
