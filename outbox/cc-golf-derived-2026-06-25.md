# Golf `_derived` SG Proxy + Silent Build Failure Recovery — 2026-06-25

## The story in one paragraph

CC-CMD instructed inserting the `_attachDerived` IIFE in `handleESPNGolfScoreboard`.
After three commits (initial IIFE, relocation to `handleGolfEnriched`, cache key bump)
and three green deploys, `_derived` did NOT appear in `/v2/golf/enriched`. Investigation
of the deployed worker bundle via `mcp__Cloudflare_Developer_Platform__workers_get_worker_code`
revealed that **no commit since `647d627` had actually deployed** — the wrangler build
step had been failing silently for hours, masked by `continue-on-error: true` on the
"Deploy to Cloudflare Workers" step. Root cause: `src/context-assembler.js:693` had
raw newlines inside single-quoted strings (shipped by `647d627`, the `golf_leaderboard`
CONTEXT_SOURCE commit). `node --check` flags it — local checks I ran in this session
only covered `src/index.js`, not the context-assembler. Fixed in `e8ccef1` (3 raw
newlines → `'\n'`). Next deploy succeeded; `_derived` now flows.

## Commits

- `6b501f8` feat(golf): _derived SG proxy via field-relative Broadie computation
- `0224ec6` fix(golf): move _derived IIFE into handleGolfEnriched (was in wrong function)
- `461ed74` fix(golf): bump enriched cache key v4→v5 to invalidate pre-_derived payload
- `e8ccef1` **fix(context): escape newlines in golf_leaderboard string literals (build was failing silently since 647d627)** ← the unblocker
- Deploy: workflow 28191975942 — completed/success (first successful relay deploy since 647d627).

## CC-CMD-specified location was wrong

Spec said insert in `handleESPNGolfScoreboard` (L2338). Reading the data flow:
- `handleESPNGolfScoreboard` builds `leaderboard` without `stats` (entries get name/position/toPar/today/thru/round only at L2307–2337).
- `handleGolfCompetitorStats` fetches stats per athlete (parallel) inside `handleGolfEnriched`.
- `handleGolfEnriched` REBUILDS each entry via `.map(...)` at L2611, populating `stats: { gir, drivingDistance, drivingAccuracy, puttsPerGir, sandSaves }` from `statsByAthlete[athleteId]`.
- That rebuild would have dropped any `_derived` attached upstream — even if my IIFE in `handleESPNGolfScoreboard` had worked.

`/v2/golf/enriched` is the client's only entry point (handler at L8027 calls `handleGolfEnriched`). Correct fix: IIFE inside `handleGolfEnriched` AFTER the rebuild, operating on `enriched[]`. That's what shipped.

## Silent build failure

`.github/workflows/deploy.yml` step 6 (Deploy to Cloudflare Workers) has
`continue-on-error: true` to tolerate transient secret-PUT failures. That same
flag also swallows build errors. The "Deploy gate — confirm relay is live"
step at L7 only checks `/health` — returns 200 for ANY currently-deployed
bundle, including a stale one from a successful prior deploy. So:
- Push commit with broken syntax → wrangler build fails → step "succeeds" via the flag → health-gate passes (because stale bundle is live) → CI green → smoke tests run against stale code → all pass → commit marked deployed → BUT `/deploy/verify` only reports the SHA we ASKED to deploy, not what's actually serving traffic.

**`/deploy/verify` is a lie when wrangler silently fails.** It shows the
commit hash that was supposed to be deployed (from env at build time or a
deploy.yml-injected constant), not what's actually serving traffic.

### Detection (how I caught it)

`mcp__Cloudflare_Developer_Platform__workers_get_worker_code` returned the
ACTUAL deployed bundle. `grep -c "_attachDerived" <bundle>` was 0 despite
the commit being in HEAD for 30+ minutes. `grep golf:enriched <bundle>` showed
`v4`, not `v5`. Conclusive: bundle was pre-647d627.

### Investigation steps

1. `mcp__github__actions_list` for run 28191551956 jobs — step 6 "Deploy to
   Cloudflare Workers" claimed success.
2. `mcp__github__get_job_logs` for job 83507184465 with `tail_lines=1000` —
   showed `[ERROR] Build failed with 1 error: Unterminated string literal`
   at `src/context-assembler.js:693:23` followed by
   `The process '/usr/local/bin/npx' failed with exit code 1`.
3. `node --check src/context-assembler.js` reproduced the error locally.
4. Read L685–698 — three single-quoted strings with raw newlines (from
   commit 647d627's `golf_leaderboard` builder).

## Edits

**`src/index.js`** — `_attachDerived` IIFE in `handleGolfEnriched`
after the `enriched = lb.map(...)` rebuild. Iterates `enriched[]`, computes
field averages (mean GIR, putts/GIR, distance, accuracy) from players
with all four stats > 0 (skip if N < 5), then attaches `stats._derived =
{ sgPuttingEst, sgApproachEst, sgOttEst, ballStriking, narrative, fieldAvg }`
per Broadie methodology. Cache key bumped v4→v5 to invalidate pre-`_derived`
payload at deploy time.

**`src/context-assembler.js:687–693`** — three raw newlines replaced with
`'\n'` escapes inside the `golf_leaderboard` builder. Was breaking every
wrangler build since 647d627.

## Live verification

```
GET /v2/golf/enriched?date=20260625

leaderboard[0] (Eric Cole, -7 thru 18):
  stats.gir: 83.33
  stats._derived:
    sgPuttingEst: +1.12
    sgApproachEst: +1.62
    sgOttEst: -0.03
    ballStriking: 64
    narrative: "Eric Cole is earning every stroke — elite approach game and putting"
    fieldAvg: { gir: 74.3, puttsPerGir: 1.675, drivingDistance: 299.9, drivingAccuracy: 70.1, n: 20 }

leaderboard[3] (Matt Fitzpatrick, -6 thru 17):
  stats._derived.sgApproachEst: +2.48
  stats._derived.ballStriking: 83 (elite)
  stats._derived.narrative: "Matt Fitzpatrick is earning every stroke..."

leaderboard[2] (Ben Griffin, -6, gir=61):
  stats._derived.sgPuttingEst: +2.42
  stats._derived.sgApproachEst: -2.38
  stats._derived.narrative: "Ben Griffin's putter is carrying them..."
```

All 20 players with stats now carry `_derived`. Client at `index.html:15566–15580`
will render: "est. +1.6 SG approach/rd", "ball-striking 83 (elite)",
plus the narrative line.

## What I will check next time (process fix)

Before every deploy I will now run **both**:
```
node --check src/index.js
node --check src/context-assembler.js
```

And before assuming a deploy worked, verify the actual deployed bundle via
`workers_get_worker_code` grep — NOT just `/deploy/verify` (which lies when
wrangler silently fails) and NOT just the GitHub Actions "success" badge
(which is meaningless with `continue-on-error: true`).

## Recommended follow-up (out of scope of this CC-CMD)

The `continue-on-error: true` on the wrangler-deploy step exists to tolerate
transient secret-PUT errors, but it also masks build failures. The "Deploy
gate — confirm relay is live" step at L7 should be hardened to:

1. Detect when `steps.wrangler_deploy.outcome == 'failure'` and fail the job.
2. Or compare the actual deployed Worker version (via CF API
   `workers/scripts/{name}` returning the version_id) against the SHA the
   workflow was supposed to deploy.
3. Or strip `continue-on-error` from the wrangler step and handle the
   secret-PUT race more narrowly.

Filing this as a separate CC-CMD recommendation, not as part of this commit.
