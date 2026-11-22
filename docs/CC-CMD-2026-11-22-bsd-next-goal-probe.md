# Claude Code Command — measure BSD's Next to Score API on a live slate before any use of it is designed

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba executes it (the BSD token is a relay secret and the container cannot reach the vendor host); the artifact is read by field-laboratory and jubilant-bassoon sessions
**Filed:** 2026-11-22, by CC, from the owner's question "what can we do with the next goal section?" and the order "probe, commit to main"
**Type:** A (probe) — **no feature ships from this document.** One artifact, one run, nothing under `src/`.
**Status:** DONE 2026-11-22. Task 1 built and reviewed; Task 2 run once on a live slate (run 45056731513, artifact commit `7668eec`): the gate is OPEN for the relay's token, `event.id` is the `events/live` id, both filters are honoured, and the vendor's 73.6% reproduces within 0.2 points. Result below. Session doc: `outbox/cc-session-2026-11-22-bsd-next-goal-probe.md`.

---

## Why this exists

BSD's newsletter (`utm_campaign=next_goal_api`) announces `GET /api/v2/next-goal/`, `/next-goal/{event_id}/` and `/next-goal/calls/`:
per live football match, the probability that the home side, the away side or nobody scores the next goal, a `leader`, a
`confidence`, an `is_call` flag against a vendor `call_threshold`, an `evidence` block and a `track_record`; and a public ledger of
every published call and how it ended. The docs page says it "beats the live market on outcomes" and invites the reader to check
with `/calls/`; the vendor's marketing page (`https://sports.bzzoiro.com/next-to-score/`, read 2026-11-22 through a search-engine
crawl of unknown crawl time) says 73.6% of 1,508 graded calls over 90 days, 81.2% at 80%+ confidence (287 calls), 56.9% for the best
fixed guess, 998 matches across 64 competitions.

None of that is measured here (Rule 72). No file in field-relay-nba, field-laboratory, jubilant-bassoon or field-playground mentions
the endpoint (searched 2026-11-22 for `next-goal`, `next to score`, `nextGoal`, `next_goal`, `who scores next`: three hits in three
files, all false positives). The owner stated on 2026-11-22, from the vendor dashboard, that the account holds Football API
Unlimited, Live WebSocket and Sports Pack, and that the last two will be renewed. Which token the relay holds, and whether that
token is on that account, is not stated by any file (the relay's own 2026-10-29 budget artifact labels it free-tier; the label is
asserted, not derived).

## Related, read before building (BUILD-ON-A)

Searched 2026-11-22 by content in `docs/CC-CMD-*.md` of this repo and field-laboratory. Nothing covers next-goal; these bear on it:

- `docs/CC-CMD-2026-10-10-bsd-measure-before-building.md` (DONE): the pattern this follows (upstream probe with a declared call budget,
  one artifact, "no feature ships from this document"). Its harness `scripts/bsd-newsletter-claims.mjs` was **not** extended: it runs
  on a monthly schedule at 08:17 UTC, when a live-only endpoint has no slate, and editing it would touch code outside this ask (Rule 69).
- `docs/CC-CMD-2026-10-29-bsd-live-shot-source.md` (DONE): BSD's allowance cannot be read from the vendor's headers; the owner set a
  600-a-day cap on the one counted path (AmbientDO's stats poll). **That cap is for that poll and is not applied here**; this probe has
  its own bound (below), and the vendor dashboard is the one place the account's total is readable.
- field-laboratory `docs/CC-CMD-2026-11-11-v2-games-bsd-cache.md` (FILED): owns the uncached BSD call in `handleV2Games` and holds relay
  `src` changes to 2026-11-24. **Untouched.** A later `nextGoal` field on `/v2/games` belongs in that document.
- `docs/CC-CMD-2026-10-11-odds-live-path-404.md` (OPEN): defers "the WP bars' input" to a document that does not exist; a next-goal
  read is one candidate input. Recorded here, not decided.
- The queue row `bsd-live-capture-path` (captures stop before full time) is where a forward capture of next-goal reads would be added.

Holds respected: the CFL experiment's VOID window (2026-11-08 to 2026-11-23, `outbox/odds-cfl-season-end-prediction-2026-10-18.md`)
lists functions in `src/index.js` and `src/budget-helpers.js`; this change adds `scripts/`, `.github/workflows/` and `outbox/` files
and touches no `src/` file. ADR-002 Rules A and F: nothing is pushed, shown or stored in a binding.

## Premises, and the one command each (Rule 100)

| # | premise | what refutes it | answered by |
|---|---|---|---|
| P1 | the relay's token passes the next-goal gate | HTTP 403 (the docs say `unlimited_required`) or 402 on `GET /api/v2/next-goal/?limit=200` | `analysis.gate` |
| P2 | `event.id` is the id `events/live` and the relay's `bsdEventId` use | an id absent from `events/live`, or present with different team names | `analysis.idSpace` (names must agree: an id match alone can be two integer spaces) |
| P3 | reads cover in-play matches without `websocket_plus`, and leagues FIELD tracks | `events/live` rows **in play, not at halftime, at minute 10 or later** with no read (`events/live` is not an in-play list: see Task 1) | `analysis.coverage`, `analysis.leagues` |
| P4 | `league_id` and `calls_only` are honoured | a control call that still returns rows (`league_id` set above every league seen); a `calls_only` call that returns a non-call | `analysis.filterLeagueId`, `analysis.filterCallsOnly` |
| P5 | `/calls/` is readable, the vendor's 73.6% of 1,508 reproduces from its own counts, and "graded" has one meaning | the five outcome counts not summing to the window's count; no denominator that lands near 1,508 | `analysis.ledger.reproduction` |

Not answered by this run, each named so it is not mistaken for answered: whether the relay may forward vendor probabilities and
re-serve or cache them under BSD licence v4.0 (Rule 45, human review); whether the relay's Cache API takes effect on `workers.dev`
(`wrangler.toml` says it does not); whether a live `/v2/games` row carries `bsdEventId` (no committed capture proves it); whether
`check-live-score-poll` in field-laboratory can admit a second fetch; and "beats the live market", which no run can test because BSD
publishes no next-goal price.

## Task 1 — build the probe and prove it can fail (done in this session)

Files: `scripts/bsd-next-goal-probe.mjs`, `scripts/check-bsd-next-goal-probe.mjs`, `scripts/check-bsd-next-goal-probe-run.mjs`,
`scripts/mutate-bsd-next-goal-probe.mjs`, `scripts/fixtures/bsd-next-goal-synthetic.mjs`, `.github/workflows/bsd-next-goal-probe.yml`,
and one step in `.github/workflows/guards.yml`.

Budget (Rule 78): at most 18 requests on an open gate (3 on a closed one), hard cap 24 (`CALL_BUDGET`, an integer of 1 or more, else 24),
a 429 or 401 stops the run before the body is read, a redirect is an error (one request, never twenty), a 400-second run deadline
marks the rest UNKNOWN so the artifact is always written inside the workflow's 15-minute limit, no schedule, one dispatch. Against the
account's roughly 926 requests a day (6,483 over the 7 days to 2026-11-22, the owner's dashboard), that is under 3% of one day.

**Reviewed before the first run, and rebuilt.** Three independent reviewers read the first version (`79d9dfc`) adversarially. They found
no blocker and these defects, each fixed and pinned by a case in the checks:

- `events/live` is not a list of matches in play. On the committed 2026-09-19 capture (`outbox/bsd-uefa-probe-20260919T161717Z.txt`) 34 of
  58 rows are `finished` with `FT` and a null minute and one is at halftime. The first version counted every row, labelled finished
  matches "before minute 10" and printed no in-play denominator. Coverage is now over in-play matches at minute 10 or later, excluding
  halftime, with the status/period vocabulary seen written into the artifact (`analysis.live.statusPeriod`) so a miss is visible.
- An empty list while matches are in play skipped the one call that says why; the in-play no-read pick fell back to a finished match.
  The pick is now made on an empty list and is never a finished or not-started row. `UNKNOWN` reasons now say what actually happened.
- `is_call` was judged against `confidence >= call_threshold` with no allowance for a paused call or 2-decimal rounding; `calls_only` was
  `HONOURED` on an empty answer; a truncated list (`next` set or `count` above the rows) was reported as complete; the ledger reproduction
  said `ANSWERED` even when the five outcome counts did not partition the window; team names that differ only in diacritics read as an
  id collision; a name that folds to nothing agreed with another.
- A 429 whose body then failed did not stop the run; `CALL_BUDGET` fell open on a typo; a redirect was up to 20 requests; the token guard
  looked only for the raw string; a token with a trailing newline was refused by `fetch`; the worst case (17 calls at 30 s) ran into the
  10-minute limit; an analysis that threw, or a deep row, erased the whole run; and "reached the vendor" meant any 200, so an
  events/live-only run advanced `-latest.json`. It now advances only on a definite answer (open, gated or absent) from the list or the ledger.
- The checks themselves: the reviewers wrote 169 new mutations and 135 survived. The checks were extended until the survivors were killed
  or shown equivalent (one was a redundant guard, removed), an early `process.exit` can no longer pass, and a mutant that does not parse
  can no longer count as caught.

**Done condition 1 (Rule 89, artifacts):**
`node scripts/check-bsd-next-goal-probe.mjs` prints `scenarios 19, assertions 241, failed 0`;
`node scripts/check-bsd-next-goal-probe-run.mjs` prints `scenarios 22, assertions 102, failed 0`;
`node scripts/mutate-bsd-next-goal-probe.mjs` prints `mutations 265: caught 265 (probe mutants: 207 by the analysis check, 49 by the run check), NOT CAUGHT 0, NOT APPLIED 0`;
`node scripts/workflow-yaml-check.mjs` prints `0 failing`.
The fixtures are synthetic and say nothing about the vendor; the checks prove the verdict logic and the spend logic, not the vendor.

## Task 2 — dispatch on a live slate and read the artifact

`bsd-next-goal-probe.yml`, `workflow_dispatch`, during a live football slate. The run commits `outbox/bsd-next-goal-probe-<stamp>.json`
and, when any call returned 200, `outbox/bsd-next-goal-probe-latest.json`. It stores one verbatim row per endpoint as shape evidence.

**Done condition 2:** `outbox/bsd-next-goal-probe-latest.json` exists; `callsMade` is at most 24; `reachedTarget` is true and `analysisError` is null; `analysis.gate.verdict` is not `UNKNOWN`;
and either `analysis.shape.verdict` is `ANSWERED` (reads were present) or its `why` names an empty slate, in which case Task 2 repeats
on the next live slate (the same task, not a carry-forward). The coverage line is quoted in Result.

## Task 3 — record the result here, in HANDOFF and in the session doc

Quote the coverage line and the verdicts verbatim in the Result section below, in the HANDOFF close-out, and in
`outbox/cc-session-2026-11-22-bsd-next-goal-probe.md` (Rule 67). Update Status.

## Not in scope

Any `src/` change, route, cron, Durable Object or binding; any push, alert or SSE frame (ADR-002 Rule A, owner ruling needed);
displaying a read anywhere (Rule F); a `/v2/games` field (the lab's `v2-games-bsd-cache`); the plan and renewal decisions (the owner's).

## What the verdicts decide next

The next CC-CMDs are written against these numbers, not before them:

- `GATED` on the list or the ledger: stop. Ask the owner whether the relay's token is on the Unlimited account; nothing else follows.
- `OPEN`, `SAME_ID_SPACE`, filters `HONOURED`: the candidates are a relay pull route (`/bsd/events/{id}/next-goal`, after 2026-11-24 and
  with its own counter), a lab proof grading `/calls/` against FIELD's captured goal timelines (the lab's PROOF-doc method, Rule 91
  coverage line, a mutation table first), and a forward capture through full time under `bsd-live-capture-path`.
- `NOT_JOINED` or `ID_COLLISION`: no surface can key on `event.id`; the relay's name-join stays the only join and that is the finding.
- `analysis.ledger.reproduction.closestToVendorAccuracy` names which reading of "graded" the vendor's 73.6% uses; the lab proof must
  use the same denominator or say it does not.

Owner rulings that gate the surfaces and that no run makes: is a viewer-side minute poll of a vendor model read "pull" under Rule A;
may `is_call`, `call_threshold` or `calls_only` be forwarded or shown (Rule F); is SSE fan-out push; may the lab's live card go beyond
"score and minute only"; the BSD call budget for a next-goal path against the 600-a-day number; relay `src` timing after the VOID window;
and licence v4.0 §4 against the relay's existing `/bsd/*` passthrough and a new route (Rule 45).

## Result

**Task 2, 2026-11-22T18:44Z, run 45056731513** (workflow `bsd-next-goal-probe.yml` at `1c33fe9`, artifacts `outbox/bsd-next-goal-probe-2026-11-22T18-44-06-676Z.json`
and `-latest.json`, committed by the run as `7668eec`). The relay's `BSD_API_TOKEN`, 18 requests of a cap of 24, `stopped` null, `analysisError` null,
`reachedTarget` true. Every step of the run was green, including the mutation harness on the runner. Coverage line, verbatim:

> next-goal list: 16 rows (gate OPEN 200) | events/live: 18 rows, 17 in play, 17 at minute 10+ (16 with a read, 1 without) | leagues with reads: 12 | ledger: 1533 calls since 2026-08-24, 200 page rows, 5 of 5 outcome counts | calls 18/24

| # | premise | result |
|---|---|---|
| P1 | the relay's token passes the gate | **Holds.** `/next-goal/` and `/next-goal/calls/` both answered 200. No `RateLimit` or `Retry-After` header on any of the 18 responses (0 of 18). |
| P2 | `event.id` is the `events/live` id | **Holds.** 16 of 16 next-goal ids are in `events/live`, 16 team-name pairs agree, 16 home team ids agree, ids are numbers. |
| P3 | reads cover in-play matches without `websocket_plus`, and FIELD's leagues | **Mostly.** 16 of 17 in-play matches at minute 10+ had a read. The one without (Taça de Portugal, league 92, first half, minute 15+, `websocket_plus` false) answered `available:false, reason:"too_early"` on its own call, so `too_early` is not only a minute-under-10 state. 2 of the 3 non-`websocket_plus` matches at minute 10+ had reads, so a read does not need that tier. 12 leagues had reads; **2 of 16 rows are in a league FIELD tracks** (La Liga, Serie A; FIELD's BSD ids are 1, 3, 4, 5, 6, 7, 8, 12, 18) and 14 are in leagues it does not (Pro League, Superliga, Stoiximan Super League, Liga F, Segunda División, Eliteserien, Czech First League, Nike liga, and others). |
| P4 | `league_id` and `calls_only` are honoured | **Both honoured.** `calls_only`: 1 row of 16 (the one call). `league_id=14`: 2 rows, all in league 14; control `league_id=100109`: 0 rows. |
| P5 | the ledger is readable and the vendor's 73.6% of 1,508 reproduces | **Readable, and it reproduces.** 1,533 calls since 2026-08-24; hit 1,125, miss 407, open 1, nogoal 0, unclear 0; the five counts sum to the window (partition holds). Accuracy 1,125 / 1,532 = **73.43%**, 0.17 points under the vendor's 73.6%, and 24 calls over its 1,508 (a crawl of unknown date). `nogoal` and `unclear` are 0 in the window, so all three readings of "graded" give the same number and **this run cannot say which the vendor uses**. |

Found that the vendor page did not say or got differently (Rule 72, each measured in this one run):

- `leader` takes the value `none` (5 of 16 rows), not only `home` and `away`. `call_threshold` is 0.7 on all 16 rows (the page's example shows 0.6). `call_paused` was false on all 16.
- `track_record` is `{"accuracy": 71.3, "base_rate": 56.9, "brier_skill_score": null, "matches_evaluated": 4479}`: accuracy and base rate are on a percent scale, the Brier skill is null, and the match count is 4,479 (the docs example shows 0.72, 0.51, 0.21 and 3,300).
- `probabilities` sum to 1 on 16 of 16 rows within 0.011, `no_goal` is never null, all values are fractions; `is_call` agrees with `confidence >= call_threshold` on 16 of 16; `momentum_5m` ranges -37.8 to 50.8 and `momentum_15m` -24.9 to 34.2 (units not stated by the vendor).
- `generated_at` is 0.3 to 1.3 seconds ahead of the runner's clock at the first call, so a read is stamped when it is served.
- The ledger is newest-first: 1,744 calls in all, the oldest dated 2026-08-05T21:49:14Z; each row carries `called_at`, `resolved_at`, `resolved_minute`, `side`, `probability` (0.70 to 0.937 on the latest 200) and `score_at_call`. On the latest 200 (2026-11-12 to 2026-11-22) 136 hit, 63 missed, 1 open, and 149 were home calls.
- `available:false` for a finished match answers `reason:"not_live"`, as documented. A single-match answer carries the same keys as a list row plus `available`.

**What this run does not say** (Rule 73): it is one instant on a Sunday-evening Europe slate (no EPL, MLS or UEFA match among the 17), 16 reads, so league coverage is that slate's and not the product's;
it does not test "beats the live market" (no next-goal price exists) and says nothing about whether a call was published before the goal beyond the vendor's own `called_at`; the accuracy is the vendor's ledger
recomputed from its counts, not FIELD's grading; the plan the token is on is inferred from the 200, not read from the account. One verbatim row per endpoint is stored in the artifact as shape evidence and the repository is public:
flagged for human review under Rule 45 (the licence's §2 permits storage and display in one's own applications; whether a sample row in a public repository is "display" is not decided here).

## Done conditions, as probed

Done condition 1: the three checks and the harness pass (see Task 1). Done condition 2: `outbox/bsd-next-goal-probe-latest.json` exists; `callsMade` 18 (at most 24); `reachedTarget` true;
`analysisError` null; `analysis.gate.verdict` OPEN; `analysis.shape.verdict` ANSWERED (16 rows). The coverage line is quoted above.

## What the result decides next

The premises that gated every surface are answered, so the next CC-CMDs can be written against numbers. Unblocked on the data side: a laboratory proof that grades `/calls/` (its event ids are the `events/live` ids, the space FIELD's `bsdEventId` comes from; that they also key FIELD's R2 captures is not yet
measured; it has `called_at` and `resolved_at`, 1,533 calls in 90 days, readable by the relay's token on a runner) against FIELD's own goal timelines; its first task is a census of how many of the ledger's calls fall in leagues
FIELD captures (2 of 16 live reads did) and how many of those captures saw full time. Still gated by owner rulings and the 2026-11-24 relay `src` date, and not touched here: a relay pull route, a lab card line,
anything pushed or shown. The rulings listed above stand.
