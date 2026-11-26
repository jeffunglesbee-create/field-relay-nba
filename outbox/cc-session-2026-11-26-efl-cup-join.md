# Session 2026-11-26 — the EFL Cup on the BSD game join; the EFL Trophy left off, measured (owner: "join EFL Cup and Trophy")

**Owner order:** "join EFL Cup and Trophy" (the one concrete next step offered at the end of the 2026-11-25 session). Spec: `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, "Addendum 2026-11-26" (decisions, measurements, done conditions). Earlier half: `outbox/cc-session-2026-11-25-uefa-efl-join.md`. Branch: main; no PR. Worked solo (the owner's usage limit).

**HEAD progression (relay):** `3b3ef17` -> `192a5f8` (cup fixture, written by the capture workflow) -> `ad78c6b` (label, 29 aliases, check, harness, deploy wiring, registry comment) -> `ee66c26` (backfill check reads the list) -> backfill artifacts -> this doc and the addendum.

## What the probe found before anything was built (Rule 100)

The ask treated two competitions as one. The registry carries `bsdLeagueId: null` for both (a 2026-08-08 statement: "no BSD id was verified"). BSD's league list (`outbox/bsd-leagues-2026-11-04T16-25-21-491Z.json`, 98 football leagues) holds **Carabao Cup (England), league 40, and no Trophy**. The fixture (27 dates, 179 rows, 3720 events) said the rest: EFL Cup 43 of 81 on the label alone; EFL Trophy 0 of 98, of which 97 have no BSD event at all.

## What was built

| commit | what |
|---|---|
| `ad78c6b` | `'EFL Cup'` on `BSD_SOCCER_SPORTS` (fourteen labels); 29 aliases in `src/identity-resolver.js`; `scripts/check-bsd-eflcup-join.mjs` (15 checks: 81 of 81, Trophy not on the list, Trophy relabelled joins 0 of 98); the shared harness covers a third block, 127 of 127 caught (including EFL Trophy put on the list); UEFA check pins the list at fourteen; deploy wiring; registry comment for `eflcup` records league 40 (comment only, `bsdLeagueId` stays `null`) |
| `ee66c26` | `check-bsd-game-join-backfill.mjs` derives the scope list from the source (it pinned it twice and went red each time a label was added); backfill harness 39 of 39 |

## Verified end to end (Rule 61)

- **Deploy:** run `45736596584` on `ad78c6b`, success.
- **Production join:** dry run `45739021423` (109 of 109 days read, 15 days / 81 rows planned, 0 stuck), real runs `45739449236` (10 dates, 68 rows) and `45739985721` (5 dates, 13 rows): 15 of 15 dates verified, 44 upstream pages, no stop.
- **Archive** (run `45740510062`, `outbox/archive-label-dates-2026-11-26T02-09-41-342Z.json`): EFL Cup 81 / 81 joined, EFL Trophy 98 / 0, EFL Championship 204 / 204.

## Not done, each with its unblock (Rule 74)

- **`bsdLeagueId: 40` for `eflcup`:** blocked by the decision that it turns on the BSD endgame capture (BSD requests, R2 writes). Unblocked when the owner says to capture the Carabao Cup. Verify: `grep -n "eflcup" src/index.js` shows `bsdLeagueId: 40`.
- **EFL Trophy on the join:** blocked by BSD carrying none of its matches. Unblocked when BSD's league list gains a Trophy league. Verify: `node scripts/measure-bsd-game-join.mjs --fixture <new capture>` joins a non-zero share of the relabelled Trophy rows, and `check-bsd-eflcup-join.mjs`'s relabelled-Trophy check goes red until the label is added.
- **The laboratory's grade is unaffected:** its population is nine league slugs (`epl`, `mls`, `seriea`, `ligue1`, `laliga`, `bundesliga`, `ucl`, `europa`, `eflchamp`); none is the cup, which has no BSD league id in the registry and so no capture directory.

## Errors found and fixed, matter-of-fact

- The first dry run (`45738302213`) failed in its `verify` job: `check-bsd-game-join-backfill.mjs` pinned the join's twelve non-MLS labels and went red with the thirteenth. Cause: I did not run it before pushing; it runs only in the backfill workflow, not in deploy or guards. Fixed in `ee66c26` by reading the list instead of pinning it; the only place that pins it now is the UEFA check.
- A `Under` pattern in my own probe matched `Sunderland` (three "U21" events in league 40 that were not): checked and discarded before anything was claimed from it.
