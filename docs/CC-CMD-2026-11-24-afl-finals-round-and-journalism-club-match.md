# Claude Code Command — AFL finals use ESPN's postseason week as Squiggle's round, and the journalism context matches clubs by prefix and drops round 0

**Date:** 2026-11-24
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (fix; three parts, none blocked by an external dependency)
**Status:** FILED 2026-11-24, not started. Unblocked: every part can be measured and checked on the finished 2026 season. **Deadline: before the 2027 Wildcard Finals week** (2026's was 2026-08-26..09-01 per ESPN's own calendar; 2027's is not yet published). Until then nothing reaches a user: AFL has no fixtures and Kali is offline until 2027 (`html_probe https://kaliaflstats.com/api/afl/v1/teams`, 2026-11-24: HTTP 200 `text/html`, "kali-afl - back in 2027").
**Filed from:** the second adversarial review of `docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md` (findings I4 and I5, both confirmed by an independent skeptic), 2026-11-24. Searched by content before filing (BUILD-ON-A): the AFL CC-CMDs of 2026-06-26, 2026-07-05 and 2026-07-08 built the Kali/Squiggle context and the resolver and do not mention finals or round 0; no open CC-CMD covers either. Nothing here undoes a ruling or a hold of those.

## Why this exists

The range fix (`docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md`, landed 2026-11-24, live-proven by run 45489913728) makes `_discoverAFLRound` find a round again, which un-hides what runs after it. It fixed the club match in `src/wp-resolver.js` (a Melbourne pick landed on North Melbourne's game and tip). It did not touch `src/index.js`, which has the same defect class in its own copy, and it cannot fix finals, which are a mapping problem between two sources.

## Part A — `buildAFLJournalismContext` matches clubs by prefix (src/index.js:4522)

`findGame` (line ~4531) matches a Kali or Squiggle row to an ESPN game with `teamNameMatch` (a 5-character prefix rule) and a private `_norm()` equal to the resolver's removed one. The resolver's fix is `sameAFLClub` in `src/wp-resolver.js`: exact comparison of `resolveAFLTeamKey`.

Measured 2026-11-24, relay `/v2/games?sport=afl&date=2026-07-11`: `GWS GIANTS v Geelong Cats` carries `journalism.squiggle: null` while the other three games that day carry values, because `teamNameMatch('Greater Western Sydney', 'GWS GIANTS')` is false. The prefix rule also joins `Port Adelaide`/`Adelaide`, `Melbourne`/`North Melbourne` and `Western Bulldogs`/`Greater Western Sydney` (reproduced against the real resolver in review); in `findGame` that picks the first matching game in `games`, which can be the wrong one.

**Change:** `findGame` compares `resolveAFLTeamKey` keys for equality (share the helper with `src/wp-resolver.js` rather than copying it a third time: export it from `src/identity-resolver.js` next to `resolveAFLTeamKey`). Remove `_norm`.

## Part B — `buildAFLJournalismContext` drops round 0 (src/index.js:4523)

`if (!round || !year || !games.length) return {};` reads the Opening Round's `week.number` 0 as no round. Measured: `/v2/games?sport=afl&date=2026-03-05` and `2026-03-06` return games with `"round":0` and no `journalism` key; Squiggle serves `?q=tips;year=2026;round=0` with an Aggregate source (five games, 2026-11-24). `src/wp-resolver.js` was fixed for this in the range-fix commits. **Change:** `round === null || round === undefined` (and keep `!year`).

## Part C — finals: ESPN's week is not Squiggle's round (resolver and journalism)

`_discoverAFLRound` returns `ev.week.number` as the Squiggle round, and `src/index.js:4793` passes `games[0].round` (also `ev.week?.number`) to `buildAFLJournalismContext`. For finals ESPN restarts the number. Its calendar in the real `dates=20260709` body (read 2026-11-24, `browser_quick`; the trimmed recording `outbox/espn-afl-scoreboard-20260709-recorded-2026-11-24.json` keeps only the events) lists the Postseason entries Wildcard Finals = 1, Qualifying & Elimination Finals = 2, Semi Finals = 3, Preliminary Finals = 4, Grand Final = 5. Squiggle numbers them on from the regular season: `?q=games;year=2026;round=26` returns the four games of 2026-09-03..05 as `roundname: "Finals Week 1"`, `round: 26`, each with `is_final` (2 or 3) and `is_grand_final` (read 2026-11-24, `html_probe`).

Measured 2026-11-24 through `probe_relay_route`: `/v2/games?sport=afl&date=2026-09-26` returns the Grand Final (Fremantle v Brisbane Lions) with `round: 5` and `journalism: {kali: null, squiggle: null}`. The review (finding I5, skeptic-confirmed; Task 0 re-measures it) also read `round: 2` for 2026-09-04 and 2026-09-05 and `round: 4` for 2026-09-19, and that the 2026-09-05 Adelaide Crows v Western Bulldogs final is served `journalism.squiggle` 47.29 / 52.71, identical to the 2026-03-20 round-2 Adelaide v Bulldogs tip: a September final carrying a March game's probability. In the resolver the same input asks Squiggle for `round=2` and returns the March tip under `source: 'squiggle'`.

**Not established:** whether a finals EVENT carries `season.type` 3 (the real body recorded above shows `season.type: 2` for a regular-season event) — that is the cheapest discriminator and Task 0 measures it; how Kali numbers finals.

## Task 0 — probe first (no spend, no deploy)

1. Read ESPN one day at a time (`browser_quick` markdown or a runner; `html_probe` truncates) for 2026-08-28, 2026-09-05 and 2026-09-26 and record, per event, `season.type`, `season.slug`, `week.number` and the team names.
2. Read Squiggle `?q=games;year=2026;round=25..28` and `?q=tips;year=2026;round=25..28` and record `round`, `roundname`, `is_final`, `is_grand_final`, `date` and the teams per game (`is_final` and `roundname` are the likely discriminators).
3. Build the map from the two recordings and say whether ESPN's date or `season.type` can place a finals game in Squiggle's round without a lookup table; if a lookup is needed, say what it is keyed on.

## Task 1 — the change (after Task 0)

Parts A and B as written. Part C: the Squiggle round for a postseason event comes from the map Task 0 produced, in ONE place used by both the resolver and the journalism context; an event whose Squiggle round cannot be determined is skipped and SAID (`console.warn`), never resolved through a regular-season round.

## Done condition (artifact, not a bare action)

1. A committed check that runs the real `/v2/games?sport=afl` path (the default export of `src/index.js` over a stub, as `scripts/check-odds-backfill-sport-filter.mjs` does) with `KALI_AFL_TOKEN` set, and asserts: a `GWS GIANTS` game gets its Squiggle tip, a `Melbourne`/`North Melbourne` round gets each club its own tip, a round-0 game gets a `journalism` key, and a recorded 2026 finals game gets Squiggle's finals round, not ESPN's; each assertion has a mutant that goes red.
2. The same finals input through `resolveWinProbability('AFL', …)` returns the finals round's tip or null with a warning, never the regular-season tip (add it to `scripts/check-afl-round-discovery.mjs`, which already carries the 18-club identity table).
3. STAGED until AFL has fixtures: the live finals read. Unblocked when the 2027 Wildcard Finals week is on ESPN's calendar; verify with the Task 0 reads for that week.
