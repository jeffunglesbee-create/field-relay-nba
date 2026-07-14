# CC-CMD: MLS identity-resolver club-ID mapping — outbox

**Date:** 2026-07-14
**Doc:** docs/CC-CMD-2026-07-14-mls-identity-resolver.md
**Commit:** c1d7ae0 (feat: MLS club-ID identity resolver for season-form context)
**Deploy:** run 29360396507, conclusion success

## TASK 0 — Probe (real findings, not assumed)

- Ran the doc's exact probe commands. `/soccer/season-form` handler at `src/index.js:11240` (unchanged), `gameMeta` construction at `src/index.js:6142`/`:6158` (drifted from the doc's own June 30 citation of 5571, exactly as the doc anticipated). Read the full handler: it matches `team.team_id === teamId` against `data.team_statistics` from `${MLS_STATS_BASE}/statistics/clubs/competitions/{compId}/seasons/{seasonId}`.
- Investigated the existing `src/identity-resolver.js` expansion the doc referenced. Confirmed it is a **different kind of mapping** than needed: `CANONICAL_TEAM` resolves name-variant → canonical-name (alias resolution), not name → external numeric/string ID. Stated explicitly rather than assumed reusable as-is — but its `resolveTeamKey()` canonicalization function *is* the right reuse point to bridge stats-api names and ESPN names onto the same key.
- **Did not guess a new clubs endpoint** (the doc explicitly warned a guessed one 404'd). Instead reused the exact same real, already-working endpoint `/soccer/season-form` itself queries (`/statistics/clubs/competitions/MLS-COM-000001/seasons/MLS-SEA-0001KA`) — this returns the full `team_statistics[]` array with `team_id`+`team_name` for every club in one call, confirmed live. `MLS-CLU-000008` in the response matched the known-correct Inter Miami CF anchor exactly (same xG/xG_efficiency/clean_sheets/possession_ratio as the June 30 confirmation) before trusting the rest of the list.
- **Correction to the doc's own CONTEXT claim (Rule 72):** the doc states `buildSoccerSeasonFormContext` "is client-side (jubilant-bassoon), not relay-side." This is factually wrong — it's defined at `src/context-assembler.js:413`, in this repo, and is the real, live consumer already wired into `handleJournalismCycle`'s per-game context assembly (`assembleContext` call at `src/index.js:~6809`). Its own code comment already documented the exact gap this CC-CMD closes: `KNOWN GAP: game.mlsHomeTeamId/mlsAwayTeamId almost certainly don't exist anywhere yet`.

## TASK 1 — The mapping

`src/identity-resolver.js`: `MLS_CLUB_ID_BY_NAME`, built from the real live fetch above — **all 30 current MLS clubs** (confirmed live count, not assumed still 30). Keyed via `resolveTeamKey(team_name)`. Checked every one of the 30 real stats-api names against the existing `CANONICAL_TEAM` alias table: all 30 already match an existing entry or alias (`New York City Football Club`, `Red Bull New York`, `Los Angeles Football Club` needed their existing aliases; the other 27 are exact matches) — zero new aliases required.

Independently verified **7 IDs** (more than the required 3) against real `/soccer/season-form` responses, all `_hasForm: true` with the correct `team_name` echoed back: Inter Miami CF (`MLS-CLU-000008`, the known anchor), FC Cincinnati, Vancouver Whitecaps FC, CF Montréal, Toronto FC, Seattle Sounders FC, Portland Timbers.

## TASK 2 — Wiring

`src/index.js`: `gameMeta.push()` (the confirmed-current site) now spreads `{ mlsHomeTeamId, mlsAwayTeamId }` in only when `label === 'MLS'`, computed via `resolveMLSClubId(homeName/awayName)`. Keyed on the **real, verified team-name format** gameMeta actually uses — `home?.team?.shortDisplayName || home?.team?.displayName` — confirmed by direct code read, not assumed to match `/v2/games`'s own separate adapter (`adaptESPNWCSoccer`, which uses `displayName` only, a different code path entirely — a further not-assumed correction over the doc's framing). Also added `mlsHomeTeamId`/`mlsAwayTeamId` to the `assembleContext(...)` call so `buildSoccerSeasonFormContext` actually receives them (confirmed via direct read of `assembleContext`'s signature: `opts` is passed unfiltered as `game` to every builder).

## TASK 3 — Verify

- `node --check src/index.js src/identity-resolver.js`: clean.
- **Real live check, 2+ real July 16/17 MLS games**, both home and away independently confirmed against real `/soccer/season-form` responses (exceeds the doc's "at least 2 games" — did full home+away for 2 games, 4 live calls):
  - CF Montréal (`MLS-CLU-000006`) vs Toronto FC (`MLS-CLU-00000M`) — July 16, both `_hasForm: true`.
  - Seattle Sounders FC (`MLS-CLU-00000S`) vs Portland Timbers (`MLS-CLU-00000P`) — July 17, both `_hasForm: true`.
- Additionally ran a free, zero-cost local test of the real committed `resolveMLSClubId` against **all 12 real team names** appearing across every real July 16/17 MLS game (fetched live via `/v2/games?sport=mls&date=2026-07-16` and `...07-17`) — all 12 resolved to correct, non-null IDs, matching the source table exactly.
- Confirmed `resolveMLSClubId` returns `null` for non-MLS names (`Manchester United`, `Brighton`) and for empty input — no false-positive leak.
- **Non-regression**: confirmed by direct code read — `mlsHomeTeamId`/`mlsAwayTeamId` are only spread into a `gameMeta` entry when `label === 'MLS'` (a plain, deterministic conditional with no external I/O in the branch decision), so non-MLS gameMeta entries carry no MLS-specific keys at all, not even `null`.

**Honest gap:** did not independently capture ESPN's raw `shortDisplayName` field value directly (only `displayName`, via `/v2/games`, since a raw ESPN scoreboard fetch isn't available through this session's tooling). Inferred safe rather than independently confirmed: `CANONICAL_TEAM`'s own header comment states its aliases were built in part from "ESPN displayName variants" observed by a prior session, and its alias list already covers every common short form for all 30 clubs (e.g. `Vancouver Whitecaps`, `Seattle`, `Miami`, `LAFC`) regardless of which literal ESPN field surfaces them. This is a disclosed limitation, not a demonstrated functional gap — flagged rather than asserted as fully closed.

## Confidence scoring (per doc's own rubric)

- TASK 0 (20 pts): real, current handler/gameMeta/config state confirmed, did not proceed on a guessed ID source (reused the real working endpoint instead), verified against the known anchor before trusting the list, one real correction to the doc's own claim documented — **20/20**
- TASK 1 (30 pts): real current full 30-club list (not assumed), 7 IDs independently verified (exceeds required 3) — **30/30**
- TASK 2 (20 pts): wired using the real, verified team-name format gameMeta actually returns (not `/v2/games`'s, confirmed different) — **20/20**
- TASK 3 (30 pts): live verification for 2+ real games (4 live calls) plus a broader 12-name local sweep, non-regression confirmed; docked for the one disclosed shortDisplayName gap — **27/30**

**Total: 97/100.**
