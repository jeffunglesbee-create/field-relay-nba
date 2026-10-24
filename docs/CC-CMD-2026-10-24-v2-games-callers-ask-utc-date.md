# Claude Code Command — GameDO and the analytics engine ask /v2/games for the UTC date, which is tomorrow's slate from 8pm ET

**Date:** 2026-10-24
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a reader that silently gets the wrong day)
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL. TASK 0 done 2026-10-24 (workflow wf_4d87d314-9a8, each premise re-run by a refuter). TASK 1 is narrowed below and is not built: it has to change two lines together and settle the twin rows first
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

## TASK 0 — results (2026-10-24)

1. **CONFIRMED, and wider than written.** The real `_fetchFacts` was run at
   2026-10-25T00:30Z. It asked for `date=2026-10-25` and returned null. The
   same game resolves at 23:59Z, and at 00:30Z once the date is the ET date.
   This covers all 8 of tonight's NBA games, not 5: the 22:00Z and 23:30Z games
   are still being played at 00:00Z. The archive shows it for WNBA too. GameDO
   wrote a row for 21 of 31 day games and for 0 of 140 evening games, and every
   GameDO write lands between 18:24Z and 23:53Z.
2. **CONFIRMED:** `isoDate` is UTC.
3. **CONFIRMED, plus an eighth caller.** `GET /test/drama-score-cost` (live
   mode) calls `handleV2Games` with the UTC `today`. It is test-only. wc26's
   `todayISO` is UTC, and its cron is gated to the World Cup window.
4. **Write path CONFIRMED, effect REFUTED.** The final hook stamps the UTC date
   and `/archive/game` stores it verbatim. No row was ever mis-dated: the hook
   cannot reach a final after 00:00Z, because `_fetchFacts` returns null first.
   The defect today is a missing row. The date guard cannot see GameDO's rows:
   they carry no `start_time`, so they classify `no_start`.
   **Twin rows:** GameDO's id uses the raw lowercase sport. All 21 of its WNBA
   rows sit beside an uppercase, ET-dated twin, for example
   `wnba_2026-10-17_e401918305` beside `WNBA_2026-10-17_e401918305`.
5. **REFUTED:** the only scheduled path to Phase 9 and 10A is the
   `0 9 * * *` cron. At 09:00Z the UTC and ET dates agree on every day, so the
   analytics engine reads the right slate.
6. **Dormant CONFIRMED, for a different reason.** The client builds no NBA
   card for today, so no NBA socket ever opens (live page at 14:50Z and 15:11Z,
   re-read at 15:19Z: no NHL and no NBA cards). Filed in jubilant-bassoon as
   `docs/CC-CMD-2026-10-24-nhl-nba-today-sections.md`. The id expression would
   match for a V2-built card.

## TASK 1 — decided from TASK 0

The original plan (each caller asks for `getFieldDateKey()`) is narrowed by
premises 4-6:

- **GameDO `_fetchFacts` and its final-hook date change together, in one
  commit.** Fixing `_fetchFacts` alone would let the hook reach evening finals
  for the first time and write UTC-dated rows.
- **The twin rows come first.** Today GameDO's archive write only adds a
  lowercase twin of a row the cron writes anyway. Deciding whether GameDO
  should write at all, or write under the canonical id, is part of this CC-CMD
  and comes before its date fix, so the fix does not multiply twins for every
  evening game.
- **The analytics engine needs no change** (premise 5). `/test/drama-score-cost`
  is test-only and is left as it is.
- Nothing observable changes for NBA until the client builds today's NBA cards
  (the jubilant-bassoon CC-CMD above).

Superseded plan, kept for the record: each confirmed caller asks for
`getFieldDateKey()` from `src/field-date.js`, the fix AmbientDO got in
`b04f007`, one commit per caller.

Each confirmed caller asks for `getFieldDateKey()` from `src/field-date.js`,
the fix AmbientDO got in `b04f007`. One commit per caller (single concern).

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A check that runs GameDO `_fetchFacts` at 00:30Z against an ET-keyed board
   and asserts non-null facts. It is red with the UTC line restored.
3. The same kind of check for each other confirmed caller.
