# Session 2026-10-28 — the BSD join's alias table, measured on seven more dates

CC-CMD: `docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md`. Consumer: field-laboratory
`docs/CC-CMD-2026-10-27-lineups-on-game-cards.md`, whose soccer cards show "No lineup source for this game" for every row
left unjoined.
HEAD progression: `4de1b0c` at probe time → `ffee86b` (measure) → `35146db` (nine pairs) → `d001630` (pushed, deploy) →
`359679f` (live check) → `226143b` (trigger) → `dca3f5b` (the run's record).

## Result

The first CC-CMD proved the join on two dates (43 of 43, 41 of 41) with 29 alias pairs derived from those two dates. A third
date, 2026-10-10 (joined by the laboratory, run 40620697737), joined 48 of 53. This session captured seven more dates, measured
the misses before changing anything, added nine pairs from that measurement, deployed, and read the result back from the
deployed relay.

| date | soccer rows | joined before the pairs (offline rule) | joined live | written, first call | written, second call |
|---|---|---|---|---|---|
| 2026-10-10 | 53 | 48 | 53 | 5 | 0 |
| 2026-09-12 | 45 | 39 | 44 | 44 | 0 |
| 2026-09-19 | 40 | 35 | 40 | 40 | 0 |
| 2026-10-17 | 50 | 47 | 50 | 50 | 0 |
| 2026-10-18 | 28 | 22 | 28 | 28 | 0 |
| 2026-10-24 | 48 | 46 | 47 | 47 | 0 |
| 2026-10-25 | 30 | 25 | 30 | 30 | 0 |
| **all** | **294** | **262** | **292** | 244 | 0 |

"Before" is the offline rule at `4de1b0c` over the captured fixture, not what the relay held: six of the seven dates had never
been joined on the relay, so their first call wrote the whole day (10-10 had 48 already, from the laboratory's run).

- **Measurement, before any pair** (`outbox/bsd-join-aliases-measure-before.txt`, `.json`): 32 unmatched rows over seven dates, 30
  of them one club's BSD spelling (Alavés, Barcelona, Augsburg, Stuttgart, Monaco, Milan, Málaga, Marseille, Rennes), 2 with no BSD
  event. 9 distinct clubs, well under the 40 that would have been a design problem.
- **Live assertions: 29 of 29** (`outbox/bsd-game-join-aliases-live-latest.json`, run 40625311405 on `226143b`, record `dca3f5b`).
  Coverage in the artifact: `7 dates, 751 context rows read, 294 soccer rows, 292 carrying an id`.
  - 27 of 27 proposed rows carry the event the measurement named; 3 of 3 one-side-only rows carry theirs; 2 of 2 rows BSD has no
    event for still carry none. The expectation is read from the before-measurement, which the rule did not make.
  - The five rows named in the CC-CMD (Alavés v Atlético, Barcelona v Getafe, Augsburg v Bayern, Paderborn v Stuttgart, Monaco v
    Toulouse) are all joined.
  - 292 of 292 joined rows name the teams of their event, in order, 0 unjudged. The deployed relay serves the id the offline rule
    gives on 292 of 292 fixture rows it joins.
  - No event is claimed by two rows of one id scheme; 52 events are shared by two rows under the two id schemes (ESPN-form and
    slug-form), counted. 0 of 457 non-soccer rows carry an id. Every served row's key set is the fixture's plus `bsd_event_id`.
- **Read independently of the relay** (Cloudflare D1 on ARCHIVE_DB, read after the run at 03:12Z): per date `soccer rows / with id` = 45/44, 40/40,
  53/53, 50/50, 28/28, 48/47, 30/30, the same as the artifact. `change_log` rows with source `bsd_game_join`: 48 at 02:24Z
  (the laboratory's 10-10 run) and 244 at 03:12Z, 244 = 5+44+40+50+28+47+30, the first-call column. 0 non-soccer rows carry an id.
  Distinct ids 240 against 292 rows: the 52 shared events.
- **Existing behaviour unchanged** (`outbox/bsd-join-aliases-identity-checks.txt`): the five identity checks exit 0 before and
  after with equal assertion counts (the pair count rises 363 → 372, the nine additions); `check-bsd-game-join.mjs --offline`
  20 of 20 before and after; of 1550 names probed, exactly nine keys changed, the nine added variants.
- Deploy RELAY Worker run 40624401500 on `d001630`: success. Local dry run of 101 deploy.yml steps before the push: 101 passed.

## What was built

- `scripts/measure-bsd-game-join.mjs` (`ffee86b`): per date and label, `joined N of M`, each unmatched row with the BSD events in
  its kickoff window whose names look alike and that no other row has claimed. A reviewer's aid; nothing in `src/` reads it. 12
  self-tests including a claimed-event case that would otherwise be offered.
- Nine pairs in `src/identity-resolver.js` (`35146db`), archive form canonical so archive keys do not move: Deportivo Alavés,
  FC Barcelona, FC Augsburg, VfB Stuttgart, AS Monaco, AC Milan, Málaga CF, Olympique de Marseille, Stade Rennais.
- `scripts/capture-bsd-game-join-fixture.mjs --out` and `bsd-game-join-fixture-dates.yml` (`4de1b0c`): the first fixture file is
  not overwritten.
- `scripts/check-bsd-game-join-aliases-live.mjs`, `scripts/lib/bsd-join-aliases-oracle.mjs`, `bsd-game-join-aliases-verify.yml`
  (`359679f`). 13 stub modes, each breaking one assertion on purpose; the good mode runs 29 assertions.

## Unresolved, named

- `2026-09-12-mls-sd-phi` San Diego FC v Philadelphia Union and `2026-10-24-mls-lafc-la` Los Angeles Football Club v LA Galaxy:
  BSD has no event with those clubs on those dates or the next day (searched in the fixture: only San Diego Wave FC and unrelated
  fixtures). An alias cannot fix a missing event; the rows stay unjoined and the cards say so.

## What this does not prove

- Seven dates, not a season. Clubs promoted or loaned in after 2026-10-28 are not in it. MLS and five European labels only. A date
  nobody has captured is unmeasured.
- 70 of the 292 joined rows have no `start_time`, so the kickoff refusal could not judge them (the route's `unjudgedKickoff`:
  15 from the laboratory's 10-10 run, 55 from the first calls here; counted, not passed). They are joined on names alone, with exactly one candidate, and the teams-in-order check holds.
- The "before" column is the offline rule, not the relay's earlier state.

## Process note

Relay main was red when this was ready to push: another session's `scripts/bsd-ws-capture.mjs` broke the
absence-collapse ratchet (22 > 21) and the aggregate-launders check. This session did not edit that file, held the push (it touches
`src/` and deploys), told the owning session the two lines, and pushed after its fixes at `e89004d` and a 101-step local dry run.
