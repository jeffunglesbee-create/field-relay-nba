# Claude Code Command — POST /archive/game writes the archive for anyone

**Date:** 2026-10-14
**Repo:** field-relay-nba (callers in jubilant-bassoon and field-laboratory)
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (security / data integrity) — an unauthenticated write route
**Status:** **RULED 2026-10-18 — option 1, gate it. BLOCKED on rotation.** Not built; the ruling and its forced ordering are below.

## What was measured

Found by the 2026-10-14 audit of the shared-secret conversion: jubilant-bassoon's
`scripts/seed-mls-tournaments-2026.py` sends `X-FIELD-Relay`, and its runs stay
green whatever the value, because the route it posts to does not read it.

- `POST /archive/game` is handled at `src/index.js:13278`, before the non-GET
  method gate at `src/index.js:14209`, and the handler (13278-13709) contains no
  `relaySecretMatches`, `X-FIELD-Relay` or `authHeader` reference. Read
  2026-10-14 at `c6f094a`.
- It writes: `INSERT … ON CONFLICT(id) DO UPDATE` into `postseason_games` and
  `regular_season_games`, `INSERT INTO briefs`, `UPDATE <odds table> SET
  closing_odds = ?`, and `INSERT INTO change_log`.
- `docs/CC-CMD-2026-09-01-archive-game-numeric-espn-upsert-key.md` already
  recorded "`/archive/game` requires no auth — verified 2026-08-11 by 33 POSTs
  returning HTTP 200", as a convenience for runner tests. It was never filed as
  an exposure.

The repo is public and so is the Worker URL. Any caller can upsert a final
score, a brief, or a closing line into the archive the journalism and the odds
watches read.

## Callers that would need the header first (Rule 39 — audit before gating)

- **In-worker self-calls with no header:** `src/index.js` lines 8642, 8745,
  8846 and 8941 (`fetch(<relayBase> + '/archive/game', …)`), and the GameDO
  final-state write (`src/game-do.js`; to be confirmed).
- **Scripts and workflows (relay):** `scripts/run-archive-gap-espn-backfill.mjs`,
  `run-cfl-seed-backfill.mjs`, `repair-cfl-seed-duplicates.mjs`,
  `archive-game-team-refresh-test.mjs`, `archive-game-regular-refresh-test.mjs`,
  `numeric-espn-upsert-key-verify.mjs`, `cfl-archive-verify.mjs`,
  `probe-missing-start-time.mjs`, `verify-staged-items.mjs`,
  `d1-write-provenance-verify.mjs`, and the workflows that run them; `deploy.yml`.
- **jubilant-bassoon:** `scripts/seed-mls-tournaments-2026.py` (already sends
  the header).
- **field-laboratory:** `scripts/probe-dash-scheme-writer.mjs`,
  `dash-scheme-writer-probe.yml`.

The list comes from `grep -rlE "/archive/game"`, which also matches GET
readers; each one must be read to tell a writer from a reader.

## Decision for the owner

1. **Gate it** with `relaySecretMatches`, after every writer above sends the
   header. Self-calls read `env.RELAY_SHARED_SECRET`, scripts read the Actions
   secret. Recommended.
2. Leave it open and record it as an accepted risk, with the reason.

## Ruling, 2026-10-18 (owner, delegated: "go with Claude's best recommendations")

**Option 1. Gate it. And NOT before the shared secret is rotated and redacted.**

The gate would check `relaySecretMatches` against `RELAY_SHARED_SECRET`. That
value is in **this repo's current tree 33 times across 19 markdown files**, and
this repo is public (`private: False`, read from GitHub 2026-10-17). Measured by
this repo's own ratchet, which reads `PASS  RELAY_SHARED_SECRET: at most 33
occurrence(s)` — a budget of 33, not a count of zero. Files: `CONTRACTS.md`,
`HANDOFF.md`, eight `docs/CC-CMD-*.md` and nine `outbox/cc-*.md`.

**Gating with a published credential is worse than leaving the route open.** An
unauthenticated route invites a fix. A route gated by a value anyone can read
manufactures the appearance of authentication, and the next reader — human or
guard — treats it as protected and stops looking. That is a Rule 99 failure
moved up a level: a defence that is indistinguishable from a real one while
being none.

**Forced order, and nothing in it may be reordered:**

1. `rotate-relay-secret.yml` with `confirm=ROTATE` — owner-only, still 0 runs.
2. Redaction of the 19 files and the ratchet budget lowered 33 → 0 —
   `docs/CC-CMD-2026-10-18-redact-shared-secret-prose.md`.
3. Then this CC-CMD's option 1, which is mechanical once the value is fresh
   because the Rule 39 audit above is already written.

Two things make step 3 cheap. `/d1/execute` is gated by the same secret, so one
rotation closes both exposures. And the writer list is enumerated, so gating is
one deploy.

**No interim mitigation is authorised.** One was looked for: every legitimate
writer is enumerable, so the route could refuse implausible payloads. That is a
plausibility heuristic, which is a fallback, and this project does not take
them. The absence of a safe interim is itself an argument that rotation is the
gating item for this decision and not merely adjacent to it.

## Done condition (option 1)

`curl -X POST <relay>/archive/game` with a synthetic future date and no header
answers 401, and the same POST with the secret answers 200; one scheduled
archive write after the deploy lands (a `regular_season_games` row whose
`created_at` is after the deploy).
