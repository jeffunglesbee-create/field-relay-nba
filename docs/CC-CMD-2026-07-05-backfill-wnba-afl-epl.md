# CC-CMD: Extend drama-backfill.mjs — WNBA, AFL, EPL are misclassified as 'other', not unsupported

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** `scripts/drama-backfill.mjs` only. No relay request-serving code touched.

**Why — root cause fully confirmed, not a hypothesis:** `classifySport()`
(line 140) only recognizes `'mlb'` and a soccer substring set (`soccer`,
`world cup`, `wc26`, `fifa`, `mls`, `liga`, `ligue`, `premier`, `league`).
Anything else returns `'other'`, which the main loop (line 216) writes as
`drama_peak = 0` and skips — **before any ESPN fetch is even attempted.**
Confirmed directly against real D1 data: WNBA (raw sport string `"WNBA"`),
AFL (`"AFL"`), and EPL (`"EPL"`) all match none of the substring checks —
`"EPL"` specifically contains none of `premier`/`league`/`soccer` despite
being a real soccer league. This is a classification gap, not an absence
of scoring logic: `dramaScoreLive` in the **client** (`jubilant-bassoon/
index.html`) already has complete, calibrated formulas for both WNBA and
AFL, confirmed via direct read:

```javascript
// WNBA (same calibration as NBA):
base = diff===0 ? 1.0 : diff<=3 ? 0.82 : diff<=7 ? 0.52 : diff<=14 ? 0.22 : 0.05;
let timeBonus = 0;
if (period>4) timeBonus=22;
else if (period>=3 && mins<2) timeBonus=18;
else if (period===4) timeBonus=10;
else if (period===3) timeBonus=5;

// AFL:
base = diff===0 ? 1.0 : diff<6 ? 0.82 : diff<=18 ? 0.60 : diff<=36 ? 0.28 : 0.05;
let timeBonus = 0;
const q = period; // quarter number 1-4
if (q>=4 && mins<5) timeBonus=22;
else if (q>=4) timeBonus=14;
else if (q===3) timeBonus=5;
```

EPL is genuinely a soccer league and should route through the *existing*
soccer formula/fetch path once correctly classified — it needs no new
formula, just correct classification and the right ESPN league slug.

**Real, current numbers this closes (verified via D1, not estimated):**
WNBA 47, AFL 138, EPL 26 — all currently zeroed, all with a real
addressable path once this ships. MLB's 20 zero-rows and golf/PGA's 21
are explicitly out of scope — the former is a separate, already-flagged
open question (cache miss vs. genuinely low-drama), the latter is
correctly unsupported (stroke play doesn't fit this scoring shape).

**Target time:** ~35 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
sed -n '140,155p' scripts/drama-backfill.mjs
sed -n '210,240p' scripts/drama-backfill.mjs
```
Re-confirm this doc's snapshot of `classifySport`/the main loop still
matches — this doc's read was 2026-07-05.

**Real, unresolved uncertainty — do not guess these, verify them live:**
this doc does NOT know the exact ESPN sport/league URL path segments for
WNBA and AFL, or the correct ESPN league slug for EPL specifically (the
existing `soccerLeagueSlug()` defaults everything non-WC/non-MLS to
`'fifa.world'`, which is wrong for EPL). Before writing the fetch
functions, verify the real, working ESPN summary path for each — e.g.
via a live curl against a real, known EPL/WNBA/AFL `espn_event_id`
already in D1 — the same way `fetchMLBHistoricalStates`'s path was
originally confirmed, not assumed from a guessed URL pattern.

## TASK 1 — Fix classifySport() and soccerLeagueSlug()

Add explicit `'wnba'` and `'afl'` classifications (exact string match,
matching the existing `'mlb'` pattern — don't rely on substring matching
for these). Add an EPL case to `soccerLeagueSlug()` returning the
correct real ESPN slug (verify it live first, per the Probe Block note
above — do not assume `'eng.1'` or any other guess without checking).

## TASK 2 — Port the exact WNBA and AFL formulas into dramaScoreLive()

Add `wnba` and `afl` branches to the script's own `dramaScoreLive()`
function, using the exact formulas quoted above verbatim — same
discipline as the existing MLB/soccer ports (Rule 47 compliance: this is
a straight port of already-shipped, already-verified client logic, not
new scoring design).

## TASK 3 — Add fetch functions for WNBA and AFL historical states

WNBA and AFL are not soccer — they need their own historical-state
fetchers analogous to `fetchMLBHistoricalStates`, using the real,
verified ESPN summary path for each sport (confirmed live in the probe
step, not guessed). Map ESPN's actual response shape to the same
`{homeScore, awayScore, period, clock}` shape the scoring function
expects — verify the real shape via a live fetch against a known event,
same as the original MLB implementation did.

## TASK 4 — Run it, verify real results

Trigger `drama-backfill.yml` via `workflow_dispatch`. Re-query D1
directly afterward: report real before/after counts for WNBA, AFL, and
EPL specifically — how many gained a genuine non-zero score vs. how many
still resolved to 0 via a real "no states found" outcome (which is a
legitimate result for some games, not a failure, if ESPN genuinely has
no play-by-play for them).

## SCOPE BOUNDARY

DO:
- Verify real ESPN paths/slugs live before writing fetch code, not guessed
- Port the WNBA/AFL formulas exactly as quoted, no reinterpretation
- Route EPL through the existing soccer path once correctly classified
- Report real before/after counts for all three sports

DO NOT:
- Touch MLB, golf, or PGA Tour handling — out of scope, already correct/settled
- Guess ESPN URL paths or league slugs — verify live
- Modify anything in jubilant-bassoon — this is relay-only, the client's
  dramaScoreLive is the read-only source of truth being ported from, not modified

## DONE CONDITIONS
- [ ] Probe block re-run, current script state confirmed
- [ ] Real ESPN paths/slugs for WNBA, AFL, EPL verified live, not assumed
- [ ] classifySport() and soccerLeagueSlug() updated correctly
- [ ] WNBA/AFL formulas ported exactly, fetch functions added
- [ ] Workflow run, real before/after counts reported for all three sports
- [ ] Outbox manifest written with real evidence

## COMPLIANCE
- Rule 47: straight port of existing, already-verified client scoring logic
- Rule 68: probe block first, including live verification of unknown ESPN paths
- Rule 87: self-completing — real ESPN path verification is achievable within this session

## CONFIDENCE SCORING TABLE
+20  Real ESPN paths/slugs verified live for all three sports, not guessed
+15  classifySport()/soccerLeagueSlug() fixed correctly
+25  WNBA/AFL formulas ported exactly, fetch functions correctly map real ESPN response shape
+20  EPL correctly routes through existing soccer path
+20  Real before/after counts reported for all three sports

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-backfill-wnba-afl-epl.md. Fix
classifySport() to recognize WNBA/AFL/EPL (currently all misclassified
as 'other' and immediately zeroed, confirmed via real D1 data). Port the
exact WNBA/AFL formulas quoted in this doc into the script's
dramaScoreLive(). Before writing fetch code, verify the real ESPN
summary URL paths for WNBA/AFL and the correct league slug for EPL live
— do not guess them. Add WNBA/AFL fetch functions, route EPL through the
existing soccer path. Run the workflow and report real before/after
counts for all three sports. Do not commit unless confidence ≥ 95. If
score < 95 report verbatim and stop.
