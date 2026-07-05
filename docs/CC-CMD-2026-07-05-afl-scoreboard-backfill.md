# CC-CMD: Real AFL drama backfill via ESPN scoreboard — different pattern than every other sport

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** `scripts/drama-backfill.mjs` only — add a genuinely different AFL path, replacing the current "confirmed dead" state for this sport.

**Why — real, verified data source, with one critical constraint the design
must account for:** ESPN's AFL `summary?event=ID` path is confirmed dead
(404/400, tested directly). Kali (`kaliaflstats.com`) is confirmed to
provide only final scores and prediction context, no quarter-level data —
tested directly against its `/matches` endpoint, not inferred. **ESPN's
scoreboard endpoint is different and works**:
`https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=2026`
— confirmed live, returns **100 real events for the entire season in one
call**, each with real per-quarter `linescores` (period 1-4) for both
competitors.

**Critical constraint, verified directly — do not assume ID matching
works:** this endpoint's event IDs (e.g. `1133690`) are in a completely
different namespace than the `espn_event_id` values already stored in D1
for AFL rows (e.g. `38494`) — confirmed by direct comparison, `38494` does
not appear anywhere in this endpoint's 100 events. **Matching must happen
by home/away team name + date, not by espn_event_id.** Team names in this
response use full display names (confirmed: "Geelong Cats") which may
differ from D1's stored short form ("Geelong") — reuse whatever team-name
normalization/alias approach already exists elsewhere in this codebase
for AFL (check `soccerLeagueSlug`-adjacent matching logic or the
client's own AFL team handling) rather than inventing a new one; if
none exists, build a minimal alias map from the real names observed,
not a guessed one.

**Target time:** ~35 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=2026" | head -c 2000
grep -n "sport === 'afl'" scripts/drama-backfill.mjs
```
Re-confirm the endpoint still returns the full season and real linescores
before building against it — this doc's snapshot is 2026-07-05, re-verify
rather than trust it blindly, and re-confirm the ID-namespace mismatch
still holds (ESPN could theoretically change ID schemes).

## TASK 1 — Fetch the whole season once, not per-game

Unlike every other sport in this script (which fetches per-`espn_event_id`),
AFL should fetch this ONE scoreboard call once per script run, build an
in-memory index keyed by normalized (home, away, date), and look up each
D1 AFL row against that index — not make 138 individual requests.

## TASK 2 — Convert quarter linescores into a 4-state progression

For each matched event, build a 4-entry state array from cumulative
linescores (Q1, Q1+Q2, Q1+Q2+Q3, Q1+Q2+Q3+Q4 for both home and away),
mapping to the same `{homeScore, awayScore, period, clock}` shape
`dramaScoreLive`'s AFL branch already expects (period = 1,2,3,4; clock
can be a placeholder like '0:00' since the formula's AFL branch uses
`period` and `mins` — check exactly what `mins` needs and supply a
reasonable per-quarter-end value, don't leave it undefined). This is
a coarser reconstruction than MLB/WNBA/soccer's per-play granularity —
that's an accepted, real limitation of this data source, not something
to work around by inventing false precision.

## TASK 3 — Wire into classifySport() / main loop

AFL already classifies correctly (fixed in the prior CC-CMD). Change
only the fetch/lookup mechanism for AFL specifically — it should use
this season-wide index instead of attempting a per-event fetch.

## TASK 4 — Run it, verify real results

Trigger `drama-backfill.yml`. Query D1 directly afterward: report real
before/after counts for AFL specifically, and how many of the 138 rows
matched successfully vs. remained unmatched (team-name mismatches or
dates outside this season's range are legitimate, expected misses —
report the real number, don't force a 100% match rate).

## SCOPE BOUNDARY

DO:
- Fetch the season once, match by team+date, not by espn_event_id
- Reuse existing team-name normalization if it exists; build a minimal
  one from real observed names if it doesn't
- Report real match/no-match counts honestly

DO NOT:
- Attempt to match by espn_event_id for AFL — confirmed incompatible
- Touch MLB, WNBA, EPL, or golf/PGA handling — all separately settled
- Force a match rate by loosening team-name comparison past what's
  actually reliable (e.g. accepting partial substring matches that could
  produce false positives between similarly-named teams)

## DONE CONDITIONS
- [ ] Probe block re-run, endpoint and ID-mismatch re-confirmed
- [ ] Season-wide fetch + team/date matching implemented
- [ ] 4-state progression correctly built from cumulative linescores
- [ ] Workflow run, real before/after AFL counts reported, including honest match/no-match breakdown
- [ ] Outbox manifest written with real evidence

## COMPLIANCE
- Rule 47: uses the already-ported, already-verified AFL formula — no new scoring logic invented
- Rule 68: probe block first, including re-confirming the ID-namespace mismatch
- Rule 87: self-completing — real, achievable within this session

## CONFIDENCE SCORING TABLE
+20  Season fetched once, not per-game
+25  Team+date matching implemented correctly, reusing existing normalization where possible
+25  4-state progression correctly derived from cumulative linescores
+15  Real match/no-match counts reported honestly, not inflated
+15  Workflow run, real before/after D1 counts confirmed

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-afl-scoreboard-backfill.md. AFL's
drama backfill needs a different pattern than every other sport: fetch
https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=2026
ONCE (returns the whole season with real quarter-by-quarter linescores),
then match each D1 AFL row by home/away team name + date -- NOT by
espn_event_id, confirmed incompatible ID namespaces. Build a 4-state
score progression from cumulative linescores and feed it through the
already-ported AFL formula. Run the workflow and report real before/after
counts including honest match/no-match rates. Do not commit unless
confidence ≥ 95. If score < 95 report verbatim and stop.
