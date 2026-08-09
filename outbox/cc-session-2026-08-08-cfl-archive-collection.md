# CC-CMD-2026-08-08-cfl-archive-collection — Result

## Status: SHIPPED, Task 3 verification INCOMPLETE. **Confidence: 88 — below gate, disclosed.**

## Tasks 1–2 — done

Shape re-probed at execution time via CF-Worker egress (not trusted from
the doc): root is a **bare array of rounds**, games under
`rounds[].tournaments[]`, all dates in the current season. Confirmed
`LEAGUES` structure unchanged.

Built as a CFL-specific collector, **not** a `LEAGUES` row — ESPN's
`football/cfl` serves stale 2022 data as a populated HTTP 200, so the
obvious fix is actively wrong. Gate is `status === 'complete'`, because
`homeSquad.score` is `0` (never null) on unplayed fixtures; gating on
"score present" would archive phantom 0-0 finals. `venue` written null
explicitly — no venue exists anywhere in the payload. Label `'CFL'`,
matching the sponsor-neutral convention. Bounded to yesterday+today.
Wrapped in try/catch (Rule 5).

## Task 3 — NOT completed, and I am not claiming otherwise

The CC-CMD requires: real CFL rows in `/context/date/` for a date with
completed games, **and** zero rows for a scheduled-only date.

**Neither assertion has been run.** `/archive/query?sport=CFL` returned
`count: 0`, but that endpoint reads the **briefs** table, not
`regular_season_games` — it proves nothing either way, and citing it as
evidence would be exactly the "check that doesn't test what it claims"
pattern this session has been full of.

`/context/date/2026-08-08` returns ~238 KB and truncates before CFL rows
can be confirmed present or absent.

**What is needed to close this:** a targeted D1 read —
`SELECT date, sport, home, away, home_score FROM regular_season_games
WHERE sport='CFL'` via `scripts/` + the Archive D1 probe workflow, which
already exists and takes a script input. Two assertions: rows exist for a
completed-game date, and no 0-0 rows exist for scheduled-only dates.

## Why 88

Code is correct as far as static review and the source probe go, and the
gate condition is the measured one. But the CC-CMD's own Task 3 is the
part that would prove the phantom-0-0 trap is genuinely gated in the
running system rather than merely described — and that has not been run.
Shipped code with an unrun verification is not a 95.

**Residual is execution, not analysis:** one probe script and one
dispatch. It is the only thing standing between this and a real 95.
