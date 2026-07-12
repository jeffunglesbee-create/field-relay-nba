# Claude Code Command — Completion field-parity: backfill vs live-archival, starting with went_to_ot

**Date:** 2026-07-12 (revised same day — TASK 2 strengthened, TASK 4 added)
**Repo:** jeffunglesbee-create/field-relay-nba (sole, except TASK 4 which touches jubilant-bassoon's STANDARDS.md — see that task for repo note)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** src/index.js (TASKS 0-3), STANDARDS.md in jubilant-bassoon (TASK 4 only).

git pull. Read CLAUDE.md and STANDARDS.md Rules 60/76 before touching this file.

Write findings to outbox/cc-completion-field-parity-2026-07-12.md.

## CONTEXT — confirmed this session (chat), re-verify from HEAD before building

Two independent code paths both mark a game "complete," and they write different field sets:

- **Live archival** (~L6117, L6230): sets `went_to_ot: computeWentToOT(gm.league, gm.periodNum)` alongside home_score/away_score at the moment a live-tracked game finishes.
- **Backfill / score-fill** (~L8534-8547, the `UPDATE ... SET home_score = ?, away_score = ?, espn_event_id = COALESCE(...), finalized_at = COALESCE(...)` statements): sets home_score/away_score/espn_event_id/finalized_at — but never touches went_to_ot. Any game whose score arrived via this path keeps whatever went_to_ot was before — almost always NULL.

Downstream, the newspaper bundle endpoint (~L11289) serializes `wentToOT: !!g.went_to_ot` — collapsing NULL (unknown, because backfilled) and 0 (confirmed no-OT) into the identical `false`. Client consumer: index.html ~L22766.

Second known instance of the drama_peak root cause (backfill saga, 7/2-7/8). But the deeper reason this class of bug keeps recurring, quantified directly against smoke.js this session (not theorized): **of 856 total assertions, exactly 1 (A190, SW_VERSION sync) checks a genuine invariant — two independently-writable values that must always agree. Only 2 assertions in the entire file compare two live values to each other at all; only 4 are loop-based (checking a property across many instances rather than one hardcoded fact).** The other ~850+ are one-off point-checks: does string X exist, is function Y defined. That's why `went_to_ot` could silently diverge from `home_score` for as long as it did — nobody had yet written the specific point-check for it, and the first time this exact bug class happened (drama_peak) it generalized into one more point-check for that one field, not into a structural rule. TASK 2 and TASK 4 below fix this properly: an invariant, not one more assertion.

## TASK 0 — Probe: can backfill even compute went_to_ot? Do not assume either way.

```bash
grep -n "computeWentToOT\|periodNum\|score-fill\|scoreFill" src/index.js
grep -rn "periodNum\|linescore\|innings\|period" scripts/*.mjs 2>/dev/null
cat .github/workflows/drama-backfill.yml 2>/dev/null | grep -A3 "script\|run:"
```

Report the finding plainly, then pick exactly one of TASK 1 / TASK 1b based on what's real:
- Period data IS available to the backfill path → TASK 1.
- Period data is NOT available → TASK 1b.

## TASK 1 (only if period data is available) — Extend backfill to compute went_to_ot

Add `went_to_ot` to each backfill UPDATE statement that currently sets home_score, computed via the exact same `computeWentToOT` function live-archival already uses. Use `COALESCE(?, went_to_ot)` semantics so a run still lacking period data for a specific row doesn't overwrite a real value with a guess.

## TASK 1b (only if period data is NOT available) — Make the gap honest instead of silent

At the serialization site (~L11289):

```javascript
wentToOT: g.went_to_ot === null ? null : !!g.went_to_ot,
```

Update the one known client consumer (index.html ~L22766) so `null` is treated the same as `false` for highlight purposes only — but the field itself now honestly reports "unknown," not "confirmed no."

## TASK 2 — Structural invariant (REQUIRED, not a fallback option — this is the actual fix)

Add one shared constant in src/index.js — a single array naming every field "a complete game record" must carry (start from: `home_score`, `away_score`, `went_to_ot`, `finalized_at`, `espn_event_id`). Reference this same list from both the live-archival write and every backfill/score-fill UPDATE.

**Then add a live invariant check, not a point-check:** a smoke/CI assertion (or a dedicated verify endpoint in the same style as `/deploy/verify`) that queries D1 directly and asserts, for every row where `home_score IS NOT NULL`, every field in the completion-field-list is also non-NULL — zero exceptions, checked against real current data, not a hardcoded example. This is not optional or "if achievable" — Rule 90's `post-deploy-live-verify.yml` (queries live state, fails the build if a rule-registry entry is missing) is direct precedent that this shape of check is already working infrastructure in this repo, not something new being invented. Model this task on that same mechanism.

## TASK 3 — Verification

- `node --check src/index.js`
- D1: count rows with `home_score IS NOT NULL AND went_to_ot IS NULL`, before and after.
- curl the bundle endpoint for a real past date with a known backfilled game; confirm `wentToOT` reflects the fix.
- Run smoke. Confirm the new invariant check passes, and separately confirm it correctly FAILS if you temporarily null out `went_to_ot` on one test row (then restore it) — an invariant check that can't be observed failing hasn't been proven to work.
- Write outbox manifest per Rule 87.

## TASK 4 — Propose the general rule (jubilant-bassoon repo — separate commit from TASKS 0-3, per Rule 7 one-concern-per-commit)

`git pull` jubilant-bassoon separately. Check the actual current highest STANDARDS.md rule number at HEAD (do not assume it's 96 — confirm via `grep -oE "^## Rule [0-9]+" STANDARDS.md | grep -oE "[0-9]+" | sort -n | tail -1`), then add the next rule, following the exact format of Rules 89-96:

**Rule N — CI as invariant, not error count (CI-AS-INVARIANT-A).** A test suite that enumerates individually-authored point-checks and reports "X/N failures" only catches bugs someone already thought to write a check for. Quantified directly against smoke.js on 2026-07-12: of 856 total assertions, exactly 1 (A190, SW_VERSION sync) checks a genuine invariant — two independently-writable values that must always agree; only 2 assertions compare two live values to each other at all. The rest are one-off point-checks. This is why `went_to_ot` could silently diverge from `home_score` across two write paths without smoke ever catching it, and why the first instance of this exact bug class (`drama_peak`) generalized into one more point-check instead of a structural rule. Any new assertion protecting a *relationship* between fields or systems (not a single hardcoded value) must be written and reviewed as an invariant — "for every row/instance of category C, does property P hold, checked live" — not as a fact about one instance. Precedent this is achievable today, not aspirational: Rule 90's `post-deploy-live-verify.yml` already works this way.

Commit this as its own single commit, separate from TASKS 0-3's field-relay-nba commit.

## DONE CONDITION

TASK 0's probe genuinely performed and reported either way. Exactly one of TASK 1 / TASK 1b executed. TASK 2's invariant check exists, is verified to actually fail when the invariant is violated (not just verified to pass), not merely "achievable if convenient." TASK 4's rule is added to STANDARDS.md in a separate commit, using the real current next-available rule number, not an assumed one. Zero new `||`/`!!`-style silent coercions introduced anywhere.

**Confidence scoring:**
- TASK 0 probe genuinely run, reported honestly either direction (15 pts)
- Correct TASK (1 or 1b) selected based on the real probe result (10 pts)
- Fix verified via real D1 before/after count (15 pts)
- TASK 2 invariant check built AND proven to fail-on-violation, not just pass (25 pts)
- TASK 4 rule added correctly, real rule number confirmed from HEAD, separate commit (20 pts)
- Zero new fallback-style coercions anywhere in the fix (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.