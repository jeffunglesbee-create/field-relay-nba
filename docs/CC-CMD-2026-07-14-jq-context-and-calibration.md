# Claude Code Command — Journalism quality: context-completeness audit + brief-type calibration restoration

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/jq-context-and-calibration-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT — two stacked problems, not one, established via a real multi-session investigation tonight

**Empirical baseline, real D1 query, 10-day daily breakdown (2026-07-05 through 2026-07-14):**
```
                  7/5   7/6   7/7   7/8  | 7/9   7/10  7/11  7/12  7/13
game_recap avg:   203   217   218   219  | 214   219   222   216   221
mlb_game avg:     187   187   193   182  | 216   222   233   225   233
night_owl avg:    164   161   152   152  | 173   123   170   170   173
```
`mlb_game` genuinely improved after the 2026-07-09 fixes (46f27f4: retry-budget
starvation; 119d05a: threshold fallback) — average up ~35-40 points, failure
rate down from 100% to 54-79%. `game_recap` never moved, before or after —
214-222 the entire 10-day window. `night_owl` never moved — 100% below 240
every single day, all 10 days.

**Problem 1 (the original hypothesis, still valid): flat 240/300 threshold
doesn't fit different brief-type ceilings.** A more sophisticated version of
this already existed once — `_alertThreshold(brief_type, sport)`
(game_brief=130, night_owl=140, else=170, all against the dead 245-point
ceiling) — built 2026-06-24, lost during the same-day 300-point rebuild,
never restored. `ENRICHMENT_TYPES` (the exclusion-list half) survived;
`_alertThreshold` (the per-type number half) did not — confirmed via direct
grep, zero hits.

**Problem 2 (newly confirmed tonight, not previously known): Dimensions 7+10
(Context Anchoring + Matchup Depth, 55/300 points) are "structurally
unreachable" — the original fix commit's own words — for any generation path
that doesn't forward real `game`/`matchupNote` data into `runQualityChain`.**
The 2026-07-09 fix (917c477, `/journalism/enqueue`) covered the
client-initiated enqueue path — confirmed live in jubilant-bassoon: Scout's
Pick (~L15433) and night-owl's client trigger (~L40608) both correctly send
`home`/`away`/`matchupNote` today. **`game_recap` and `mlb_game` do not use
this path at all** — zero matches for those `briefType` strings anywhere in
jubilant-bassoon's enqueue call sites. They're generated inside
`handleJournalismCycle` (src/index.js, this repo) via a separate,
never-audited-for-this-specific-gap code path. A quick check tonight found
at least one `runQualityChain` call site inside that function
(`briefType='cron-slate'`, ~L6884) with no `game`/`matchupNote` threading at
all — but that's the slate path (deliberately multi-game, `sport: null`),
not `game_recap`/`mlb_game` specifically. The real `game_recap`/`mlb_game`
call site(s) within this same 1,100+-line function have not been located or
checked. This is exactly the shape of gap `game_recap`'s 10-day flatline
would produce: a structural 55-point cap, not a prose-quality problem a
lower threshold alone would fix.

**Why both problems need solving, and in this order:** calibrating a
threshold for a brief-type that's still missing 55/300 points from a context
gap would just be curve-fitting around a bug instead of fixing it. Confirm
and fix context-completeness FIRST (Task 1), THEN calibrate thresholds
against each type's real achievable ceiling once context is genuinely
complete everywhere (Task 2) — not the other way around.

## TASK 0 — Probe

```bash
grep -n "runQualityChain(" src/index.js   # find EVERY call site inside handleJournalismCycle, not just the one this doc already found
grep -n "async function handleJournalismCycle" src/index.js   # confirm current boundaries, will have drifted
grep -n "async function executeGameBriefBackfill" src/index.js   # the backfill path is a SEPARATE question -- check its own runQualityChain call(s) for the same gap, independently
```
For every `runQualityChain` call site found in either function, read the actual `game`/`matchupNote`/`home`/`away` values passed (or not passed) — do not assume from the surrounding code's apparent richness (e.g. `assembleContext` being called nearby does not by itself prove the SAME data reaches `runQualityChain`'s own options object; confirmed as two separate things tonight for the cron-slate site). Specifically identify which call site(s) produce `briefType='game_recap'` and `briefType='mlb_game'` — these are the two types with zero measured improvement across 10 real days and are the actual target of this investigation.

## TASK 1 — Fix context-completeness for game_recap/mlb_game if TASK 0 confirms the gap

If TASK 0 finds the `game_recap`/`mlb_game` call site(s) are missing `game`/`matchupNote` in their `runQualityChain` options — the game object is very likely already available nearby in the same function (this function already builds rich `gameMeta`/context objects for other purposes, confirmed via the `assembleContext` call reviewed tonight) — thread it through, following the exact same "just forward what's already available, no new fetch" pattern the July 9 client-side fix used. If TASK 0 finds context is already correctly present, state that explicitly with the real evidence (do not assume the gap exists just because this doc hypothesizes it) and skip to Task 2 with that finding documented.

Apply the same check to `executeGameBriefBackfill` independently — it is a different code path from the live cron generation, may have the same gap or may not, must be checked and fixed (or confirmed clean) on its own evidence.

## TASK 2 — Restore per-brief-type calibration, scaled to the current 300-point system

Design a `brief_type`-aware (not just `sport`-aware) threshold/alerting layer, extending — not replacing — the existing `loadQualityCalibration()`/`ENRICHMENT_TYPES` machinery. Do not port the old 130/140/170 numbers directly (those were calibrated against the dead 245-point ceiling) — derive real thresholds from the actual current data per type, the same empirical approach the June 24 analysis originally used, re-run against today's real numbers post-Task-1. `wc_matchup` and other genuinely enrichment-only types stay excluded from alerting entirely, matching the existing convention.

## TASK 3 — Verify

- `node --check src/index.js`: clean.
- Real forced-condition test proving Dimensions 7/10 are genuinely reachable at the fixed call site(s) — reuse `runQualityChain`'s existing `opts.breakdown` flag (the same mechanism the July 9 fix used for its own verification) to show the real per-dimension score, not an inferred total-score change.
- Real query against `briefs` for the affected type(s), before/after the fix lands, comparable in shape to the 10-day table above — does `game_recap`/`mlb_game`'s average genuinely move, the same way `mlb_game` moved after the July 9 fix? This is the concrete proof, not an assumption that fixing context automatically improves scores.
- Confirm the new calibration layer correctly reads the post-fix data, not the pre-fix baseline in this doc (which will be stale by the time this runs).

## DONE CONDITION

Every `runQualityChain` call site inside `handleJournalismCycle` and `executeGameBriefBackfill` individually checked for `game`/`matchupNote` completeness, not assumed from surrounding code richness. Any genuine gap found and fixed, verified via real dimension-breakdown proof. Per-brief-type calibration restored and scaled to the real 300-point system, derived from real post-fix data. A real D1 query shows measurable before/after impact for `game_recap`/`mlb_game` if a context gap was found and fixed there.

**Confidence scoring:**
- TASK 0 finds every real `runQualityChain` call site in both functions, does not assume context completeness from nearby code (20 pts)
- TASK 1 either confirms and fixes a real gap with real evidence, or confirms cleanly that no gap exists — either outcome documented honestly, not defaulted (30 pts)
- TASK 2 real, current-data-derived per-brief-type thresholds, not ported stale numbers (25 pts)
- TASK 3 real dimension-breakdown proof and a real before/after D1 comparison, not asserted (25 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
