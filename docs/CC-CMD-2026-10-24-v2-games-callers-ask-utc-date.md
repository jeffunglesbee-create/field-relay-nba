# Claude Code Command — GameDO and the analytics engine ask /v2/games for the UTC date, which is tomorrow's slate from 8pm ET

**Date:** 2026-10-24
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a reader that silently gets the wrong day)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the adversarial review of TASK 1 of
`docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md` (workflow wf_b338e9b9-f0d),
Rule 87.4. That change made the NBA board honour `?date`, which exposes NBA to
this defect. It did not create it, and it does not fix it.

---

## What was measured

- `src/game-do.js` builds its `/v2/games` date from the UTC clock in two
  places: `const today = new Date().toISOString().slice(0, 10);` in
  `_fetchFacts`, and `const date = new Date().toISOString().slice(0, 10);`
  beside it.
- Every board is keyed by the ET slate day (the reason AmbientDO moved to
  `getFieldDateKey()`, `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`,
  gap 2). From 00:00Z (8pm EDT) the UTC date asks for the next ET day's slate.
  So a game still being played is on no board GameDO reads, and `_fetchFacts`
  returns null.
- Until 2026-10-24 the NBA board ignored `?date` (it always served
  `todaysScoreboard_00.json`), so NBA was the one board where this did no
  harm. The CDN refused the Worker all season, so nothing was served either way.
- The reviewer reproduced it with the real AmbientDO and the real worker on a
  stubbed ESPN board. It also names `src/analytics-engine.js` Phase 9 and
  Phase 10A, which use `isoDate(new Date())`. That one is UNVERIFIED here
  (Rule 100): TASK 0 premise 2 below.

## TASK 0 — premises, one command each

1. **GameDO misses an evening game.** Run GameDO `_fetchFacts` at 00:30Z
   against a stubbed ET-keyed board holding a 00:00Z game. Expect null. A
   non-null result refutes the premise.
2. **The analytics engine reads the UTC day.** Read what `isoDate` returns
   for 2026-10-25T00:30Z, and what Phase 9 and 10A pass to `/v2/games`.
   `2026-10-24` refutes it.
3. **Every caller.** Grep for `/v2/games?` in `src/`, and list each caller's
   date source. A first grep (2026-10-24) found:
   - AmbientDO: `getFieldDateKey()`, already fixed;
   - GameDO `_fetchFacts`: UTC;
   - analytics-engine at two sites, both `today`, which comes from
     `isoDate(new Date())`;
   - wc26 at `todayISO`;
   - three backfill and enrich paths that pass a row's own date.
4. **GameDO's archive write dates by UTC too.** Its final-hook write sets
   `const date = new Date().toISOString().slice(0, 10);` before it posts
   the row. A game finishing after 00:00Z would then be dated the next day,
   the class the guard "Every archived game is dated on the ET day of its own
   kickoff" exists for. Read that write's consumer and run the guard's oracle
   on a 02:00Z final. A date equal to the ET day refutes it.
5. **When the analytics engine runs.** Phase 9 and 10A matter only if their
   cron fires between 00:00Z and 04:00Z. Read the cron table. A run only
   inside 04:00Z-24:00Z refutes the defect there.
6. **GameDO is dormant for NBA anyway.** The map's critic reads the client as
   opening NBA sockets with ids that match no /v2/games id. Run the client's
   id expression on an NBA card and on a /v2/games game. If they match, that
   refutes "dormant".

## TASK 1 — decided from TASK 0

Each confirmed caller asks for `getFieldDateKey()` from `src/field-date.js`,
the fix AmbientDO got in `b04f007`. One commit per caller (single concern).

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A check that runs GameDO `_fetchFacts` at 00:30Z against an ET-keyed board
   and asserts non-null facts. It is red with the UTC line restored.
3. The same kind of check for each other confirmed caller.
