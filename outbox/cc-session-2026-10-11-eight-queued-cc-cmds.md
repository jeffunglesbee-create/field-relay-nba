# CC session — the eight queued CC-CMDs, executed in order

**Date:** 2026-10-11
**Repo:** field-relay-nba, branch `main` (direct commits, no PR)
**Spent at the vendor:** **0 credits.** The Odds API was never called.

## Outcome

| # | document | outcome |
|---|---|---|
| 1 | `bsd-odds-substitution-refused` | **DONE** — refusal recorded, 4 of its own citations refuted and not committed |
| 2 | `bsd-form-into-forecaster` | **STOPPED at Task 1** — `league_id` does not filter |
| 3 | `bsd-predicted-lineups` | **DONE** — route live, renderer CC-CMD filed |
| 4 | `bsd-broadcasts-territory` | **DONE** — two routes live, territory 171/171 |
| 5 | `bsd-hook-admission-and-per-league-rates` | **DONE** — two "dead" fields overturned |
| 6 | `nhl-shift-charts-on-ice` | **DONE** — all four seasons serve, route + reconstruction live |
| 7 | `nhl-wpa-attribution` | **STOPPED at Task 4** — residual is the shootout, entirely |
| 8 | `hockey-wp-moneypuck-baseline` | **STOPPED at Task 1** — the column is empty on 78,611 of 78,611 rows |

Three stopped, and every one stopped **at its own stop condition, on a
measurement**. None stopped for want of access.

## A premise audit ran first, and it changed the work

25 agents, 11 documents, each profiled then adversarially re-verified against
HEAD. **0 came back READY.** The audit's value was not the verdict but the
specifics — it is why doc 1 shipped without three unsourced claims, why doc 4's
gate was measured before its routes were written, and why doc 8's artifact
guard existed before the run that needed it.

**It also found the thing blocking everything.** A docs-only commit filed that
night left the citation ratchet at 10 against a budget of 9, and that gate is
blocking in **both** `guards.yml` and `deploy.yml`. Seven of the eight documents
touch `src/`, so every one would have failed CI on its first commit for a reason
none of them caused. Fixed before doc 1 started.

## What the eight measured

**Doc 1 — the BSD odds refusal.** The measurement holds completely: 17 premises
re-verified. Pre-match event 220230 carries `asian_handicap`, `btts`,
`draw_no_bet` and nothing else; live event 207856 adds `1x2` and four
`over_under_*`; `hasOpeningValue: false` in both. **Four of the document's own
citations were refuted and none was committed** — the placement (the metered
vendor lives in `src/index.js`, not `odds-consumer-rules.js`), a precedent
document that does not exist, an unsourced vendor quote, and the wrong rule
number.

**Doc 2 — `league_id` does not filter.** No `league_id` returns 10 matches;
`league_id=1`, the club's *own* competition, returns **0**; so does an id that
cannot exist. Not filtering, and not the labelling the document predicted —
a third behaviour. The headline premise holds and is now located: xG is nested
in `stats`, `expected_goals` 0.858/match, present in `overall`/`home`/`away`/
`vs_stronger` and **absent from `vs_weaker`**, the one block a ppg model cannot
express. The window was named and is now measured: last ten matches, 56 days.

**Doc 3 — predicted lineups.** 8 of 8 pre-match events return
`lineup_status: predicted`, `beta: true`, with a real team sheet: formation,
confidence, eleven players carrying `position` and an **`ai_score`**, plus
substitutes. `unavailable_players.reason` is non-null on **22 of 23** (95.65%).

**Doc 4 — broadcasts.** The gating premise had never been measured; only the
key's presence had. `country_code` is populated on **171 of 171** event rows and
**34 of 34** channel rows across 73 territories. Basketball broadcasts 404;
hockey had no events and is UNMEASURED, not unsupported. Join rate **1 of 12** —
BSD's daily slate is global football, FIELD carries six European/MLS leagues.

**Doc 5 — the hook admission bar.** Sampling one value per field overturned two
of three "dead" verdicts: `round_name` reads **"Round of 16"** on 3 of 178 rows
and `previous_leg_event_id` reads **604502** on 2. Both measured 0% on 10-10
because that slate had no knockout rounds and no two-legged ties. Only
`attendance` is dead on two separate days. The absence overlap is **DIFFERENT
ROWS** — 169/63/62/107/1 — refuting the document's one-cause hypothesis while
its shape survives across 47 leagues. `total_matches` is never zero, so "never
met" is not distinguishable: stop condition fired.

**Doc 6 — shift charts.** `api.nhle.com`, never called from this repo, answers
200. **All four of the WP model's seasons serve** — 894 / 791 / 829 / 751 rows
— each against a control game proved to exist first. On-ice state is a backfill,
not a wait. The `eventNumber` negative widened from nine samples to **32 of
3,265 (~1%)**, which is chance collision between overlapping integer ranges, not
the zero the document predicted — and sharper than zero, because a join on it
would silently fail to attach 99% of shifts. `endTime` is **EXCLUSIVE** (119 of
125 agree with `situationCode`, against 108), and the clock counts up on 692 of
692.

**Doc 7 — WPA.** The conservation check closes on **21 of 23 non-shootout
games** (regulation median residual **0.000**) and fails on **5 of 5 shootouts**
(0.635–0.701). The model's nine features describe score, clock, strength and xG;
none describes a penalty-shot round. **And the check proves less than it
appears to:** the deltas telescope, so their sum is identically
`wp_last − wp_first` — measured true on all 28 games — and a double-counted play
in the middle would cancel out.

**Doc 8 — the MoneyPuck baseline.** 2020's `homeWinProbability` is **empty on
78,611 of 78,611 rows**. The document read `{"2020": []}` — a list of columns
absent from the *header* — as "present only in 2020". There is no MoneyPuck
baseline in any season file, so `beats_moneypuck: null` is the correct value and
not a gap. One result survived: a model fit on 2021-2023 and tested on 2020
scores **0.17404** against the shipped **0.172669** on 2023.

## The deploy was red for the whole queue, and I did not look

Every deploy from `3765a55` through `defc1e1` **failed**. Cause: doc 1 added
one comment line each to `src/odds-consumer-rules.js` and `src/odds-shape.js`
naming the metered vendor's base constant, which pulled both files into the
population of *"every odds call is charged to the monthly ledger"*. Two prose
pointers, four stopped deploys.

So four route blocks were unshipped while three documents were closed saying
**"route live"**. The probes behind those documents called BSD and
`api.nhle.com` directly from a runner — real vendor data, no information about
the relay. Deployed state asserted from local reading, which is assumption
class A in this repository's own rule.

Once deployed, a live probe found two more defects, stacked:

| | |
|---|---|
| `/nhl-stats/*` | shipped **inside** `if (pathname.startsWith('/bsd/'))` — unreachable by construction; the `/nba/*` catch-all answered 403 |
| the forward | base was the bare host against an allow-list of `/stats/rest/en/shiftcharts`, so the documented form was refused |

The second was invisible until the first was fixed: the catch-all was answering
for the route. **And the probe's own negative control passed on the catch-all's
403**, because both requests came back 403 and status alone cannot tell them
apart — Rule 90's lesson landing in a check written the same hour. It now
asserts the route's own refusal body, which carries `allowed`.

The generated provenance manifest had already recorded the first defect and
nobody read it: `"/bsd/"` listed `api.nhle.com` among its sources because the
block was lexically inside it. A **false** source, generated silently. The
missing `/nhl-stats` entry is the lesser half — `route-scan.mjs` builds its
population from `pathname === '…'` and `pathname.startsWith('…')` only, so
**11 routes at HEAD** (9 `/bsd`, 1 `/cfl`, 1 `/nhl-stats`) are not counted at
all, and *"189 routes mapped, 187 with a declared source"* reads as a
denominator that includes them. Filed as
`docs/CC-CMD-2026-10-11-regex-routed-paths-outside-the-population.md`.

Live now, run 38121763921 — **5 PASS, 0 FAIL, 1 UNMEASURED of 6 surfaces**:

```
/nhl-stats/shiftcharts            200   rows 692   X-NhlStats-State: vendor
/nhl-stats/zzz-not-a-real-prefix  403   refusedBy: nhlStatsAllowed
/bsd/events/220230/lineups        200   predicted / served / beta true
/bsd/events/220230/broadcasts     200   X-Broadcast-Territory-Stated 2/2
/bsd/tv-channels/:id/broadcasts   UNMEASURED — no channel id in those 2 rows
```

692 is the same count the vendor probe measured on that game, from the other
side of the relay.

`.github/workflows/live-route-probe.yml` exists because deploy.yml's own last
step, named *"the routes this deploy touched still answer"*, probes two routes
a past deploy touched.

## Defects found in my own work

The six below were caught before publication. The four above were not — three
documents were closed on an unshipped deploy, and the live probe is what found
them.

1. **A control that compared the question, not the answer.** `league_id` is
   echoed in the payload and my fingerprint included it, so every fingerprint
   differed by construction and the first run reported **FILTERS** over four
   responses reading 10 / 0 / 0 / 0.
2. **An xG scan that was top-level only**, reporting `[]` on a payload carrying
   three xG fields one level down — it would have refuted doc 2's headline
   premise on evidence that supports it.
3. **A join rate that scored 12 of 12 on a check with no failure mode.**
   `resolveTeamKey` folds *any* string to a slug — "Qqqq Zzzz United" →
   `qqqqzzzzunited` — so it measured "the name is non-empty".
4. **A goal credited −0.0012 on the goal that opened the scoring**, because the
   score carry sat below the snapshot push and a goal's swing landed on the next
   shot. Telescoping meant the conservation sum was identical either way.
5. **`Authorization: Bearer`** where the relay has used `Token` at three call
   sites since forever. Four 401s, which the classifier refused to read as a
   verdict.
6. **A hardcoded self-test denominator** printing `14/14` while 24 checks ran.

Two mutation anchors broke on these edits and the harness reported **ANCHOR /
NOTHING WAS MUTATED** rather than a false CAUGHT.

## Checks

| | |
|---|---|
| `check-hockey-wp.mjs` | **63** |
| `mutate-hockey-wp.mjs` | **18 mutations, 18 caught, 0 unsound** |
| `check-nhl-onice.mjs` | **14** |
| `bsd-field-census.mjs` | 24 |
| `bsd-form-probe.mjs` | 21 |
| `bsd-broadcasts-probe.mjs` | 16 |
| `bsd-lineups-probe.mjs` | 15 |
| `nhl-shiftcharts-probe.mjs` | 10 |
| `nhl-wpa-conservation.mjs` | 4 |
| | **90 probe self-tests, counted — not 169** |

## Residual

**None deferred.** Two follow-up CC-CMDs were **filed, not carried forward**
(Rule 87.4): `CC-CMD-2026-10-11-predicted-xi-render-decision.md` and
`CC-CMD-2026-10-11-wpa-shootout-residual.md`.

**What is still open, counted from the headers rather than recalled:** three
documents carry `FILED, not started` besides the two filed today — the two
2026-09-15 documents and `empty-catch-gate` (10-03) — four carry `OPEN`
(`golf-slate-line`, `misjoined-opening-odds`, `port-citation-check`,
`rotate-relay-secret`, whose step 3 needs a human), and
`2026-09-15-capture-provenance-mark` reads `BUILT, dry-run only` with the write
unauthorised.

**That last one is wrong, and this is a correction appended 2026-10-11 rather
than a quiet edit.** The mark was APPLIED on 2026-09-15, run `34980428015` —
874 rows, 0 unmarked — and its own document has recorded that 130 lines below
the header this line was read from. Re-measured 2026-10-11 (run `38143984631`):
still 0 unmarked, 874 marked, watch green at baseline 0.

The irony is the lesson: this paragraph says in its next sentence that the two
2026-09-15 documents are obsolete because "only the stale headers remain", and
it then repeated a third stale header as current state. Reading a header is not
reading a document, and the correction below was earned twice — the figure
reported to the owner was "58 rows", a number that document's own correction
section had already replaced with 874.

The audit found both 2026-09-15 documents **OBSOLETE** — their work landed the
day they were filed and only the stale headers remain. That verdict is the
audit's and was not re-verified today. See HANDOFF.md for the table.
