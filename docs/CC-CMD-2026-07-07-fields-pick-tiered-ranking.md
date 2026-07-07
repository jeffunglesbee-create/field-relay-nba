# CC-CMD: Field's Pick ranked list — stakes-tier first, relay-native, minimal client work

**Date:** 2026-07-07 (v2 — supersedes `CC-CMD-2026-07-07-fields-pick-ranked-list.md`,
never executed)
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## WHY THIS SUPERSEDES v1

v1 sorted candidates by raw `scoreCandidatePick()` value alone — legally
clean, but product-generic: any sports scoreboard app sorts by
closeness. FIELD's own existing product identity (`fieldGameTier()`,
client-side, 9-level stakes hierarchy: FINALS → ELIMINATION → CRUNCH →
EXTRA_TIME → CLOSE_LATE → PLAYOFF_SERIES → MARQUEE_NATIONAL → LIVE →
UPCOMING) already encodes the belief that stakes matter more than raw
statistical closeness. Ranking by score alone throws that belief away.

**Explicit direction from this session: push the tier-ordering work to
the relay, keep client work to the minimum required for RUWT
compliance.** That minimum is narrower than it might sound — under the
corrected ADR-002 reading (Rules A/B/C/E, commit `01b18e6`), the relay
computing and serving a full stakes-ordered list on pull is fully
permitted. The one thing that stays real regardless of location is the
**raw-number-display prohibition** (`ADR-002-CONTEXT.md`, "What is
PROHIBITED" #3-4 — explicitly preserved, untouched by anything this
session changed). So the client's only required job is: never render a
raw score to the user. It does not need to compute, sort, or re-tier
anything — the relay ships an already-correctly-ordered list.

## THE DESIGN, REUSING EXISTING SIGNALS, NOT INVENTING NEW ONES

A full port of client-side `fieldGameTier()` to the relay would create
a second, parallel tier system — the exact drift risk that already bit
this project once (`normAFL`/`WC_NAME_FIX`/`FIFA_NAME_ALIASES`, three
independent duplicates of one canonical system, consolidated only after
real breakage). Instead: a narrow, purpose-built 3-tier ordering, built
entirely from data the relay already has, used only for this feature's
sort order — not a general-purpose tier system, not a client mirror.

**Tier 0 (highest):** `postseason_games.round` indicates the final or
an elimination round for that competition (reuse whatever the archive
already stores in `round` — do not invent new categorization on top of
it; if `round`'s existing values don't cleanly signal "elimination,"
report that honestly in the outbox rather than guessing at a string
match).

**Tier 1:** `went_to_ot = 1` (real, stored, immutable-by-construction as
of this session's earlier guard), OR the existing `latePhase &&
closeGame` gate (below) evaluates true for that game right now.

**Tier 2:** everything else.

**Within a tier, `scoreCandidatePick()`'s existing score is still the
tiebreaker** — this doesn't discard the existing scoring, it subordinates
it to stakes.

## TASK 1 — Hoist `SPORT_CONFIG` to a shared, exported constant

Currently a local `const` inside the push-heartbeat handler
(`src/index.js:~3935`), covering NBA/NHL/MLB/NFL/MLS/EPL only. Move it
to module scope, exported, so both the existing push gate and this new
Phase 9 logic import the same single source of truth — zero risk of the
two drifting apart the way the three name-normalization systems did.

**Extend it with two entries, explicitly reusing existing numbers, not
inventing new ones** — disclose this plainly in the outbox:
```javascript
{sport:'WNBA', path:'basketball/wnba', minPeriod:3, maxMargin:10}, // reuses NBA's exact thresholds — same period structure
{sport:'WC26', path:'soccer/fifa.world', minPeriod:2, maxMargin:2}, // reuses EPL's exact thresholds — same soccer structure
```
Confirm the real ESPN path segment for WC26 against what `/v2/games`
already uses elsewhere in this file before hardcoding it — do not guess
the path string.

## TASK 2 — Build the 3-tier ordering in `runPhase9FieldPick`

Replace the flat sort from v1's design with a tiered sort: compute each
candidate's tier (0/1/2) using the shared `SPORT_CONFIG` (Task 1) plus
`round`/`went_to_ot` already present on archive-sourced candidates, sort
by `(tier ascending, score descending)`, keep top 5 as `ranked`. Candidates
sourced from the live-fallback path (not yet archive-seeded) that lack
`round`/`went_to_ot` default to Tier 2 — do not guess their tier from
incomplete data.

`scoreCandidatePick()` itself remains untouched. The AI-written
recommendation line generation (one call, headline game only) is
unchanged from v1's design.

## TASK 3 — Verification

- `node --check src/index.js` and `src/analytics-engine.js`.
- Trigger a real run and report the actual `ranked` array, including
  each entry's computed tier — confirm a real elimination/OT game (if
  one exists in today's real data) sorts above a higher-raw-score
  non-elimination game, proving tier genuinely takes precedence over
  score. If no such real contrasting pair exists today, report that
  honestly rather than fabricating a confirming example.
- Confirm the push-heartbeat gate (`src/index.js`) still works
  identically after the hoist — same behavior, just importing from the
  new shared location.
- Confirm exactly one AI call per run, as in v1.

## DONE CONDITIONS
- [ ] `SPORT_CONFIG` hoisted and exported, push-heartbeat gate unaffected
- [ ] WNBA/WC26 entries added, explicitly disclosed as reusing NBA/EPL numbers
- [ ] WC26's real ESPN path confirmed against existing usage, not guessed
- [ ] 3-tier ordering implemented, `scoreCandidatePick` itself untouched
- [ ] Live-fallback candidates default to Tier 2, not guessed
- [ ] Real run confirms tier genuinely outranks score where a real contrasting example exists, or honestly reports none did
- [ ] Exactly one AI call per run confirmed
- [ ] Outbox notes client work is now minimal: render the pre-ordered list, never display a raw score

## CONFIDENCE SCORING TABLE
+20  SPORT_CONFIG correctly hoisted, existing push gate unaffected
+15  WNBA/WC26 additions correctly disclosed as reuse, real path confirmed
+30  3-tier ordering correct, scoreCandidatePick untouched, live-fallback handling correct
+20  Real run verification, tier-over-score precedence demonstrated or honestly unconfirmed
+15  Outbox correctly scopes remaining client work to display-only, raw-number-safe

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-fields-pick-tiered-ranking.md. This
supersedes the unexecuted fields-pick-ranked-list.md. Hoist SPORT_CONFIG
to a shared exported constant (confirm the push-heartbeat gate still
works identically), extend it with WNBA/WC26 reusing NBA/EPL's exact
thresholds (confirm WC26's real ESPN path first, don't guess it), then
build a 3-tier stakes ordering (elimination/final round > OT-or-late-
close > everything else, score as tiebreaker within a tier) for
runPhase9FieldPick's ranked output. Verify with a real run showing tier
genuinely outranking score where a real example exists. Client work
stays minimal -- note in the outbox that display only needs to avoid
showing a raw score, nothing else. Do not commit unless confidence >=
95. If score < 95, report verbatim and stop.
