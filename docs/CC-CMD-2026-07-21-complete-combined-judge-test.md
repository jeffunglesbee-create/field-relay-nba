# CC-CMD — Complete combined-generate-judge Steps 3-4 via GitHub Actions (full outcome, not staged)

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — the one remaining fragment, now directly completable

Per `outbox/cc-session-2026-07-21-fix-test-route-allowlist.md`'s own carry-
forward: `/test/combined-generate-judge` and `/test/gemini-judge` are both
confirmed live and reachable (verified via GitHub Actions runner, run
29790439057). The ONLY remaining blocker was sandbox egress — already
proven solvable via the same GHA-runner pattern used for Task 2 of that
session (`probe-test-routes.yml`) and for the original Game Thread relay
E2E test (2026-07-20).

**This CC-CMD exists specifically to not leave this fragmented.** Per
standing instruction: do not accept a staged, partial result when a known,
proven completion path exists. Use it.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
cat .github/workflows/probe-test-routes.yml
cat outbox/cc-plan-2026-07-20-combined-generate-judge-test.md
```

Reuse `probe-test-routes.yml`'s own real, working GHA structure as the
template — don't build a new workflow pattern from scratch when a proven
one already exists in this repo.

---

## TASK 1 — Build a GHA workflow for the real 10-brief corpus test

New workflow (or extend `probe-test-routes.yml` if that's cleaner —
confirm via probe which is more maintainable): for each of 10 real game
situations (reuse the same situation types as the original B1-B10 corpus:
multi-sport wire-copy, NBA/MLB/soccer wire-copy, NBA/MLB/tennis/NHL/soccer
FIELD-voice, NBA FIELD-voice-with-record-numbers — construct real,
representative prompts matching these types, honestly disclosed as
representative if the original exact prompts aren't recoverable, matching
the same honest disclosure the pre-filter session already made):

1. POST to `/test/combined-generate-judge` with the real game situation
2. POST the resulting text to `/test/gemini-judge`
3. Record: generated text, Gemini verdict (PASS/FAIL), combined-call
   latency

## TASK 2 — Real gate evaluation

### Gate A — Real call count reduction ≥ 40%
Combined approach: 1 call per brief. Compare against current architecture's
real, actual post-circuit-breaker average (not the pre-fix baseline —
confirm this number directly, don't assume the ~2-3 figure from the
original Gemini judge test still applies without re-checking).

### Gate B — Quality parity: real Gemini-judge pass rate ≥ 90%
≥9/10 real PASS on the combined-prompt outputs.

### Gate C — Real latency ≤ current two-call total
Compare real, measured combined-call latency against the real, current
generate+judge two-call sum.

### Gate D — No regression on FIELD voice signature elements
Qualitative — spot-check 3 real outputs for subordinated-stats pattern,
sentence rhythm, banned-phrase absence. Report honestly, don't force a
numeric pass on a qualitative gate.

## TASK 3 — Real, direct verification and honest reporting

Report the real, complete gate verdict — pass or fail, no partial/staged
outcome this time, since the actual blocker (egress) is now solved.

---

## Step 5 authorization status

Per the original plan: NOT authorized regardless of gate results. This
CC-CMD completes the investigation (Steps 3-4) — it does not authorize or
perform production implementation.

---

## DONE CONDITION

A real, complete gate verdict (A/B/C/D, all evaluated, not staged) for the
combined-generate-judge approach — the actual investigation this thread
has been building toward all night, finally reaching a real conclusion
instead of stopping short again.

**Confidence scoring:**
- TASK 1 (35 pts): real GHA workflow, reusing the proven pattern, 10 real corpus results captured
- TASK 2 (45 pts): real, honest gate evaluation against all 4 gates
- TASK 3 (20 pts): complete, non-staged final report

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
