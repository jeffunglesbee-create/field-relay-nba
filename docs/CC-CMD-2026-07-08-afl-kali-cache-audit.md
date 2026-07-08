# CC-CMD: Independently verify the AFL Kali caching fix (already committed out-of-process)

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT — READ BEFORE STARTING

This is not a new implementation task. Commit `c19009f` already added a
`cf: { cacheTtl: 3600, ... }` block to the Kali predictions fetch inside
`resolveWinProbability`'s AFL branch, matching `buildAFLJournalismContext`'s
proven caching pattern. **That commit was made directly via chat's
bash_tool/GitHub API, bypassing the CC-CMD process** — a real process
violation, not a hypothetical one. This CC-CMD exists to independently
re-verify that change through the correct channel, since chat's own
verification of its own out-of-process work is not independent.

Also present on `main` already, from CC's own prior self-corrections on
this same branch (`f9c379c`, `377b74d`): a widened ESPN date-range window
for `_discoverAFLRound` (today/yesterday was wrong — AFL rounds span
multiple future days), and a 0-100→0-1 scale normalization on Kali's
returned probability (Kali returns a percentage, every other branch in
this file expects a 0-1 fraction — confirmed live, a real response
returned `57.9`, not `0.579`). Both are real, already-verified fixes.
Do not revert or "clean up" either — verify they're still present and
correctly composed with the caching change, per TASK 1.

## PROBE BLOCK

```bash
git log --oneline -8
# Confirm c19009f, 377b74d, f9c379c are all present and in this order.

grep -n "cacheTtl: 3600" src/wp-resolver.js
sed -n '/KALI_BASE}\/predictions/,/^                    });/p' src/wp-resolver.js
# Confirm the cache block is present and syntactically correct.

grep -n "rawProb / 100" src/wp-resolver.js
# Confirm the scale-normalization fix is still present, not clobbered by
# the caching edit (they're in different parts of the same function —
# confirm they didn't collide).

grep -n "rangeStart\|rangeEnd" src/wp-resolver.js
# Confirm the widened date-range fix is still present.

node --check src/wp-resolver.js
# Syntax must be clean after three layered edits from two different
# sources (CC's own self-corrections + chat's out-of-process commit).
```

## TASK 1 — Verify composition, not implement

Confirm via the probe block that all three fixes (date-range widening,
scale normalization, caching) are present, syntactically valid, and
don't conflict with each other. If anything is missing, malformed, or
was accidentally reverted by the out-of-process commit, fix it — but
state explicitly in the outbox that this was a repair of chat's error,
not new design work.

## TASK 2 — Live E2E re-verification (Rule 87 — do not skip because it "should" already work)

Run a real `pick_made`/`pick_resolved` round-trip against a real, current
AFL fixture (re-probe for whatever's live/near-term at execution time —
do not reuse this doc's Fremantle/Sydney example if it's stale by then).
Confirm:
- A real, non-null probability is returned
- `source` is `kali` or `squiggle`
- The returned `probability` is a plausible 0-1 value (e.g. `0.579`, not
  `57.9`) — this specific check exists because chat's own prior claim of
  "verified working" missed exactly this defect once already; do not
  repeat that mistake by skipping the sanity check on the value's scale.

## TASK 3 — Confirm cache is actually being hit, not just present in code

The caching directive was added but never live-tested for actual
cache-hit behavior (stated honestly in the code comment — chat did not
verify this, only that the syntax matches the proven pattern). Use the
same methodology as the CFL cache-guard precedent
(`docs/CC-CMD-2026-07-05-cfl-scoreboard-cache-guard.md` if still
readable, or `CF-Cache-Status`/equivalent header inspection): make two
requests that should hit the same Kali cache key within the TTL window
and confirm the second is served from cache, not a fresh upstream call.

## DONE CONDITIONS

- [x] Probe block confirms all three fixes present and composed correctly
- [x] `node --check` clean
- [x] Live E2E test returns a real probability, correct 0-1 scale,
      re-verified against a current (not stale) fixture
- [x] Cache-hit behavior actually demonstrated, not just asserted from
      code presence
- [x] Outbox explicitly states this was independent re-verification of
      an out-of-process chat commit, not new implementation

## CONFIDENCE SCORING

- +25 — all three fixes confirmed present and correctly composed
- +25 — live E2E test passes with correct 0-1-scale probability, fresh fixture
- +30 — cache-hit behavior actually demonstrated (not assumed from syntax)
- +20 — outbox honestly frames this as audit of chat's process violation

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-afl-kali-cache-audit.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
