# CC-CMD: /archive/game postseason id keyed by series_key+round+date — outbox

**Date:** 2026-07-15
**Doc:** docs/CC-CMD-2026-07-15-archive-game-series-upsert-key.md
**Commit:** d6b03e8 (fix, deployed and live-verified)

## TASK 0 — Probe

Read the full, current `/archive/game` handler (`src/index.js` ~L9531) directly (not the unreliable search tool). Enumerated every real caller of `/archive/game` across this repo via `grep -rn "archive/game" src/`:

1. `src/game-do.js` ~L430 (GameDO final-state completion write) — never sends `series_key`. Confirmed via its own inline comment: "crew, streams, series_key, importance, game_number remain out of scope — manual seed / executeBackfill handle those."
2. `src/index.js` ~L6531 (ARCHIVE-CATCHUP, inside `handleJournalismCycle`) — never sends `series_key`.
3. `src/index.js` ~L6716 (ARCHIVE-SEED) — never sends `series_key`.
4. `src/index.js` ~L6800 (ARCHIVE-YDAY) — never sends `series_key`.

**All 4 real internal callers in this repo never set `series_key` — confirmed, not assumed.** The `series_key`-bearing bracket writes are exclusively external (jubilant-bassoon's `mls-tournaments-seed.yml`, per the CC-CMD's own CONTEXT), matching the original bug report. This means every internal caller is unaffected by TASK 1's fix by construction, not just by good luck.

## TASK 1 — Fix

**Deviated from the CC-CMD's literally-suggested `series_key+round+game_number` format, with live evidence:**

Queried real `postseason_games` data (`GROUP BY series_key, game_number`) before finalizing the format and found `game_number` is unreliable across two real external-caller populations:
- Every MLS two-leg bracket tie has `game_number` stuck at `1` for both legs (confirmed real 2-row cases: `MLS-COM-00002V_SF-01`, `MLS-COM-00000K_QF-01` through `SF-02`, etc. — `n=2` under `(series_key, game_number)`).
- `ufl-playoffs-2026` leaves `game_number` `NULL` entirely, also `n=2`.

Building the id from `series_key+round+game_number` as originally suggested would have collided these real, legitimately-distinct legs into one row — a *worse* bug than the one being fixed (silent loss of a whole leg's data, not just a duplicate). Checked `(series_key, round, date)` instead: **zero collisions across all 501 real postseason_games rows.** `date` is the disambiguator used instead of `game_number`.

Final id format: `${sport}_${series_key}_${shortify(round) || 'r'}_${date}` when `series_key` is present; the exact original name-based id, byte-for-byte unchanged, when it's absent (`src/index.js`, `/archive/game` handler).

**Deliberately not backfilling existing rows' ids** — `/archive/score-by-id` and other routes look games up by `id`; an external caller could hold a cached old-scheme id for an in-progress series, and retroactively renaming ids risks silently breaking those lookups. Disclosed net effect: any currently-pending (unresolved) placeholder leg will still duplicate exactly once on its next resolution, then self-heals from there — same one-time-only pattern the KV id-prefix fix (`CC-CMD-2026-07-15-brief-game-kv-id-convention`) also accepted for the same reason.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- 9 forced-condition tests mirroring the exact id-construction logic (`/tmp/.../scratchpad/test-series-id.mjs`): TBC→real transition produces the identical id; two real legs (same series+round, different dates) get distinct ids; the two real confirmed-unreliable-`game_number` cases (MLS two-leg, `ufl-playoffs-2026`-style null) correctly disambiguate via date instead; non-bracket callers' ids fully unchanged (both the team-name path and the `source_id` fallback path); a round value containing a space ("Phase One") sanitizes cleanly. All pass.
- **Real live write-twice test** (deployed, commit `d6b03e8`), disposable test `series_key='TEST-CCCMD1_SF-99'`, cleaned up after:
  1. POST 1: `home:'TBC Home', away:'TBC Away'` → `id: "MLS_TEST-CCCMD1_SF-99_semifinal_2099-01-01"`.
  2. POST 2: same `series_key`/`round`/`date`, `home:'Test FC Alpha', away:'Test FC Beta', home_score:2, away_score:1` → **identical id**.
  3. D1 read after both writes: **exactly 1 row** (not 2) under this test `series_key`, with `home_score:2, away_score:1` correctly reflecting POST 2's update.
  4. Test row deleted (`DELETE ... WHERE series_key = 'TEST-CCCMD1_SF-99'`, 1 row affected).

**Real, separate finding surfaced by this live test (not hidden):** the row's `home`/`away` columns still read `"TBC Home"`/`"TBC Away"` after POST 2 — the `ON CONFLICT(id) DO UPDATE SET` clause does not include `home`/`away` in its column list, and this is **pre-existing behavior, not something this fix introduced or touched** (confirmed by reading the UPDATE clause directly — it wasn't changed by this dispatch). This CC-CMD's actual DONE CONDITION ("updates its existing row instead of creating a duplicate") is fully met — there is exactly one row, correctly upserted by id. But the row's *team-name fields* specifically never refresh on any conflict-triggered update, for any caller, not just bracket ones — meaning a resolved bracket leg's row will no longer duplicate, but will keep showing placeholder names indefinitely unless something else corrects them. This was out of scope for TASK 1 (which only asked for an id-scheme change) and is not fixed here — flagged for a follow-up CC-CMD if stale placeholder names in already-deduped rows turn out to matter.

## DONE CONDITION

Met. A `series_key`-scoped multi-leg tie whose participant resolves from a placeholder name to a real one now updates its existing row instead of creating a duplicate — verified via a real write-twice test against the deployed relay, not asserted from code review alone. Every non-bracket caller's existing name-based `id` behavior is provably unchanged (confirmed both by TASK 0's caller enumeration and TASK 2's forced tests).

## Confidence scoring

- **TASK 0 (30 pts):** all 4 real callers enumerated and confirmed (not assumed) not to send `series_key`; correctly identifies the external caller as the only real source of `series_key`-bearing writes. **30/30.**
- **TASK 1 (40 pts):** correctly scoped (only `series_key`-bearing writes get the new key); the deviation from the CC-CMD's suggested `game_number` disambiguator was found, evidenced with real live data (not guessed), and the safer `date`-based alternative was verified zero-collision against all 501 real rows before shipping. No `wrangler.toml` changes. **40/40.**
- **TASK 2 (30 pts):** 9 real forced tests; a genuine live write-twice test against the deployed relay (not just asserted); a real, separate, pre-existing gap was found and honestly disclosed rather than glossed over. **30/30.**

**Total: 100/100.**

Score meets the 95 commit threshold.
