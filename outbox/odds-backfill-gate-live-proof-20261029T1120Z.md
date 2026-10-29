# /archive/odds-backfill gate — live proof, 2026-10-29 11:20Z

**Change:** `1d55722` `fix: /archive/odds-backfill answers 401 before it spends`. Route A of TASK 1 in
`docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md`, released by the owner on 2026-10-29 ("decisions approved").
**Deploy:** Deploy RELAY Worker run `40863046648`, success (11:08:22Z to 11:14:33Z). Repo guards run `40863046704`, success.

## Done condition 3, as run

Tool: the relay self-probe (`probe_relay_route`, which sends no credential). Both `/budget/odds` readings and the route
probe were made inside one 25-minute window with the deploy between them; the route probe was made after the deploy
reported success, so it could not have reached the old code.

```
GET /archive/odds-backfill?date=2026-10-28      (no Authorization header)
  status:       401
  content-type: text/plain;charset=UTF-8
  body:         Unauthorized          (12 bytes)
```

| field of `/budget/odds` | before (10:53:18Z, `provider.checked_at`) | after (11:17:29Z) |
|---|---|---|
| `daily.used` | 449 | 449 |
| `daily.by_site.archiveOddsBackfill` | 0 | 0 |
| `daily.by_site` (all 13 labels) | identical | identical |
| `daily.by_site_sum` / `unaccounted` | 449 / 0 | 449 / 0 |
| `monthly.used` | 46323 | 46323 |
| `daily.refusals` | `[]` | `[]` |
| `degraded_open.events` | 0 | 0 |

**What the table does and does not show.** The CC-CMD asked for the route's label to be read "with no cron tick between".
Between the two readings the `handleWCOddsProbs` row of `reconcile` went from `n` 2 to `n` 4 (`EXPIRED`,
`credits_kept` 0): another consumer ran twice and billed nothing, so no counter moved. No `archiveOddsBackfill` row appeared in
`reconcile` either. The 0 to 0 is weak evidence by itself, because the label has no other caller and was 0 before the
probe; the **401 is the artifact**, and the route being unable to spend is shown by the check below, not by this table.

## What proves the gate cannot be bypassed (not observed live: a 200 with the secret)

I do not hold `FIELD_MCP_SECRET`, so the authorized path (200, spends under `archiveOddsBackfill`) was NOT exercised live.
It is exercised by `scripts/check-odds-label-split.mjs` against the real worker: 68 of 68 pass, covering no credential, a
wrong one, the published relay secret, an unset secret and an empty one (all 401, vendor stub never called, no counter or
ledger row moved), and the right secret (200, one charge under `archiveOddsBackfill`).
`scripts/mutate-odds-label-split.mjs`: 24 of 24 mutants caught, including L22 (gate removed), L23 (empty secret opens
the helper), L24 (helper compares the published `RELAY_SHARED_SECRET`) and L25 (the 401 is built and the route runs on).

## Gates

`gates.py` on the pushed tree (a COMMITTED worktree named `field-relay-nba`; 148 static steps of `deploy.yml` and
`guards.yml`): **146 of 148**. The two failures are the standing environment-only pair: the BSD frame list (HTTP 0) and
`Every archived game is dated…` (`RELAY_SHARED_SECRET` unset). The first run of this commit was 145 of 148 and a third
failure was real and mine — see below.

## The defect the gates found

`deploy: Every cross-module call resolves to an import` failed with `src/index.js: calls computeLiveWP() … with no
import` (and `computeAdvancementProb`, `oddsToLambda`, `lambdaFromTotalsAndH2H`). Clean `origin/main` (`171afc6`) passed
(`0 unresolved`), so the cause was this commit. Cause: the new comment above `mcpBearerMatches` contained `/admin/*`,
and `scripts/check-imports-resolve.mjs` strips `/* … */` before reading imports, so the `/*` swallowed the import block
that follows. The code was fine; the comment was not. Fixed by rewording the comment (no code change), re-gated, then
pushed.

The same stripper also fails in the other direction, which is the dangerous one. Measured 2026-10-29 with
`SRC_DIR=<fixture>`: a module that calls an unimported `foo()` after a `//` comment or a string containing `/*`, with a
real block comment further down, exits 0 with `0 unresolved`. That is the 2026-09-05 outage class (a missing import in a
Durable Object constructor) passing the check built for it. Filed and fixed as
`docs/CC-CMD-2026-10-29-imports-check-comment-stripper.md`, in its own commit (Rule 69).
