# Claude Code Command — Backfill Quality Scores for KV-Captured Briefs

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-kv-brief-quality-backfill-2026-06-30.md.

## CONTEXT

`/quality/report` shows `game_recap` briefs as heavily "unscored" for several
sport-label variants — this is REAL, not the threshold-labeling noise
elsewhere in the same report (that separate, already-diagnosed issue: 240
is `runQualityChain`'s internal "excellence" retry bar, not a pass/fail
floor — typical healthy scores run 150-220 on the 300-point scale. Do not
touch that constant as part of this CC-CMD; it's a different, cosmetic
alert-labeling problem, out of scope here).

Confirmed live via direct D1 query (`/d1/execute`, table-allowlisted
diagnostic endpoint) against the `briefs` table: ~89 `game_recap` rows and
growing — including rows created TODAY (2026-07-01) — have
`quality_score` permanently NULL. Sport labels affected: lowercase
`espn`, `fifa world cup 2026`, `football`, `mlb`, `pga tour`, `wnba`
(distinct from the correctly-cased, correctly-scored `MLB`/`WNBA`/`FIFA
World Cup` groups).

ROOT CAUSE (confirmed by reading both insert sites): two paths write
briefs captured from KV storage straight into D1 without ever scoring
them:
- `sweepKVBriefs()` — src/index.js ~4220, `source='kv_sweep'`
- the `kv_capture` block inside `POST /archive/game` — src/index.js
  ~7800-7840, `source='kv_capture'`

Both do: `qualityScore = p.quality_score || p.score || null` — reading
whatever was in the raw KV JSON payload, if anything, and writing null
otherwise. Neither calls any scoring function. `ON CONFLICT DO NOTHING`
on insert means these rows are never revisited — permanently unscored
once captured.

FIX MECHANISM: `journalism-quality.js` exports `scoreProse(text, {sport,
game, matchupNote})` — a standalone scorer that does NOT require the
original generation prompt (unlike `runQualityChain`, whose retry layers
need `prompt` and therefore cannot be used for pure backfill scoring of
already-captured text). This is the correct tool here.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "export async function scoreProse" src/journalism-quality.js
grep -n "async function sweepKVBriefs" src/index.js
grep -n "kv_capture" src/index.js
grep -n "pathname === '/archive/game'" src/index.js
```

Confirm `scoreProse`'s exact `opts` shape (`sport`/`game`/`matchupNote`
field names and what `game` expects — likely `{home, away, homeScore,
awayScore}` matching `runQualityChain`'s usage, verify don't assume)
directly from source before writing any call site.

## TASK 1: Score at write time (stop the bleeding)

**In `sweepKVBriefs()`:** after `briefText` is resolved and before the
INSERT, if `qualityScore` is still null, best-effort look up game context
(home_score/away_score/home/away) from `regular_season_games` /
`postseason_games` by `gameId` — wrap in try/catch, a lookup miss must
never block the sweep — then call `scoreProse(briefText, {sport, game})`
and use the result in place of null.

**In the `kv_capture` block inside `/archive/game`:** same fix, but
simpler — `home_score`/`away_score`/`home`/`away` are already destructured
from the request body at that point, no extra D1 lookup needed.

## TASK 2: Backfill existing NULL rows

New diagnostic/admin endpoint `GET /quality/backfill-scores` — mirror the
existing `/backfill/game-briefs` pattern: `?dry=true` preview, `?limit=N`
(default 10, capped at 50), optional `?date=`.

```sql
SELECT id, sport, game_id, brief_text FROM briefs
WHERE quality_score IS NULL AND source IN ('kv_sweep','kv_capture')
ORDER BY created_at DESC LIMIT ?
```

For each row: best-effort join game context via `game_id` (same
try/catch pattern as Task 1), call `scoreProse(brief_text, {sport,
game})`, `UPDATE briefs SET quality_score = ? WHERE id = ?`. Return
`{ok, scored, skipped, results:[{id, old:null, new:score}]}`. Dry run
returns the same shape without writing.

## TASK 3: Verification — CC-side scope is build/CI only

**IMPORTANT:** CC's egress blocks `*.workers.dev` — do not write
verification steps that curl the deployed relay from inside this CC
session; they will fail. CC's done condition for this CC-CMD is: code
committed, all 4 CI workflows green, deploy completed (verify via GitHub
Actions API — `get_ci_status`-equivalent — not the live endpoint). State
explicitly in the outbox doc that live-endpoint verification (hitting
`/quality/backfill-scores?dry=true` to confirm the NULL count, then a
real run to confirm it drops, then re-checking `/quality/report`) is a
chat-side follow-up and is NOT part of this CC-CMD's done condition —
do not claim functional success without that caveat.

## TASK 4: Outbox manifest (last task)

Write `outbox/cc-kv-brief-quality-backfill-2026-06-30.md` covering: what
the probe confirmed about `scoreProse`'s real signature, what was built,
CI/deploy status, and any deviation from this spec with reasoning.
