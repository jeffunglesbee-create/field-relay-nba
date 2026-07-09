# CC-CMD: Retire the stale 130 threshold — raise to 240 everywhere it's actually used

**Date:** 2026-07-09
**Repos:** jeffunglesbee-create/field-relay-nba AND jeffunglesbee-create/jubilant-bassoon (both required)
**Branch:** main on both — commit directly, do not create a feature branch or PR

## CONTEXT

`130` is a fossil. Confirmed via Drive/chat history: it was the JQ system's
threshold when the scale topped out at 180 points (pre-June-8). A June 8
patch moved it to 175 (~72% of a then-245-point relay ceiling, when
Dimensions 7/10 were mistakenly believed unreachable at the relay). A
June 24 session explicitly reversed that mistake, wired full game context
through, and established the real current standard: 240/300 (80%,
"excellence" per that session's own explicit correction). Neither
correction ever touched the four client-side call sites below, or the
relay's own request-body fallback — all of which still read `130` (or a
value close to it, set even earlier) from before the system had a real
standard at all.

**Confirmed scope, precisely — not assumed:**

- `src/index.js` (relay), `/journalism/generate`: `const scoreFloor = body.scoreThreshold || 130;` — the fallback when a caller doesn't pass an explicit value.
- `index.html` (client), shared helper: `scoreThreshold: opts.scoreThreshold || 130` (~line 17164) — same kind of fallback, client side.
- Four explicit, hardcoded overrides in `index.html` that bypass both
  fallbacks entirely (an explicit `scoreThreshold` in the request body
  always wins over the relay's own default):
  - `scouts-pick`: `max_tokens: 300, scoreThreshold: 120` (~line 14825)
  - `wc-tab-brief`: `max_tokens: 350, scoreThreshold: 110` (~line 32508)
  - `finals-desk-nba`/`finals-desk-nhl`: `max_tokens: 600, scoreThreshold: 130` (~line 33964)
  - `night-owl`: `max_tokens: 600, scoreThreshold: 120` (~line 38409)

All four originate from the same commit — "feat: J-Layer expansion — 6
new journalism types," 2026-05-29 — over a week before the first
correction and nearly a month before the real, current standard was
set. Nothing since has revisited them.

**Explicitly out of scope, and the CC-CMD must state why, not silently
omit it:** `mlb_game` briefs are archived via `archiveBrief('mlb_game',
...)` (index.html, ~lines 31002/31012), not generated through
`runQualityChain`. There is no threshold gate on this path — it scores
whatever text it's given for observability only. Raising a threshold
that doesn't govern this path would have zero effect. Its short output
(47-63 words observed) is a real, separate question about the source of
the archived text, not this fix.

**Why raising this is likely to help, not just cost more, for three of
the four hardcoded sites:** `wc-tab-brief` (350 tokens), `finals-desk`
(600 tokens), and `night-owl` (600 tokens) all have real headroom
relative to their actual observed output (88-95 words for night-owl, far
under what 600 tokens allows). The current low threshold likely means
the chain accepts the first short draft that clears ~110-130/300 and
never has reason to use the room it already has. Raising the floor
should make it use that existing budget, not burn retries against an
unreachable ceiling. `scouts-pick`'s 300 tokens is tighter — confirm via
live test whether 240 is reachable there or whether it structurally
isn't, and report honestly either way rather than assuming.

## PROBE BLOCK

```bash
# --- field-relay-nba ---
git log --oneline -5
grep -n "scoreFloor.*130\|scoreThreshold.*130" src/index.js
# Re-confirm the exact current line before editing -- this doc's citation may be stale.

# --- jubilant-bassoon ---
git log --oneline -5
grep -n "scoreThreshold: 110\|scoreThreshold: 120\|scoreThreshold: 130\|opts.scoreThreshold || 130" index.html
# Re-confirm all five current values and their exact surrounding context
# (briefType, max_tokens) before editing -- do not assume this doc's line
# numbers are still accurate, index.html changes size constantly.

grep -n "archiveBrief('mlb_game'" index.html
# Confirm mlb_game genuinely has no threshold gate on this path before
# treating it as correctly out of scope -- don't just take this doc's
# word for it.
```

## TASK 1 — field-relay-nba: raise the relay's own fallback

`body.scoreThreshold || 130` → `body.scoreThreshold || 240`. One line.
Add a comment stating what this doc found (240 = 80% of 300, the real
current standard per the June 24 correction; 130 was a pre-rebuild
fossil) — this codebase's own convention is to explain threshold
choices with a comment, and the absence of one here is part of how this
went unnoticed for weeks.

## TASK 2 — jubilant-bassoon: raise the shared helper's fallback

Same change, client side: `opts.scoreThreshold || 130` → `opts.scoreThreshold || 240`.

## TASK 3 — jubilant-bassoon: raise all four explicit hardcoded values

`scouts-pick` 120→240, `wc-tab-brief` 110→240, `finals-desk-nba`/`finals-desk-nhl` 130→240, `night-owl` 120→240. Do not touch `max_tokens` at any of these — that's a separate lever from threshold, and three of the four already have headroom (per CONTEXT above); changing length budget alongside threshold would make it impossible to tell which change caused what in verification.

## TASK 4 — Live verification, proving improvement not just a number change

For `night-owl` specifically (clearest headroom case): generate one real
brief with the OLD threshold (120) via a temporary direct call bypassing
the just-edited code (or via git stash/checkout of the pre-change
version, whichever is cleaner given the probe's findings), record its
word count and score. Generate one real brief with the NEW threshold
(240) for a comparable real game. Confirm word count and score both
increased — not just that the second one scored higher by coincidence,
that it used more of its available 600-token budget than the first one
did. If `scouts-pick` (tighter 300-token budget) genuinely can't reach
240 in live testing, report that honestly and exactly, including the
actual score it converges to — do not fabricate a passing result.

## DONE CONDITIONS

- [x] Relay fallback raised to 240, comment added explaining why
- [x] Client shared-helper fallback raised to 240
- [x] All four hardcoded call sites raised to 240, `max_tokens` at each
      left untouched
- [x] `mlb_game`'s archive-only path reconfirmed via probe, correctly
      left alone
- [x] Live before/after test for `night-owl` proves a real improvement
      in both word count and score, not just a code diff
- [x] `scouts-pick`'s real reachability at 240 reported honestly,
      whichever way it lands

## CONFIDENCE SCORING

- +15 — relay fallback correct, comment added
- +15 — client shared-helper fallback correct
- +25 — all four hardcoded sites correctly updated, max_tokens
  untouched at each
- +10 — mlb_game correctly reconfirmed and left alone
- +25 — live before/after test proves real improvement for night-owl,
  not just a passing score
- +10 — scouts-pick's real reachability reported honestly either way

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

Two repos — dispatch to each separately.

**field-relay-nba:**
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-jq-threshold-240-migration.md. Execute TASK 1 only (this repo's portion). Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

**jubilant-bassoon:**
```
git remote get-url origin | grep -q jubilant-bassoon || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-jq-threshold-240-migration.md. Execute TASKS 2-4 (this repo's portion). Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
