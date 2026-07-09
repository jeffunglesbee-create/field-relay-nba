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

**Correction to this doc's own prior draft, found before dispatch —
read carefully:** an earlier version of this investigation checked
`field-relay-nba` for `getQualityTarget(` call sites, found zero, and
concluded it was dead code. That was wrong — it only checked one of the
two repos. A **different, genuinely active** `getQualityTarget(sport)`
exists client-side (`jubilant-bassoon/index.html:25452`), reading
`field_jq_scores` from `localStorage`, called at two real sites
(`index.html:27789`, inside `j2-series`'s prompt build, and
`index.html:39056`, inside `night-owl`'s), guarded by smoke assertions
A349/A350. It is a **third fossil from the pre-300-point-scale era**,
distinct from both the relay's `130` default (fixed 2026-07-09 morning)
and the relay's dead calibration function (still genuinely unused,
that part of the original finding stands). Its returned string is
embedded directly into the generation prompt itself:

```javascript
lines.push(`- QUALITY TARGET: recent ${labelStr} briefs averaged score ${Math.round(avgScore)}/180. Target ≥ 145 — add more specific facts...`);
```

`/180` — a scale that stopped existing weeks ago. This means every
`night-owl` and `j2-series` brief has been explicitly instructed, in
its own prompt, to aim for "≥145" against an obsolete ceiling —
independent of whatever `scoreThreshold` governs the retry gate
afterward. The observed live scores (130, 141, 137) cluster tightly
around this stale instruction — tighter than around either
`scoreThreshold` value tested — making this a strong, possibly
dominant, independent contributor to the flat A/B result, not just the
enqueue/game-data gap alone. Both are real; neither alone may fully
explain the observed plateau; fix both, verify together.

**Scope discipline, revised:** the relay-side `getQualityTarget()`
(field-relay-nba) is confirmed genuinely unused there — that finding
stands, do not activate it speculatively. The **client-side**
`getQualityTarget()` is a different function entirely and is in scope
for TASK 5 below.

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

## TASK 5 — jubilant-bassoon: fix the stale /180 scale in getQualityTarget()

Re-probe `getQualityTarget()` at its current line before editing — this
doc's line citation may already be stale. Update the scale reference
from `/180` to `/300`, and reconsider the `avgScore < 130` / `Target ≥
145` thresholds against the current 240 standard rather than assuming
the same relative gap still makes sense (145/180 ≈ 81%; the equivalent
on a 300 scale would be ~242, i.e. approximately the same 240 this whole
CC-CMD is built around — confirm this arithmetic against the real
`W.spec`/etc. weight constants in `journalism-quality.js` rather than
trusting this doc's own quick estimate). Do not touch the
`field_jq_scores` localStorage read itself, or the sport-tag matching
logic — both are unrelated to the scale question and out of scope here.
If `field_jq_scores` itself was populated under the old 180-point scale
historically (check the data shape/values actually stored, don't
assume), state that explicitly in the outbox — stale historical data
feeding a now-corrected formula is a different, real problem from the
formula being wrong, and conflating them would hide one or the other.

## TASK 4 — Live verification: prove the real ceiling actually opens up

Repeat the exact same A/B methodology the prior session used (real
POSTs to the actual deployed relay via `JOURNALISM_ENQUEUE_RELAY`, not
simulated) for night-owl, using a real current game — this time with
BOTH fixes live (TASK 2/3's game/matchupNote threading AND TASK 5's
corrected quality-target scale). Confirm via the completed job's result
that `game`/`matchupNote` are non-null in what the consumer receives
(may require a temporary diagnostic log, cleaned up after) — the
deliverable is proof that Context Anchoring and Matchup Depth are now
actually scoreable, not just that word count changed. Separately
confirm the prompt actually sent to the model no longer contains a
"/180" reference (re-derive the prompt text the same way the real code
does, don't assume TASK 5's edit propagated correctly without checking).
Report the resulting score honestly, whatever it is — this task's job
is to prove both ceilings opened, not to prove 240 is now reached. If
time allows, running the two fixes' live-test isolated (game/matchupNote
alone, then quality-target scale alone) before combining them would
show which contributed how much — valuable but not required for DONE.

## DONE CONDITIONS

- [x] Prior session's correct threshold work committed, not re-derived
- [x] `night-owl`/`scouts-pick` send real game/matchupNote data at enqueue
- [x] `/journalism/enqueue` stores and forwards the new fields, consumer
      untouched (it already reads them correctly)
- [x] Client-side `getQualityTarget()`'s stale `/180` reference corrected
      to the current 300-point scale, with honest arithmetic shown
- [x] Live test proves `game`/`matchupNote` are non-null downstream AND
      the prompt no longer contains a stale scale reference — the actual
      mechanisms fixed, not inferred from a score change alone
- [x] Relay-side `getQualityTarget()`'s dead-code status (confirmed,
      separate function) noted in the outbox, correctly left alone

## CONFIDENCE SCORING

- +10 — prior correct threshold work committed cleanly, verified unchanged
- +15 — client sends real game/matchupNote data at both call sites
- +20 — relay correctly stores and forwards both new fields
- +15 — client-side getQualityTarget's scale correctly updated, honest
  arithmetic shown, field_jq_scores data-shape question addressed
- +30 — live test proves both fixes are genuinely active downstream
  (non-null game/matchupNote AND no stale scale reference in the
  prompt), not inferred from a score change alone
- +10 — relay-side getQualityTarget correctly left alone, noted as a
  separate, distinct function from the client-side one

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
