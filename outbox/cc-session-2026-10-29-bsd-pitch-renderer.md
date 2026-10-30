# Session 2026-10-29 — the BSD pitch draws a ball and shots, proven on the deployed page

CC-CMD: `docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md` (DONE).
Repos: field-relay-nba (relay) and jubilant-bassoon (client). Both on `main`, no PR.

HEAD progression, relay: `5dfaf6f` → `4305b195` (fit tool) → `104eb2ff` (verdict rule) → `5fc7c213` (own goal) →
`7781afca` (absent arrays) → `fd7f9d22` (contract) → this close-out.
HEAD progression, client: `9ac59b6` → `94d8b56` (ball) → `678b3d8`, `0dc6c03` (probe) → `18b4873` (shots) →
`1de1b30`, `193be39`, `68d0afd` (probe screenshot) → close-out.

## Result

The deployed page draws the ball and the shots at the places the feed puts them. Proof is a committed manifest,
`jubilant-bassoon/outbox/bsd-pitch-probe-manifest-2026-10-29T03-53-57.json` (run 40814597354, repeated green at
03:51:47, run 40814398443): `pass: true`, every required boolean true, `nanAttributes` 0 before and after the age
bound, ball at `cx 259.2, cy 127.2` (expected 259.2, 127.2 from the served contract example `coords {72, 47}` on a
360 x 240 pitch), the home goal at the vendor's own placement of that goal, the away goal at the vendor's own
placement, and a screenshot whose three grass pixels read `#2d5a27` (`screenshotShowsPitch`). **It proves the
reader on recorded payloads over the page's real SSE path. It does not prove a live match; none is live in CI.**

## What was wrong, measured

1. **Ball.** `_bsdOnSSEFrame` stored the whole payload and `_bsdRepaint` read `.x/.y` off it; the relay nests
   the point at `data.coords`. No ball had ever drawn. 72 of 378 recorded livedata frames carry no point, so the
   last point is kept. A frame for ANOTHER match moved the dot: AmbientDO fans every subscribed match out to every
   client and says clients filter by id; the client did not.
2. **Shots.** `_bsdRepaint` plotted `s.x`, `s.y`, `s.team`; a shotmap record has `pos{x,y,z}`, `home`, `xg`.
3. **The contract's `mirrorAway` is the wrong placement for this pitch.** CC-CMD Task 2 said to apply it. It
   leaves HOME raw, so home attacks x = 0. The ball frame has home attacking x = 100 (home goal at x 93, home goal
   kicks at x 5). Measured by an EXACT join: a goal is in `/incidents` (`sequence[].pos`, shared pitch) and in
   `/shotmap` (`pos`, target-goal-relative), same player and minute. 121 of 126 goals (2 own goals excluded)
   across 38 finished websocket_plus matches, 2026-10-26 to 28: **home `(100-x, 100-y)` 69 of 69 exact, away
   `(x, y)` 51 of 52 exact**, the 52nd 0.5 off (event 604443 min 90: the shotmap holds the preceding cross's end
   point 10.2,53.4, the incident holds the shot 9.7,53.6). `/bsd/contract` now declares it as
   `transformReference.sharedPitch`; `mirrorAway` is unchanged and is the OTHER orientation.
4. **Not usable as a reference:** the livedata frame near a shot. Its point is the ball when the frame was cut,
   not the shot origin (602347 34:11, a home "shot" carrying the previous frame's point, x = 8, in a match where home
   attacks x = 100). A fit on those frames favoured a y flip for the away side (mean error 4.9 against 11.0 over 5
   pairs); the goal join showed the away side is not flipped at all.

## Task 0 numbers (done condition 3)

Gaps between consecutive frames that carry a point, 4 captures, 3 matches, 2026-10-28, n = 273: median 5 s,
p90 17 s, p95 26 s, max 112 s; 263 of 273 (96.3%) within 30 s, so the dot's age bound is 30 s, taken at receipt on
the device's monotonic clock. Second half: ONE measured (event 602352), no flip at half time; no second second
half was in the outbox or live, so the code places the point as sent and its comment says so.

## Per commit

Relay.
- `4305b195` `scripts/bsd-shared-pitch-fit.mjs` + `bsd-shared-pitch-fit.yml` + a guards.yml step. The check that
  produced item 3. Self-test, a mutation harness, and a source-mutation battery (12 anchors, each unique, each
  caught; three were NOT caught at first (the player id, the minute window, the separability threshold) and the tests
  were strengthened until they were).
- `104eb2ff` the first run read one 0.5 residual as CONTRADICTED under a 0.15 rule. The question is which of
  four placements, so the verdict uses AGREE = 1.0 and reports exact counts and the widest error separately.
- `5fc7c213` the own-goal exclusion tested `'own'`; the vendor's value is `'ownGoal'` (2 were being paired).
- `7781afca` absent arrays became errors (Rule 99). See "What went wrong".
- `fd7f9d22` `sharedPitch` served from a module constant (the `/bsd/` handler is at the scanner's 1500-line window).
  Deploy RELAY Worker 40811980794, `bsd-contract-verify` 40812803674, `bsd-contract-verify.mjs` self-test 40/40.

Client.
- `94d8b56` the ball: `data.coords`, keep on null, 30 s bound with its own repaint timer, id guard,
  `window._bsdVerify.activate` for the probe. Smoke 1064 / 0 failed.
- `678b3d8`, `0dc6c03` `bsd-pitch-probe.yml` + `bsd_pitch_probe.js`.
- `18b4873` the shots: `_bsdShotPoint`, `bsd:stats` read as `.shotmap` only. Smoke 1065 / 0 failed. Deploy gate 40812818686.
- `1de1b30`, `193be39`, `68d0afd` the probe's screenshot (below).

## Verified end to end, and what is not

VERIFIED on the deployed page and the deployed relay: ball placement, null keeps the dot, another match's frame is
ignored, the dot goes at 30 s by its own timer and shots stay, shot placement against the vendor's own placement
of the same goals, no NaN in any attribute, the served contract declares `sharedPitch`.
NOT verified: a live match (none in CI); a second second half; Safari and Firefox (Chromium only); shots during a
live match (there is no source, below).

## Rule 90 on the probe, and one check that was wrong

Before any live run the probe was run against a local build of the page and a stand-in relay: green, then eight
deliberate breaks (old ball read, null blanks the dot, id guard removed, age check removed, age timer removed, age
bound 90 s, home shot raw, away shot rotated) each failed the booleans it targets. On the deployed page the first
two committed screenshots showed the page's own list of sports, not the pitch (the probe appended the pitch to
the end of `<body>` and something paints over that rect): the booleans, which read the DOM, were green and the
artifact was wrong. Moving the pitch to a fixed top-layer box fixed the picture; the `elementsFromPoint` boolean I
added to check it was then red on two of five runs with the screenshot correct each time (`["html"]` as the stack:
the page makes its body non-hit-testable at times). It answered "who gets a click", not "what is painted", so it is
now a diagnostic. `screenshotShowsPitch` decodes the PNG and requires three grass pixels to be `#2d5a27`; it was
red on a clean page when its first sample landed on the halfway line, and goes red when an opaque div is painted
over the pitch. Green on 03:51:47 and 03:53:57.

## What went wrong in the process (Rule 77, in one place)

- `7781afca`. My fit script added `|| []` sites. jubilant-bassoon's cross-repo absence-collapse ratchet clones the
  relay main, so a relay commit reddened the CLIENT deploy gate (run 40809785846, `94d8b56`). Fixed in the relay,
  failed job re-run, green. Cost: about 18 minutes of the ball not being live (gate red 03:02Z, re-run green 03:20Z). The client's own pre-deploy steps
  were not run before the push; I ran smoke only. They are now run on a clean worktree before each client push
  (the two that cannot run locally are the CI-only SW sync and the repo-name check; the ratchet was run by hand).
- Two catch-collapse sites in the probe, same ratchet, fixed in `0dc6c03`.

## Filed (BUILD-ON-A: searched by content first, nothing existing covered either)

- `docs/CC-CMD-2026-10-29-bsd-pitch-inset.md`: the pitch lines are drawn 5% inside the canvas and everything is
  plotted to the canvas edge, so a goal at x = 2.7 sits outside the goal line and is clipped. BUILT the same day: Part 2.
- `docs/CC-CMD-2026-10-29-bsd-live-shot-source.md`: 0 of 170 recorded event frames carry `shotmap`, so a live match
  draws a ball and no shots. Blocked by Task 0, the BSD request budget, which is unmeasured.

## Part 2 — the inset (docs/CC-CMD-2026-10-29-bsd-pitch-inset.md, DONE)

User: "build the inset". Client commits `8d0496e` (renderer) and `70a5228` (probe); no relay change.

- **What:** `_bsdToCanvas(x, y, W, H)` maps pitch coordinates INTO the rectangle the lines are drawn in, for the ball and the
  shots, and the rectangle and halfway line are drawn from the same `BSD_PITCH_INSET` (0.05) constant, so the two cannot
  drift. The margin stays: it is what stops a large circle at the goal line being clipped. SW_VERSION `2026-10-29a`
  (ET had rolled to the 29th). Smoke 1066 / 0 failed (A_BSD_15; five source mutations each caught). I also corrected my own
  comment on `_bsdShotPoint`, which still carried the first run's counts (123 / 71) instead of the final (121 / 69).
- **Proof:** `jubilant-bassoon/outbox/bsd-pitch-probe-manifest-2026-10-29T16-03-02.json`, run 40907485456, green again
  at 16:00:44 (run 40907094464). The probe now reads the drawn `<rect>` out of the SVG and judges position against it, not
  against a constant of its own. The recorded away goal (x = 2.7) is at `cx 26.7` against a goal line at 18 (was 9.7, outside
  it and cut by the canvas edge); a ball at pitch x = 5, delivered on a third connection, is at `cx 34.2` = `18 + 324 * 0.05`
  (was ON the line).
- **Mutation, and one miss found by it:** against a local build and a stand-in relay, reverting the helper for both, for the
  ball only, and for the shots only each failed the booleans they target. The fourth case, the margin applied to x only,
  was NOT caught by the shot booleans: a goal near the centre line has almost no y error, and the vendor-placement check
  has a pitch unit of slack (the vendor's feeds differ by up to 0.5). The ball booleans caught it, but a shots-only
  y fault would have passed. Added `homeShotAtTransform` / `awayShotAtTransform` (the served `sharedPitch` formulas
  applied to the record, 0.01 px); the x-only margin then fails five booleans.
- **Process:** the client's 21 pre-deploy steps ran on a clean worktree before the push this time (0 not ok), and the
  cross-repo ratchet by hand. Nothing went red.
- **Limits:** Chromium only; recorded payloads over the page's real SSE path, not a live match; the margin is a constant,
  so a probe cannot tell a changed margin from the right one (it judges consistency with the drawn rect; the smoke
  assertion pins the value).

## Part 3 — the BSD request budget (docs/CC-CMD-2026-10-29-bsd-live-shot-source.md, Task 0 DONE, Task 1 DECIDED)

User: "measure the BSD budget". Relay commit `scripts/bsd-request-budget.mjs` + `bsd-request-budget.yml` + a guards.yml step; run 40962540855.

- **Premise tested before building (Rule 100).** The 2026-10-10 session said no rate-limit header exists, from 16 calls that looked for eight
  names. BSD's pricing page documents `RateLimit` and `RateLimit-Policy`, which none of the eight match, so the absence might have been a miss of
  the name. The script captures EVERY header. Result: **the 2026-10-10 finding stands**, now for all 23 header names the 6 calls returned.
  Nothing rate-shaped is served to this free football token. The budget cannot be read from the vendor.
- **The vendor's own pages disagree** (all fetched today): "Rate limits: None" (pricing.md), "7,500 per day" and "100 req/day" on the same
  page (/pricing/), "10 requests/second per IP" plus "daily quotas in the RateLimit headers" (llms.txt). Only the 10 req/s figure appears on
  more than one page. Recorded in the CC-CMD as claims with their date.
- **Measured:** BSD answers from a cache of its own (HIT or STALE on 5 of 5); 63 events today, 26 tracked, peak concurrency 9 ASSUMING 115-minute
  occupancy. 33 BSD call sites in the relay, 22 user-triggered in `/bsd/`, 11 in helpers; none counted.
- **Decision (Task 1):** poll `/stats/` once a minute per event with a connected subscriber, hard cap 600 a day, stop for the UTC day on the first
  429, one Analytics Engine datapoint per poll so the relay's BSD demand is countable at last. NOT BUILT: the cap is quota policy on an allowance
  nobody can read, so it is the owner's number. Reply "use 600" and the build is mechanical (the replay check and its mutation are specified).
- **Rule 90 on the new tool:** 22 self-tests, a 5-case mutation harness, and a source-mutation battery of 11 anchors, 10 caught and 1 an
  equivalent mutant (`Number(\d+) || 0`: a matched digit string is never falsy except a real zero).
- **What would have gone wrong with the original plan:** the CC-CMD said to read the limit from the response headers and write it into an artifact.
  The artifact would have been empty, or, worse, filled from the pricing page's 7,500 as if measured.

## Part 4 — the live shot poll (docs/CC-CMD-2026-10-29-bsd-live-shot-source.md, DONE)

User: "use 600". Relay commits `af644f66` (poll, checks, gate wiring), `a8fcfe42` (live verifier), `6618a28b` and `babc8d56` (the `side: null` finding below), `0f5dcede` (the served stats note).

- **What:** AmbientDO polls `GET /api/v2/events/{id}/stats/` once a minute for each match somebody activated whose WebSocket delivered a frame in the last
  180 s, and hands the vendor's `shotmap` array to the next `bsd:stats` once. Cap 600 a day, counted and STORED before each request, reset at 00:00Z. The first
  429, 401, 402 or 403 stops the UTC day. One Analytics Engine datapoint per attempt. `/ambient/state` reports `bsdPoll`. No client change: it already reads
  `data.shotmap`.
- **Checked:** `scripts/check-bsd-stats-poll.mjs` extracts the REAL constants and methods and runs 20 scenarios (72 assertions) against a fake clock, storage,
  fetch and Analytics Engine and the recorded 32-shot /stats/ body. `mutate-bsd-stats-poll.mjs` breaks the source 47 ways and the check 3: 50 caught, none
  unapplied, and every source mutation is refused if it does not even parse (a syntax error would "catch" it for the wrong reason). Two of my own
  scenarios were wrong on first run (a stale frame in the collection; a non-numeric id that the WebSocket path can never produce), fixed in the test, not the code.
- **Verified live** on event 7314 (Brasileirao, Atletico Mineiro v Cruzeiro, 2026-10-29): run 40976350727, `state verified` (12 assertions) and `pollState
  poll-verified`: two bsd:stats carried the vendor's array, 26 shots each, records in the shape the client reads. The DO's own account: `calls 9`, `last kind ok
  status 200`, `stopped null`, 27 shots cached. **The premise the poll rested on, that a LIVE /stats/ carries the `shotmap` key, had no live evidence when it was
  built; it has now.**
- **The count survives a restart, observed:** the next deploy (the `side` note, babc8d56) restarted the Durable Object at 00:18:31Z, and `/ambient/state` read
  `bsdPoll.day 2026-10-29, calls 9, last {7314, ok, 200}` straight after: restored from storage, not zero. The in-memory cache was empty (`shotmapsCached []`) and the
  timer unarmed until the next subscription, as designed. The day roll (09 -> the 30th) happens at the next poll round.
  **Day roll observed live, 2026-10-30:** `/ambient/state` read `day 2026-10-29, calls 9` at 02:39Z with nothing subscribed. Run 40993024320 (event 602470,
  Categoría Primera A, second half) subscribed; the first round at 02:41:23Z left `day 2026-10-30, calls 1, stopped null, last {602470, ok, 200}`, 9 shots cached. The run
  ended `state verified`, `pollState poll-verified`, `statsWithShotmapArray 3`, `shotsSeen 31`, `bsdPoll` `day 2026-10-30, calls 3` (artifact commit `07a0c78a`). That
  run overwrote `outbox/bsd-fanout-live-verify-latest.json`, so the event 7314 result is cited by its artifact commit `d78d51dd`. The view does not roll the day: until a
  round runs, `/ambient/state` reports the last day polled.
- **Three things the live run found that no recorded frame had shown:**
  1. **A Durable Object keeps running its old code after a deploy.** Deploy RELAY Worker finished 23:41Z; `/ambient/state` had no `bsdPoll` and
     `diag.instanceStartedAt` read 22:13Z until 23:45:56Z, five minutes later (Cloudflare: code updates reach Durable Objects "eventually consistent, typically seconds to
     minutes"). A live probe straight after a deploy reads the old object.
  2. **`side` is null on dead-time markers.** The first live run failed one fan-out assertion on a bsd:ball with `situation: gameon` and `side: null`. The recorded
     2026-10-28 frames already held two (602347 at 38:04 temporary_interruption, 39:18 gameon); the 392-frame census called `side` home|away and nobody had looked.
     3 of 3 dead-time markers carry null. The verifier first kept no evidence of which frame broke it (fixed: it keeps the window's ball payloads on a failure), then
     the assertion, CONTRACTS.md and the served `/bsd/contract` note were corrected.
  3. **A pinned line number moved.** The empty-catch ratchet requires a bare catch at `src/ambient-do.js:347`; my 30 added lines moved it to 377. Caught by the local
     deploy-step run, not by CI. Re-pinned in deploy.yml and guards.yml.
- **Known and bounded:** `POST /ambient/bsd/subscribe` is unauthenticated, so anyone can subscribe a live tracked match and spend the cap (a handful of matches burn
  600 in about an hour). The cap is the bound, and the loss is shots for the rest of the UTC day, not BSD quota beyond 600. The unauthenticated-routes CC-CMD already names
  the class; this adds one more spender to it.
- **Process:** the full deploy pre-step list (115 steps) ran on a clean worktree named `field-relay-nba` before the push. It found one real failure. Two later runs reused a
  step list generated BEFORE a workflow edit and reported the old failure again; the list is now regenerated before every run.

## Carry-forwards

The weather first-call wake (2026-11-03T18:00Z, `trig_01H7eoLwoZqWDj2q53XC1S8x`) is unchanged and not part of this.
