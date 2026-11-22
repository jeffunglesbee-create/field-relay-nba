# Claude Code Command — count how much of BSD's published next-goal ledger FIELD's own goal timelines can grade

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba executes it (the BSD token is a relay secret; the container cannot reach the vendor host); the artifact is read by field-laboratory sessions
**Filed:** 2026-11-22, by CC, from the owner's reply `Census` to the offer in the probe's result ("a laboratory proof that grades `/calls/` ... its first task is a census")
**Type:** A (probe) — **counts only.** No feature ships from this document, nothing under `src/`, no verdict about the vendor.
**Status:** OPEN 2026-11-22. Task 1 built (checks and harness listed under Task 1); Task 2 (the dispatch) and Task 3 (the record) not yet done.

Builds on `docs/CC-CMD-2026-11-22-bsd-next-goal-probe.md` (DONE; BUILD-ON-A). That document's result is the premise here, not repeated: the
relay's token passes the gate, `event.id` on a call is the id `events/live` uses, and the ledger (`GET /api/v2/next-goal/calls/`, newest-first,
1,744 calls in all on 2026-11-22, the oldest dated 2026-08-05T21:49:14Z) reproduces the vendor's 73.6% within 0.2 points. Nothing in it is undone
or worked around. Its holds stand: no `src/` file is touched (the CFL VOID window to 2026-11-23 and the lab's `v2-games-bsd-cache` hold to
2026-11-24), nothing is pushed or displayed (ADR-002 Rules A and F).

## Why this exists

The probe measured that the vendor's own ledger is readable. It did not measure whether FIELD can check it. FIELD's R2 holds goal timelines for
the matches it captured (`bsd/{slug}/{id}/incidents.json`, written by the relay from the BSD live feed), and the probe found only 2 of 16 live
next-goal reads were in leagues FIELD tracks. If few ledger calls sit on a captured match, or the captures stop before the call resolves
(the laboratory's `outbox/flow-census-latest.json` had 53 of 853 captures seeing full time on 2026-10-18), a grading proof in the laboratory
would grade almost nothing, and the number worth knowing before building it is **how many calls it could grade.** That is the census.

"Gradeable" is a count of what FIELD's data would let a later proof attempt. It is not a grade, and it says nothing about whether the vendor was
right (that is the proof, a separate document, below).

## Premises, and the one command each (Rule 100)

| # | premise | what refutes it | answered by |
|---|---|---|---|
| C1 | the ledger can be read in full | fewer unique rows than the count the vendor reports at the start of the run, or a closing count that has moved the other way | `analysis.ledger` (`COMPLETE` or `PARTIAL`, reported count first and last, duplicates) |
| C2 | FIELD's R2 can be listed in full through the relay's public routes | a truncated page with no cursor, a page that answers a different prefix, a failed page | `analysis.r2` (`COMPLETE` or `PARTIAL`, the reason) |
| C3 | a ledger `event.id` is the id in an R2 key `bsd/{slug}/{id}/...` | no ledger event in a league FIELD tracks has a key (which would be either no capture or a different id space, and the census cannot tell the two apart: it reports the count of tracked events without a key and says so) | `analysis.calls.trackedLeagueWithoutIncidentsKey`, `distinctTrackedEventsWithoutKey` |
| C4 | an `incidents.json` says whether the match was seen to full time, and how far its clock got | a capture with no parseable period or minute rows | `analysis.captures` (full-time rows, clock kinds `full-time`, `live-marker`, `lower-bound`, `none`) |

Not answered by this run, each named so it is not mistaken for answered: whether a call was right; whether the vendor published the call before the
goal (`called_at` is the vendor's own stamp); whether the captures' clocks are accurate; the BSD licence v4.0 §4 question (Rule 45, human review —
the artifact therefore holds counts and no ledger row, team, player or event id, and the repository is public).

## Definitions (written before the run, so the run cannot choose them)

A call is **gradeable** when all of these hold:

1. `outcome` is `hit` or `miss` (an open call, or any other state, is not);
2. it has a numeric `resolved_minute`;
3. R2 holds `bsd/{slug}/{event.id}/incidents.json` for that event;
4. that file was read and parses into goal and period rows;
5. the capture **covers** the call: it saw full time (a `period` row whose text starts `FT`, `AET`, `AP` or `PEN` with `is_live` false), **or** its
   clock reached the call's `resolved_minute`. A live `period` row's minute is the clock; absent one, the latest incident minute is a lower bound.

Every call that is not gradeable is counted under exactly one reason (`analysis.calls.notGradeableBecause`), in the order above. The verdict is
`ANSWERED` only when the ledger is complete, the R2 listing is complete, no read was left out by the read cap, and no read was blocked by the
run deadline; otherwise it is `PARTIAL` with `partialBecause` naming why, and `outbox/bsd-next-goal-census-latest.json` does not advance.

## Task 1 — build the census and prove it can fail (done in this session)

Files: `scripts/bsd-next-goal-census.mjs`, `scripts/check-bsd-next-goal-census.mjs`, `scripts/check-bsd-next-goal-census-run.mjs`,
`scripts/mutate-bsd-next-goal-census.mjs`, `scripts/fixtures/bsd-next-goal-census-synthetic.mjs`, `.github/workflows/bsd-next-goal-census.yml`,
and one step in `.github/workflows/guards.yml`. It imports four helpers from the probe (`refuseIfTokenInside`, `positiveInt`, `ngRows`,
`fieldLeagueIdsFromSource`); the probe was not modified.

Budget (Rule 78): the vendor is read in pages of 200: a count, 9 pages for 1,744 calls, a closing count — **11 requests** (12 if the ledger grew a page),
hard cap 16 (`CALL_BUDGET`, an integer of 1 or more), against roughly 926 requests a day on the account. A 429 or 401 stops the run before the body is
read, a redirect is an error, a 420-second deadline writes the artifact whatever has happened. The relay's `/bsd/r2/list` and `/bsd/r2/read` read R2
and never call BSD, so the reads (up to `READ_CAP`, default 1,500, six at a time) cost the vendor nothing. No schedule: the ledger is a record, not a
feed, so there is one dispatch.

**Done condition 1 (Rule 89, artifacts):**
`node scripts/check-bsd-next-goal-census.mjs` prints `scenarios 9, assertions 81, failed 0` (and `--self-test` prints `OK: check self-test`);
`node scripts/check-bsd-next-goal-census-run.mjs` prints `scenarios 15, assertions 62, failed 0`;
`node scripts/mutate-bsd-next-goal-census.mjs` prints `mutations 175: caught 175 (census mutants: 116 by the analysis check, 50 by the run check), NOT CAUGHT 0, NOT APPLIED 0`;
`node scripts/workflow-yaml-check.mjs` prints `0 failing`; `bash scripts/absence-collapse-ratchet.sh` ends `ratchet OK`.
The fixtures are synthetic and say nothing about the vendor or about FIELD's captures; the checks prove the counting and the spending, not the data.

The mutation harness was written before the checks were trusted (Rule 90): its first full run left 25 mutants alive and one not applied, and the checks
were extended until every one was killed or shown equivalent (one redundant guard and one vacuous clause were removed from the census).

## Task 2 — dispatch and read the artifact

`bsd-next-goal-census.yml`, `workflow_dispatch`, any time (the ledger is not live). The run commits `outbox/bsd-next-goal-census-<stamp>.json`, and
`-latest.json` only when the verdict is `ANSWERED`.

**Done condition 2:** `outbox/bsd-next-goal-census-latest.json` exists; `bsdCallsMade` is at most 16; `reachedTarget` is true and `analysisError` is null;
`analysis.calls.verdict` is `ANSWERED`. The coverage line, with every denominator, is quoted in Result. If the run is `PARTIAL`, `partialBecause` is the
finding: fix what it names (a ledger that grew, a raised cap) and dispatch again — the same task, not a carry-forward.

## Task 3 — record the result here, in HANDOFF and in the session doc

Quote the coverage line and the counts verbatim in Result below, in the HANDOFF close-out, and in `outbox/cc-session-2026-11-22-bsd-next-goal-census.md`
(Rule 67). Update Status. Then write the second CC-CMD (Rule 87.4): the grading proof in field-laboratory (LAB-FIRST-A), sized by the gradeable count.

## Not in scope

Any `src/` change, route, cron, binding or Durable Object; grading a call (hit against FIELD's goal timeline); any statement about the vendor's accuracy
beyond the probe's recomputation of its own counts; displaying or pushing anything (ADR-002 Rules A and F); changing what the relay captures
(`bsd-live-capture-path` owns that).

## Result

*(pending Task 2)*
