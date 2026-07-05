# CC-CMD: Drama backfill v2 — all three blockers resolved, exact formulas supplied

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Supersedes:** `CC-CMD-2026-07-04-container-drama-backfill.md` — that attempt correctly, honestly stopped at 40/100 after hitting three real, probed blockers. All three are resolved below with verified specifics, not assumptions.

## Blocker 1 resolved — route through GitHub Actions, not 202 individual CI-proxy round-trips

Your sandbox's `site.api.espn.com` 403 and the "202 individual calls isn't a sustained batch job" problem are both solved the same way: **do the entire backfill inside a single GitHub Actions job**, not from your own sandboxed bash. A GitHub Actions runner has no `*.workers.dev`/ESPN egress restriction and no per-call round-trip overhead — it can loop through all 202 games directly, calling the relay's own already-working `/espn-summary` proxy route from inside one long-running job.

## Blocker 2 resolved — `CLOUDFLARE_API_TOKEN` already exists as a working GitHub secret

Confirmed directly: `deploy.yml` in this repo already uses `secrets.CLOUDFLARE_API_TOKEN` and `secrets.CLOUDFLARE_ACCOUNT_ID` successfully, on every relay deploy. You do not need `CF_API_TOKEN` set in your own environment — write a new workflow file that uses these same existing secrets, dispatched via `workflow_dispatch` (the established pattern this whole project uses for anything requiring real Cloudflare API access from CI). Do not attempt to set or request a new token; the existing one is already scoped correctly for this account's Workers.

## Blocker 3 resolved — exact formulas, read directly from source, not approximated

Your cross-repo read tool returned `total_lines:1` for `jubilant-bassoon/index.html` — a real tool malfunction on that large file, not a reason to approximate. Read directly from this repo's own copy instead. The exact, complete, current implementation (verified 2026-07-04, copied character-for-character, not reconstructed from memory):

```javascript
// MLB base (from dramaScoreLive):
base = diff===0 ? 1.0 : diff===1 ? 0.85 : diff===2 ? 0.55 : diff<=4 ? 0.28 : 0.08;

// MLB timeBonus:
let timeBonus = 0;
if (period>=10) timeBonus=22;      // extra innings
else if (period>=9) timeBonus=16;
else if (period>=7) timeBonus=7;

// Soccer base:
base = diff===0 ? 1.0 : diff===1 ? 0.72 : diff===2 ? 0.32 : 0.06;

// Soccer timeBonus (minNum = parseInt(clock)||0):
let timeBonus = 0;
if (period>=3) timeBonus=24;          // extra time incl. shootout
else if (minNum>=90) timeBonus=18;    // stoppage time
else if (minNum>=80) timeBonus=10;
else if (minNum>=70) timeBonus=5;

// MLB sitBonus (applyQW1SituationBonus, baseball branch):
// isFinalPeriod for MLB = period >= 9
const runners = [onFirst, onSecond, onThird].filter(Boolean).length;
const risp = onSecond || onThird;
let sitBonus = 0;
if (runners===3 && outs===2) sitBonus += isFinalPeriod ? 20 : 12;
else if (runners===3) sitBonus += isFinalPeriod ? 15 : 8;
else if (risp && outs===2) sitBonus += isFinalPeriod ? 10 : 6;
if (balls===3 && strikes===2 && risp) sitBonus += 8;
if (outs===2 && period>=7) sitBonus += 5;

// Soccer sitBonus (applyQW1SituationBonus, soccer branch):
let sitBonus = 0;
if ((clock||'').includes('+')) sitBonus += 8;  // stoppage time marker
// NOTE: the WC advancement-stake bonus (_wcAdvProb/_wcOpeningAdvProb) is
// a LIVE-game-only signal populated by fetchWCLiveGames() during real-time
// play. It does not exist for historical reconstruction — omit this part
// of sitBonus entirely for backfilled games, do not attempt to
// reconstruct it. This is a real, accepted scope boundary, not an
// oversight — confirm this reasoning holds by checking whether the
// discovery endpoint's game payload includes any equivalent field before
// assuming it's unavailable.

// Soccer upsetBonus (already known from CC-CMD-2026-07-04-soccer-drama-scoring-fix):
let upsetBonus = 0;
const rankGap = Math.abs(homeRank - awayRank); // via /fifa-rankings/{team}
if (rankGap >= 30 && diff <= 1) {
    upsetBonus = Math.min(15, Math.floor(rankGap / 10));
}

// Final composite (identical for both sports):
const raw = base*52 + timeBonus + sitBonus + upsetBonus;
```

**Rule 47 (RUWT compliance) is preserved by construction here** — this is a straight, unmodified port of already-shipped, already-verified logic into a new execution context, not new scoring logic. No relay-side scoring existed before and none is being invented beyond this exact port.

**Target time:** ~45 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress — irrelevant to this v2 approach, the new GitHub Actions job does the real work
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
docker info 2>&1 | head -5
cat .github/workflows/deploy.yml | grep -A2 "CLOUDFLARE_API_TOKEN" | head -6
```
Re-confirm the secret is still present and the deploy pattern hasn't changed since 2026-07-04.

## TASK 1 — New GitHub Actions workflow, not a local Container attempt

Write `.github/workflows/drama-backfill.yml`, `workflow_dispatch`-triggered, using `secrets.CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` the same way `deploy.yml` does. Inside the job: loop calling `/archive/drama-missing?limit=20` repeatedly until empty (same discovery endpoint the original client-side function used), for each game call the relay's existing `/espn-summary` route to reconstruct historical states (MLB: `plays[]`; soccer: `keyEvents[]`, including the 5-minute interpolation between events — port that logic too, it's part of the same original function), compute the score using the exact formulas above, write `drama_peak`/`drama_arc` back to D1.

## TASK 2 — Run it, verify real completion

Trigger the workflow via `workflow_dispatch` (same API pattern used for every other manual trigger this session). Let it run to completion. Re-query D1 directly and report real before/after `populated` counts for games since 2026-06-01.

## SCOPE BOUNDARY

DO:
- Build this as a GitHub Actions workflow, not a persistent deployed Container
- Port the exact formulas above verbatim
- Explicitly omit the WC-advancement sitBonus component for historical games, as specified
- Verify real completion via direct D1 re-query

DO NOT:
- Attempt to deploy a long-running Container Worker for this — a one-shot GitHub Actions job is simpler, uses already-working credentials, and has no provisioning delay
- Modify any live-serving code path
- Invent or approximate any formula component — everything needed is supplied above verbatim

## DONE CONDITIONS
- [ ] Probe block confirms Docker availability and the existing CLOUDFLARE_API_TOKEN secret
- [ ] Workflow written, uses existing secrets correctly
- [ ] Formulas ported exactly as specified, WC-advancement bonus correctly omitted for historical games
- [ ] Workflow run to real completion
- [ ] D1 re-queried directly, real before/after populated counts reported
- [ ] Outbox manifest written with the real numbers

## COMPLIANCE
- Rule 47: straight port of existing, already-verified scoring logic — no new scoring invented
- Rule 68: probe block first
- Rule 87: self-completing — this path has no unresolved capability blockers

## CONFIDENCE SCORING TABLE
+20  Workflow correctly uses existing CLOUDFLARE_API_TOKEN secret
+30  Formulas ported exactly, WC-advancement component correctly omitted
+30  Workflow runs to real completion
+20  Real before/after D1 numbers reported

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-container-drama-backfill-v2.md. This
supersedes the prior attempt — all three of its blockers are resolved in
this doc with verified specifics (existing CLOUDFLARE_API_TOKEN secret,
exact formulas copied from source, GitHub Actions instead of a persistent
Container). Write the workflow, run it, verify real before/after D1 counts.
Do not commit unless confidence ≥ 95. If score < 95 report verbatim and stop.
