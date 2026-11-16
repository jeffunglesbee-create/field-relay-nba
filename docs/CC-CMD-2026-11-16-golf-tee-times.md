# Claude Code Command — golf carries a real round start time, from ESPN's per-player tee times, and never a placeholder posing as one

**Branch:** main — commit directly, no feature branch, no PR
**Repo:** field-relay-nba (the source and the contract). One paired client change in jubilant-bassoon (Rule 70, ATOMIC-A): the relay deploys first, the client consumes.
**Filed:** 2026-11-16 by CC, on the owner's order "file the relay CC-CMD for golf tee times", from the Deep Cuts design work (field-laboratory `docs/CC-CMD-2026-11-15-scout-daypart-picks.md`, section "Golf").
**Confidence gate:** >= 95 before any commit
**Status:** FILED 2026-11-16. Not built. Task 1 is a blocking probe: the read cost decides the design.

---

## Probe block (read 2026-11-16, field-relay-nba main `397b961`, jubilant-bassoon main `3de5b45`)

**What ESPN serves** (read through the FIELD browser tool; the sandbox cannot reach ESPN):

- Scoreboard, `site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard` (the Austin Championship, event 401850980, Round 4 suspended): competition `date` `2026-11-12T05:00Z` with **`timeValid: false`**; no venue object; 120 competitors with keys `athlete, id, linescores, order, score, statistics, type, uid` and no tee time anywhere in them; `broadcasts` `[{"market":"national","names":["ESPN+","Golf Chnl"]}]`.
- Site summary, `site.web.api.espn.com/apis/site/v2/sports/golf/pga/summary?event=401850980`: **404**, `"Summary not supported for sport 'golf'"`.
- Core event, `sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401850980`: `date` `2026-11-12T05:00Z`, **`timeValid: false`**; `venues[0]` is a `$ref`; `courses[0]` names the course and city (Omni Barton Creek Resort & Spa (Fazio Canyons Course), Austin, TX).
- **Core competitor status**, `.../events/401850980/competitions/401850980/competitors/11183/status`: **`teeTime` `2026-11-16T15:31Z`**, `startHole` 1, `period` 4, `position` 1, state `pre`. A real tee time, already UTC: no venue time zone is needed to place it. One competitor per request.

**What the relay does with it:**

- `handleESPNGolfScoreboard` (`src/index.js` 3765) fetches the scoreboard (`cf: { cacheTtl: 60, cacheEverything: true }`, 3786), keeps `startDate = ev.date` (3814) and **drops `timeValid`**. KV `v2:golf:scoreboard:r3:${date}`, TTL 300 while a tournament is on (3930), 3600 off-tournament (3806). Callers: `handleGolfEnriched` (4130, `/v2/golf/enriched`), the ESPN-sourced `/v2/games` branch (4412), `buildGolfCronContext` (7635) and the `[GOLF-BRIEF]` journalism path (9052).
- The **pre-game seed** (`src/index.js` ~8758, `[ARCHIVE-SEED]`) posts every `gameMeta` entry to `/archive/game` with `start_time: gm.startTime` and **no `individual` check**, so each PGA event gets a `sport='PGA Tour'` skeleton row with empty sides and ESPN's midnight placeholder as its start. ARCHIVE_DB holds four since 2026-10-16 (`PGA Tour_2026-10-22_e401850917`, `..._10-29_e401850978`, `..._11-06_e401850979` at `2026-11-05T05:00Z`, `..._11-13_e401850980` at `2026-11-12T05:00Z`). **Not this CC-CMD's to fix:** it is the defect field-laboratory `docs/CC-CMD-2026-08-25-golf-sport-label.md` exists to stop (that CC-CMD gated the final-score write, ~8650, and not the seed). The finding is added there (BUILD-ON-A).

**Who writes the golf round rows:** the client. `saveGolfRoundFinal` (jubilant-bassoon `src/legacy/field.js` 13839, called at 22347 when `_isGolfRoundComplete`) posts from each viewer's browser `{ sport: 'golf', league: 'PGA Tour', date: TODAY_ISO, home: evName, away: 'R' + round, source_id: 'golf_' + eventId, ... }` with **no `start_time`**. ARCHIVE_DB, 2026-10-16 to 2026-11-15: every `golf` row has `start_time` null, `venue` null, `streams` null, and a round often appears on two consecutive `date`s (e.g. Butterfield Bermuda R1 on 10-22 and 10-23): the viewer's date, not the round's.

## Premises, and the one command that would refute each (Rule 100)

| premise | refuting command |
|---|---|
| ESPN has no single endpoint listing a round's tee sheet, so tee times cost one request per competitor | Task 1 |
| A competitor's `teeTime` is the time for the CURRENT round (`period`), not the first round's | read two competitors' status mid-tournament with different `period`s, or one before and after a round change |
| `teeTime` exists for every competitor before the round starts | count competitors with and without it on one pre-round read |
| The earliest `teeTime` of a round is its start (a two-tee start sends groups off 1 and 10 at the same time) | read `startHole` across the field; the earliest time is the start whatever the hole |

## Tasks

1. **Blocking probe: the read cost.** From a GitHub Actions runner (the sandbox has no route to ESPN), for one live or upcoming tournament: (a) search ESPN's core API for a per-round tee sheet (the competition's `$ref` children: `competitors`, `status`, `situation`, `details`, and any `teetimes`-like ref) and record each URL with its status; (b) read every competitor's `status` and record `teeTime`, `period`, `startHole` per competitor; (c) record the request count and wall time. Artifact: `outbox/golf-tee-times-probe-<date>.json` with all of it. **If a per-round endpoint exists, Tasks 2 to 4 use it and this premise row is struck.**
2. **Relay: carry `timeValid`, and serve the round's start.** In `handleESPNGolfScoreboard`, keep `timeValid` beside `startDate` (a placeholder must say it is one), and add `roundStart` (the earliest `teeTime` of the current round, UTC) and `roundLastTee` (the latest), from Task 1's source. Cache per Rule 78 exactly as the scoreboard already does (edge `cacheTtl` with `cacheEverything`, and a KV key with the 300 s / 3600 s TTLs), so the per-competitor reads happen at most once per TTL, never per request. Update `CONTRACTS.md` for `/v2/golf/enriched`.
3. **Client (paired, Rule 70): post the round's start.** `saveGolfRoundFinal` adds `start_time: pgaData.roundStart` when present. Nothing else in the client changes; the duplicate-date behaviour is recorded, not changed here.
4. **Placeholder guard.** `/archive/game` refuses a golf `start_time` that the relay marked `timeValid: false` (it stores null instead), so a midnight placeholder can never be read as a start again.

## Done condition (artifacts, Rule 89)

- `outbox/golf-tee-times-probe-<date>.json` (Task 1), with the request count.
- `/v2/golf/enriched` on a tournament day returns `timeValid: false` beside `startDate`, and a `roundStart` equal to the minimum `teeTime` in Task 1's per-competitor read for that round (both values printed, equal).
- After the next completed round: an ARCHIVE_DB `golf` row for that round whose `start_time` equals that `roundStart`; the query and its row in the outbox manifest.
- Each guard mutated red once (Rule 90): `roundStart` taken as the maximum, `timeValid` dropped, the archive guard removed.

## Constraints

- RELAY-IS-DUMB: a tee time is a fact a data vendor publishes. Nothing here ranks or recommends.
- No change to cron frequencies, bindings or Durable Objects.
- The historical `PGA Tour` rows are not deleted here (field-laboratory `CC-CMD-2026-08-25-golf-sport-label.md` step 4: human approval).
