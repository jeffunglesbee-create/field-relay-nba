# Claude Code Command — measure four BSD premises before building on any of them

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (probe) — **no feature ships from this document.** One artifact.
**Status:** DONE 2026-10-10. Five tasks, six done conditions, no feature
shipped. 16 calls of a declared 40-call budget. Artifact:
`outbox/bsd-surface-probe-latest.json`. Session doc:
`outbox/cc-session-2026-10-10-bsd-measure-before-building.md`.

Headline: **the free-odds substitution is NOT viable.** The 10-03 thin result
was partly a finished-match artifact — a LIVE event carries `1x2`,
`asian_handicap` and four `over_under_*` keys — but the PRE-MATCH sample, which
is the product BSD describes, carries only `asian_handicap`, `btts` and
`draw_no_bet`: no moneyline, no goals total, no opening price on either.

## Why this exists

A 2026-10-10 review of BSD's v2 surface found 223 endpoints offered and 10
consumed. Four candidates are worth building on and **all four rest on a
premise that has not been measured.** This repository's record on that is
specific: the MLS odds-key divergence was dispatched as a fix and the relay's
own source already documented the premise as false
(`src/odds-sport-keys.js` header), and the EPA route reported
"149 route plays, 149 client plays, 0 disagreements" while comparing both sides
against a table only one had unwrapped. A mechanism that fits is not a cause,
and agreement on zero is still agreement.

So: measure first, in one run, with a credit budget, writing one artifact.
Then four separate CC-CMDs can be written against numbers.

**Budget:** `scripts/bsd-newsletter-claims.mjs` is the precedent — it declares
`callBudget` and reports `callsMade` (20/40 on its last run). Do the same. BSD
football is free, so the cost here is rate limit, not money, and `rateLimit`
came back `{}` on that run — **the limits are unmeasured too.** Capture every
rate-limit header this run sees; that is Task 5.

## Task 1 — do BSD's pre-match odds carry the markets FIELD models?

**The premise to kill or confirm.** BSD football odds are free. FIELD buys odds
from a metered vendor. That looks like an obvious cost win, and the only
measurement available argues against it: the 10-03 probe of
`/api/v2/events/{id}/odds/comparison/` on event 605110 returned

```
marketKeys: ["btts", "draw_no_bet"]     bookmakersCount: 4   totalOdds: 8
newsletterFields: { europeanHandicap: [], openingPriceFields: [], movementFields: ["movement (x8)"] }
```

No moneyline. No spread. No total. No opening price. FIELD's model needs all
four, and `odds-consumer-rules.js` / `odds-shape.js` encode what a usable blob
must contain.

**But that event was `eventStatus: "finished"`**, and the docs describe the odds
product as **pre-match**. So the thin result may be a consequence of sampling a
finished match — plausible, and plausible is not measured.

**Probe:** the same endpoint plus `/api/v2/events/{id}/odds/` and
`/api/v2/odds/best/` on a **pre-match** event (use `/api/v2/events/` with a
future `date_from`, or `coverage.next_event_at`), and on a **live** one.
Record, per market key: bookmaker count, whether a price has an opening value,
and whether moneyline / spread / total appear under ANY name. Do not map names
to FIELD's vocabulary — report BSD's keys verbatim and let a later document do
the mapping.

**Report the verdict as one of:** markets sufficient for the model / sufficient
only for a subset (name it) / insufficient. If insufficient, say so plainly —
a free source that cannot price what the model needs is not a saving.

## Task 2 — what shape is `/api/v2/teams/{id}/form/`?

Declared in the schema, never probed. It is the input
`field-laboratory/docs/CC-CMD-2026-09-11-epl-forecaster-phase1.md` needs and
does not have: that document records fbref xG as `teams: 0`,
`updated 2026-06-23`, 3.5 months stale and still labelled 2025-2026, and
`src/Forecast.fs`'s `METHOD = "table-v1: ppg + 0.25*gdpg + 0.10*gfpg,
home +0.30"` exists because no better input was reachable.

Per-event xG IS reachable and measured — event 223324 on 2026-10-10 carried
`expected_goals` 1.39 / 1.69, `xg.actual`, `expected_goals_on_target`,
`big_chances`, `ball_possession`, and `has_xg` is a flag on every event row.

**Probe:** `/api/v2/teams/{id}/form/` for an EPL club. Record the shape, the
window it covers (last N matches? season to date?), whether it carries xG or
only results, and whether it is per-competition or all-competitions. The last
question decides whether it can feed a league-position forecast at all.

## Task 3 — do BSD's basketball and hockey include the NBA and NHL?

`/coverage/` reports basketball `events_next_7d: 57` and hockey `205`. Whether
those include North American leagues is **unknown and consequential**: if they
do, Task 1's cost argument extends to two more sports, and FIELD's NBA/NHL odds
spend is in scope. If they are European-only, it does not.

**Probe:** `/basketball/api/v2/leagues/` and `/hockey/api/v2/leagues/`. Report
the league list verbatim. One call each.

## Task 4 — what do `broadcasts` and `lineups` actually return?

Both are candidates with real product value and neither has a measured shape.

`/api/v2/events/{id}/broadcasts/` and `/api/v2/tv-channels/{id}/broadcasts/`:
FIELD's own description is scores, **broadcast costs** and journalism, and
`/context/date` on 2026-10-08 carried `streams: "ESPN+, MSGB, Prime Video
(Local)"` on NHL rows and `streams: null` on five of six NBA games. Probe both,
and record whether the data is territory-scoped — a channel list with no
territory is unusable for a US reader and worse than none.

`/api/v2/events/{id}/lineups/`: the 10-03 run already measured it at 200 with
41 fields — `lineup_status`, `beta`, `unavailable_players` (carrying `reason`),
`updated_at` — and team squads at `/api/v2/teams/{id}/squad/` carrying
`injury_type` and `injury_expected_return`. **What is NOT measured is when it
populates.** That sampled event was finished. A predicted lineup an hour before
kickoff and a confirmed one at kickoff are different products, and
`lineup_status` plus `beta` suggest the vendor distinguishes them. Probe a
pre-match event and a live one, and record what `lineup_status` reads in each.

This is the same question that took three and a half months to answer for
`average_positions` — which 404s live, serves `{}` during play, and populates
only post-final **and** only when `websocket_plus` is true (measured
2026-10-10: event 213708 `true` → populated, 588245 `true`/finished-today →
`{}`). Ask it up front this time.

## Task 5 — the rate limits, which nobody has measured

`bsd-newsletter-claims-latest.json` reports `rateLimit: {}`. Capture every
response header matching `x-ratelimit*`, `retry-after`, `x-cache-status` across
this run and record them. The docs point at "Conventions & limits"; a header is
a measurement and a doc is a claim.

## Stop conditions

- **No feature ships from this document.** If a task tempts an implementation,
  file a separate CC-CMD and stop.
- If a probe needs more than the declared call budget, stop at the budget and
  report what went unmeasured. A partial artifact that names its gap is worth
  more than a full one that guessed.
- Report BSD's field names verbatim. Mapping them to FIELD's vocabulary is a
  later decision and doing it here hides the evidence.

## Done conditions

1. One artifact, `outbox/bsd-surface-probe-<ts>.json`, with `callsMade`,
   `callBudget`, and a named verdict per task.
2. Task 1 states whether the free-odds substitution is viable, in those words.
3. Task 2 records the `form` shape and window, or that the endpoint does not
   serve one.
4. Task 3 lists the basketball and hockey leagues verbatim.
5. Task 4 records `lineup_status` at three match states, and whether broadcast
   data is territory-scoped.
6. Rate-limit headers are recorded, or their absence is stated as a finding.
