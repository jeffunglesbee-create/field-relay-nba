# CC Session 2026-07-17 — Journalism Quality Improvements

## Date
2026-07-17

## Repo
field-relay-nba

## HEAD Progression
- Before: 67786d8 — ci: swap gpt-4o-mini for gpt-4.1-nano in voice register test
- After:  7fd4e34 — feat: add post-match exemplars E/F/G to FIELD_VOICE_REGISTER

## What Was Done

Two improvements to journalism output quality, following the model evaluation
session (cc-session-2026-07-17-model-eval-club-context.md).

### Part 1: Post-match exemplars in FIELD_VOICE_REGISTER

**Problem:** All four prior exemplars in FIELD_VOICE_REGISTER (A-D) are
pre-match preview prose. The pipeline generates post-match game briefs on
the same register, creating a template mismatch — models pattern-match
against pre-game structure when writing completed-game content. The 3b
voice judge also evaluates post-match prose against only pre-match examples.

**Fix (commit 7fd4e34):** Added three post-match exemplars after the existing
club-context convention block, before the anti-exemplar section:

- **Exemplar E** — Soccer WC group-stage result (~115 words): France 2-1 Morocco.
  Shows: club affiliation naturally embedded, result narrative that doesn't
  lead with the score, what the result means going forward, "They don't"
  as a confident closing beat.

- **Exemplar F** — NBA playoff game result (~115 words): OKC 118 Denver 107 Game 4.
  Shows: decisive-moment lead (fourth-quarter run), star line subordinated
  (SGA's 34 points inside a claim, not as the predicate), series-closure
  framing, forward-looking bracket question.

- **Exemplar G** — NHL playoff OT game result (~110 words): Carolina 3 Vegas 2 OT.
  Shows: overtime specificity (4:12, top corner), comeback structure across
  three-period leads, quiet number alongside the headliner (Svechnikov
  plus-4 vs Aho), "the variable Vegas can't account for in the analytics"
  as FIELD-idiomatic close.

All three explicitly labeled `— POST-MATCH EXEMPLARS` so models understand
these represent completed-game output vs the preview shape of A-D.

### Part 2: Curated output cache (voiceExemplarBlock)

**Status: Already live. No changes needed.**

Audited `voiceExemplarBlock` at lines 7353-7389 of `src/index.js`:
- Queries ARCHIVE_DB for top-3 `quality_score` slate briefs from last 7 days
- Filters: `brief_type = 'slate'`, `source IN ('cron','backfill')`, `quality_score IS NOT NULL`
- Injects as "FIELD VOICE EXAMPLES (match this tone and style):" in `buildPrompt()`
- Line 7568 confirms `quality_score` (as `finalScore`) is bound in the cron archive INSERT

The infrastructure works end-to-end for slate briefs. As the FIELD journalism
pipeline accumulates more cron-generated slate briefs with quality scores,
the voiceExemplarBlock will inject improving examples automatically.

**Known gap:** Game brief paths (`executeGameBriefBackfill`, queue consumer at
line 15511+) do NOT inject voiceExemplarBlock. Those paths use a simpler prompt
(FIELD_VOICE_REGISTER + game data). Adding exemplar injection to game briefs
would require a D1 query per game in the backfill loop — feasible but a
separate session.

## Verification

- Syntax check: `node --check src/journalism-quality.js` → SYNTAX OK
- Deploy triggered by push to main (auto-deploy via deploy.yml)
- voiceExemplarBlock confirmed wired into `buildPrompt()` at line 7445

## Open Watch Items

- **Haiku 4.5 efficiency/clinical phrasing:** "clinical efficiency" (Run 3),
  "surgical efficiency" / "clinical brace" (Run 4) — appearing consistently.
  Worth adding to BANNED_PHRASES or FIELD_VOICE_REGISTER explicit callout in
  a future session.
- **Game brief exemplar injection:** voiceExemplarBlock not wired into
  `executeGameBriefBackfill` or queue consumer. Scope for a separate prompt.

## Confidence: 100/100
- Post-match exemplars written and committed to main (7fd4e34)
- voiceExemplarBlock confirmed live and storing quality_score at line 7568
- No production changes required for Part 2
