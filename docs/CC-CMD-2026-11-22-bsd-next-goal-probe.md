# Claude Code Command — measure BSD's Next to Score API on a live slate before any use of it is designed

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba executes it (the BSD token is a relay secret and the container cannot reach the vendor host); the artifact is read by field-laboratory and jubilant-bassoon sessions
**Filed:** 2026-11-22, by CC, from the owner's question "what can we do with the next goal section?" and the order "probe, commit to main"
**Type:** A (probe) — **no feature ships from this document.** One artifact, one run, nothing under `src/`.
**Status:** FILED 2026-11-22. Task 1 built (see Result: build). Task 2 (the live run) not yet dispatched.

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
| P3 | reads cover in-play matches without `websocket_plus`, and leagues FIELD tracks | `events/live` rows at minute 10 or later with no read | `analysis.coverage`, `analysis.leagues` |
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

Budget (Rule 78): at most 18 requests on an open gate (3 on a closed one), hard cap 24 (`CALL_BUDGET`), a 429 or 401 stops the run,
no schedule, one dispatch. Against the account's roughly 926 requests a day (6,483 over the 7 days to 2026-11-22, the owner's
dashboard), that is under 3% of one day.

**Done condition 1 (Rule 89, artifacts):**
`node scripts/check-bsd-next-goal-probe.mjs` prints `scenarios 22, assertions 90, failed 0`;
`node scripts/check-bsd-next-goal-probe-run.mjs` prints `scenarios 8, assertions 38, failed 0`;
`node scripts/mutate-bsd-next-goal-probe.mjs` prints `mutations 46: caught 46, NOT CAUGHT 0, NOT APPLIED 0`;
`node scripts/workflow-yaml-check.mjs` prints `0 failing`.
The fixtures are synthetic and say nothing about the vendor; the checks prove the verdict logic and the spend logic, not the vendor.

## Task 2 — dispatch on a live slate and read the artifact

`bsd-next-goal-probe.yml`, `workflow_dispatch`, during a live football slate. The run commits `outbox/bsd-next-goal-probe-<stamp>.json`
and, when any call returned 200, `outbox/bsd-next-goal-probe-latest.json`. It stores one verbatim row per endpoint as shape evidence.

**Done condition 2:** `outbox/bsd-next-goal-probe-latest.json` exists; `callsMade` is at most 24; `analysis.gate.verdict` is not `UNKNOWN`;
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

*(build, 2026-11-22: see Task 1; the live run is recorded below when it lands.)*
