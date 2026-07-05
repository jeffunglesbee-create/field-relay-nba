# CC-CMD: First-ever Container on this account — sustained drama_peak backfill

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole — new Container-enabled Worker, new file(s))
**Branch:** main
**Scope:** New Container-backed one-shot backfill job. Zero changes to existing client or relay request-serving code.

**Why — real, re-verified gap, not stale:** re-queried D1 directly before writing this
doc: `regular_season_games` has 587 rows since 2026-06-01, **0 with `drama_peak`
populated** (was 568/0 earlier this session — gap has grown, not shrunk). Root
cause, confirmed in source: `runDramaBackfillDiscovery()` (index.html ~34232) is
client-initiated, fires on page load, calls the relay's
`/archive/drama-missing?limit=20` endpoint, hard-capped at 20 games per call,
fire-and-forget. It only progresses when a real browser session happens to run
it — there is no server-side, sustained process. Containers (confirmed today:
Workers Paid active, Containers available and enabled, zero deployed) remove
the per-session/per-request time limit that necessitated the cap in the first
place.

**This is a genuinely novel task for this account — no prior Container has
ever been built or deployed here.** Treat the deployment mechanics themselves
as unproven, not assumed to work.

**Target time:** ~50 min (includes real capability verification, not just the backfill logic)

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress — CI-as-proxy for any live relay check
- Playwright tests must run via GitHub Actions CI — never localhost
- api.github.com is reachable from CC bash
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail
- **New, specific to this CC-CMD**: do not assume your own sandboxed environment
  can build/push a Docker image. If `docker build` or equivalent is unavailable
  in your execution environment, STOP at Task 1 and report that plainly — do
  not attempt a workaround or partial substitute. This is a real, first-time
  capability question, not a formality.

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95. Given this is genuinely new territory,
a lower score with an honest, specific blocker description is a fully
acceptable outcome — do not stretch to hit the gate.

## PROBE BLOCK (run before any design decisions)
```bash
docker info 2>&1 | head -5 || echo "NO DOCKER DAEMON RUNNING"
cat wrangler.toml
grep -n "archive/drama-missing\|_backfillOneDramaGame\|fetchMLBHistoricalStates\|fetchSoccerHistoricalStates" src/*.js
```
Also re-confirm the real current gap via D1 directly
(`SELECT COUNT(*), SUM(CASE WHEN drama_peak IS NOT NULL THEN 1 ELSE 0 END) FROM
regular_season_games WHERE date >= '2026-06-01'`) — this doc's snapshot (587
total, 0 populated) may have drifted since 2026-07-04.

## TASK 1 — Capability check (do this before anything else)

Confirm Docker (or Cloudflare's remote build path, if your environment
supports `wrangler deploy` triggering a remote build without local Docker —
check current Wrangler docs for this) is actually usable from within your
execution environment. If neither is available, STOP HERE. Write the outbox
manifest reporting exactly this, with the precise error/absence observed, and
do not proceed to Task 2. This is not a failure of the CC-CMD — an honest
"cannot verify Container build capability in this environment" is the
correct, complete outcome if that's what's true.

## TASK 2 — Reuse existing scoring logic; do not reimplement it

The scoring logic for both sports already exists and was verified working
earlier this session (`fetchMLBHistoricalStates`, `fetchSoccerHistoricalStates`,
including the TASK 1-4 soccer fixes from
`CC-CMD-2026-07-04-soccer-drama-scoring-fix.md` — extra-time bonus, upset
bonus via Parse.bot FIFA data, etc.). These currently live in `index.html`
(client-side). Two real options, pick based on what Task 1's probe reveals
about the actual code structure — do not assume which is correct without
checking:
(a) If this logic has an existing or easily-extracted relay-side equivalent,
    the Container should call relay endpoints to do the actual scoring
    (preferred — avoids porting client JS into a new runtime).
(b) If the scoring logic is genuinely client-only with no relay equivalent,
    the Container will need its own implementation of the same scoring rules
    — in which case, port them exactly as they exist today (same thresholds,
    same FIFA-alias handling, same extra-time tiers), not a reinterpretation.
Confirm which path is real via the probe block before choosing.

## TASK 3 — The sustained backfill job itself

Inside the Container: loop calling `/archive/drama-missing?limit=20`
(or a bulk equivalent if one is easier to add — your call, state which you
chose and why) repeatedly until it returns zero games, writing `drama_peak`/
`drama_arc` back via the same write path `_backfillOneDramaGame` already
uses. Log real progress (games processed, running total) so a partial run is
diagnosable. This is a one-shot batch job — it does not need to be
re-triggerable via a public endpoint or scheduled; running it once to
completion via `wrangler containers` (or equivalent) satisfies this task.

## TASK 4 — Verify real completion

After the job runs, re-query D1 directly (same query as the probe block) and
confirm `populated` now equals (or is very close to) `total` for games since
2026-06-01. Report the real before/after numbers — do not report success
without this specific number.

## SCOPE BOUNDARY

DO:
- Verify Container build capability first, honestly (Task 1)
- Reuse existing scoring logic rather than reinventing it (Task 2)
- Run the backfill to real, verified completion (Tasks 3-4)
- Report real before/after D1 counts

DO NOT:
- Touch any existing request-serving code path (client or relay) — this is an
  isolated, one-shot batch job, not a feature change
- Reinterpret or "improve" the existing scoring thresholds while porting them
  — exact parity with what's already shipped and verified, not a redesign
- Set up a recurring/scheduled Container job — out of scope, one-shot only
- Proceed past Task 1 if Container build capability isn't actually available

## DONE CONDITIONS
- [ ] Probe block run, capability and current gap both re-confirmed fresh
- [ ] Task 1's capability check completed and reported honestly, whichever way it goes
- [ ] If capable: Task 2's path (a or b) chosen and justified, not assumed
- [ ] If capable: backfill run to real completion, verified via direct D1 re-query
- [ ] Outbox manifest written to `docs/outbox/cc-container-drama-backfill-{date}.md` with real before/after D1 numbers, or the precise capability blocker if Task 1 stopped early

## COMPLIANCE
- Rule 68: probe block first, including re-confirming the gap hasn't already changed
- Rule 87: self-completing — either the backfill completes and is verified, or Task 1 produces a clean, complete, honest stop — no partial/ambiguous middle state

## CONFIDENCE SCORING TABLE
+20  Task 1 capability check performed honestly, not assumed either way
+20  Correct path (2a or 2b) identified via real code inspection, not guessed
+35  Backfill actually completes, verified via real before/after D1 query
+25  Existing scoring logic preserved exactly, not reinterpreted

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-container-drama-backfill.md. Run the
probe block first, including re-confirming the real current D1 gap. Check
Container/Docker build capability honestly before anything else — if
unavailable, stop and report that plainly, do not attempt a workaround.
If capable, reuse the existing scoring logic (don't reinvent it), run the
backfill to real completion, and verify via a direct D1 re-query showing the
real before/after populated count. Do not commit unless confidence ≥ 95 —
an honest low score explaining a genuine capability blocker is a fully
acceptable outcome here. If score < 95 report verbatim and stop.
