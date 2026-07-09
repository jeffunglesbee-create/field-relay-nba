# CC-CMD: Commit the threshold fix, then fix the real bottleneck — enqueue never captures game/matchupNote

**Date:** 2026-07-09
**Repos:** jeffunglesbee-create/jubilant-bassoon AND jeffunglesbee-create/field-relay-nba (both required)
**Branch:** main on both — commit directly, do not create a feature branch or PR

## CONTEXT

Previous session (CC-CMD-2026-07-09-jq-threshold-240-migration, jubilant-
bassoon TASKS 2-4) correctly implemented the threshold change — verified
via smoke.js 890/0, exact diff match to spec — but honestly reported
Task 4 as unmet (60/85, held per the standing 95-gate instruction rather
than committed): two real live A/B tests against night-owl showed no
improvement from raising 120→240 (one tied exactly, one scored *lower*
with the new threshold). That uncommitted work is correct and should
ship; it was never the problem.

**Root cause, found this session by tracing the actual pipe end to
end, not re-testing the same lever again:** `night-owl` and
`scouts-pick` both POST to `JOURNALISM_ENQUEUE_RELAY`
(`/journalism/enqueue`), not the synchronous `/journalism/generate`
endpoint. Confirmed via direct read of both ends:

- `/journalism/enqueue`'s handler (`src/index.js`, relay) stores exactly
  `{jobId, prompt, sport, briefType, max_tokens, scoreThreshold,
  enqueuedAt}` into the queue message — no `home`, `away`, `homeScore`,
  `awayScore`, or `matchupNote`, ever, for any job on this path.
- The queue consumer that later processes the job reads `job.home`/
  `job.away`/`job.homeScore`/`job.awayScore` to build `game`, and
  `job.matchupNote` directly — both unconditionally `null` for every
  job from this enqueue path, since those fields were never stored.

Effect: Context Anchoring (25 pts) and Matchup Depth (30 pts) — 55 of
300 — are structurally unreachable for every brief on this path,
regardless of prose quality or requested threshold. The real ceiling
has been ~245, not 300. Neither the old 120 nor the new 240 threshold
ever accounted for this; both were tuning a number against a ceiling
that was never actually 300. This is the real explanation for the flat
A/B result, confirmed by tracing the actual data flow, not by re-running
the same test with different inputs.

**Scope discipline:** this does not touch `getQualityTarget()`
(confirmed real, well-built, but genuinely unused anywhere — zero call
sites found via grep). That's a separate, standalone finding — a
built-but-disconnected calibration system — not something this CC-CMD
activates or removes. Note its existence and dead-code status in the
outbox; do not wire it in speculatively as part of this fix.

## PROBE BLOCK

```bash
# --- jubilant-bassoon ---
git log --oneline -5
git status
# Confirm the uncommitted Task 2/3 changes from the prior session are
# still present in the working tree exactly as that session left them.

grep -n "briefType: 'night-owl'" index.html
grep -n "briefType: 'scouts-pick'" index.html
# Re-confirm both call sites and what game/matchup data is genuinely
# available locally at each point (game._sport is referenced already —
# confirm what else on that object is accessible: home/away names,
# scores, any equivalent to a matchup note) before assuming what can be
# added to the enqueue payload.

# --- field-relay-nba ---
git log --oneline -5
grep -n "'/journalism/enqueue'" -A25 src/index.js
grep -n "job.home\|job.away\|job.matchupNote" src/index.js
# Re-confirm both ends of the pipe exactly as this doc found them —
# don't assume the citations above are still accurate.
```

## TASK 1 — jubilant-bassoon: commit the already-correct threshold work

Commit the existing, verified, uncommitted Task 2/3 changes from the
prior session's working tree exactly as they are — the shared-helper
fallback and four hardcoded thresholds raised to 240. Do not re-derive
or re-edit; that work is already correct, confirmed via smoke.js 890/0
and exact-match probe citations. If the working tree does not have
these changes for any reason (re-confirm via probe, don't assume),
re-apply them per CC-CMD-2026-07-09-jq-threshold-240-migration's
original TASKS 2-3 spec before proceeding.

## TASK 2 — jubilant-bassoon: send game/matchup data at enqueue time

For `night-owl` and `scouts-pick` specifically (the two confirmed
affected call sites): add `home`, `away`, `homeScore`, `awayScore` (from
whatever the locally-available `game`/`g` object actually exposes — per
probe findings, not assumed) and a `matchupNote` string (constructed
from whatever context is already being used to build the prompt text
for that brief — reuse existing local data, don't fetch anything new)
to the JSON body already being sent to `JOURNALISM_ENQUEUE_RELAY`.

## TASK 3 — field-relay-nba: store and forward the new fields

In `/journalism/enqueue`'s handler, add `home: body.home || null, away:
body.away || null, homeScore: body.homeScore ?? null, awayScore:
body.awayScore ?? null, matchupNote: body.matchupNote || null` to the
object passed to `env.JOURNALISM_QUEUE.send(...)`. The consumer already
reads these field names correctly (confirmed via probe) — this is
purely closing the gap where they were dropped at write time, not a
consumer-side change.

## TASK 4 — Live verification: prove the real ceiling actually opens up

Repeat the exact same A/B methodology the prior session used (real
POSTs to the actual deployed relay via `JOURNALISM_ENQUEUE_RELAY`, not
simulated) for night-owl, using a real current game. This time, confirm
via the completed job's result that `game`/`matchupNote` are non-null
in what the consumer receives (may require a temporary diagnostic log,
cleaned up after, matching this session's own established pattern for
this) — the deliverable is proof that Context Anchoring and Matchup
Depth are now actually scoreable, not just that word count changed.
Report the resulting score honestly, whatever it is — this task's job
is to prove the ceiling opened, not to prove 240 is now reached.

## DONE CONDITIONS

- [x] Prior session's correct threshold work committed, not re-derived
- [x] `night-owl`/`scouts-pick` send real game/matchupNote data at enqueue
- [x] `/journalism/enqueue` stores and forwards the new fields, consumer
      untouched (it already reads them correctly)
- [x] Live test proves `game`/`matchupNote` are non-null downstream —
      the actual mechanism fixed, not inferred from a score change alone
- [x] `getQualityTarget()`'s dead-code status noted in the outbox,
      explicitly not activated as part of this fix

## CONFIDENCE SCORING

- +15 — prior correct work committed cleanly, verified unchanged
- +20 — client sends real game/matchupNote data at both call sites
- +25 — relay correctly stores and forwards both new fields
- +30 — live test proves game/matchupNote are genuinely non-null
  downstream, not inferred
- +10 — `getQualityTarget()` correctly left alone, noted not activated

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

Two repos — dispatch to each separately.

**jubilant-bassoon:**
```
git remote get-url origin | grep -q jubilant-bassoon || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-enqueue-context-gap.md. Execute TASKS 1-2 (this repo's portion). Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

**field-relay-nba:**
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-enqueue-context-gap.md. Execute TASKS 3-4 (this repo's portion). Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
