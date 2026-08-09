# CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap — Result

## Status: DONE. Candidate 2 confirmed, candidates 1 and 3 refuted. No fix applied, per scope.

Method: `scripts/archive-gap-probe.mjs` run on a GitHub runner
(`.github/workflows/archive-gap-probe.yml`). The discriminating queries
need `POST /d1/execute`; `probe_relay_route` is GET-only and this
sandbox's proxy 403s `*.workers.dev`. Read-only — SELECTs exclusively.
Raw logs: `outbox/archive-gap-probe-20260808T231053Z.log`,
`…T231223Z.log`, `…T231543Z.log`.

## Task 1 — the gap is still real

Re-queried fresh rather than trusting the doc's snapshot. Still real,
and **wider than the doc recorded** — it is three days, not two:

```
2026-08-04   MLB n=15  WNBA n=1     created 2026-08-04 10:00:57 .. 10:01:08
2026-08-05   (nothing)
2026-08-06   (nothing)
2026-08-07   MLB n=15  WNBA n=3     created 2026-08-08 13:46:08 .. 13:46:48
2026-08-08   MLB n=15  WNBA n=3
```

2026-08-07 is in the doc's own table as a healthy day (`MLB:15`), and by
row count it is. But its rows were **created on 2026-08-08 at 13:46** —
a day late, by the yesterday-catchup path. Same-day archival did not run
on 08-07 either. The doc's snapshot was taken after that catchup landed,
which is why 08-07 looked fine.

## Task 2 — the evidence, and what each candidate does with it

**Candidate 3 (mislabeled sport) — REFUTED.** Pass A enumerated every
distinct `sport` per date straight from `regular_season_games` and
`postseason_games` with **no sport predicate at all**. On 2026-08-05 and
2026-08-06, `regular_season_games` holds **zero rows under any label**.
There is nothing being filtered away by `/context/date/`, because there
is nothing there.

(Pass D did surface a real sport/league disagreement on those dates —
23 MLS rows carrying `sport=MLS, league='Leagues Cup'`. That is a
separate, pre-existing labeling question about Leagues Cup, not the
MLB/WNBA gap, and it is not this CC-CMD's subject.)

**Candidate 1 (the cron didn't run) — REFUTED.** Pass E shows the cycle
alive throughout. Slate briefs on 2026-08-06 00:38, 08-07 03:00, 08-08
03:00. MLS `game_brief` rows every single day including both gap dates.
Live `mlb_game` briefs on 08-06 from 00:38 through 15:06. The cron ran.

**Candidate 2 (the ESPN fetch failed for those slugs) — CONFIRMED.** The
split is exactly along data source:

| source | 08-05 | 08-06 | 08-07 | resumes |
|---|---|---|---|---|
| ESPN-fed (MLB, WNBA `game_recap` + games rows) | none | none | none (until catchup) | 08-08 13:46 |
| non-ESPN (MLS `game_brief`, slate) | present | present | present | never stopped |

`change_log` corroborates independently: 1063 entries on 08-03, 16 on
08-04, **zero on 08-05, 08-06 and 08-07**, then 21 on 08-08.

The last ESPN-sourced write before the outage is an `mlb_game` brief at
**2026-08-06 15:06**. The recorded start of the ESPN-403 incident is
**2026-08-06 15:22**. Sixteen minutes apart.

## Task 3 — correlation with the ESPN-403 window, stated honestly

The 403 incident explains 08-06-afternoon onward and the 08-08 recovery
cleanly. **It does not explain 2026-08-05.** The daily archive pass for
08-05 would have run around 08-05 10:00 and its catchup around 08-06
10:00, both comfortably before 15:22. So either the 403 began earlier
than the incident record states, or a second cause overlaps it.

Flagging that rather than smoothing it into the 403 story. The
convenient reading — "all of it was the 403, already fixed" — is not
what the timestamps support, and accepting it would leave a still-open
failure undiagnosed.

## Recommended next step (scoped, NOT built here)

Two distinct pieces of work, neither in this CC-CMD's scope:

1. **Backfill 2026-08-05 and 2026-08-06.** These dates will never
   self-heal: the catchup path only reaches yesterday, and they are now
   days old. `/archive/backfill` and `/archive/score-by-id` already
   exist — this is a bounded, date-ranged invocation, not new code.
   08-07 recovered on its own and needs nothing.
2. **Diagnose the 2026-08-05 miss specifically.** It predates the
   recorded 403 window. Worth its own CC-CMD, because if it is a
   separate failure mode it is still live.

Both are written up as follow-on CC-CMDs rather than left as
carry-forwards (Rule 87).

## One defect found in my own probe, disclosed

Pass F first queried `change_log.created_at` and returned
`D1_ERROR: no such column: created_at`. I had assumed the column name by
analogy with the games and briefs tables. The real schema
(`src/sync-reconciler.js`) names it `ts`. Fixed and re-run rather than
dropped — the corrected pass produced the corroborating evidence quoted
above, so dropping it would have cost a real finding.

## Confidence gate

**96.** Candidate 2 confirmed and candidates 1 and 3 refuted from raw D1 reads with a working control, corroborated independently by `change_log`. Held below 98 precisely because the 2026-08-05 miss remains unexplained -- it predates the recorded 403 window by more than a day, and I flagged that rather than widening the window to fit, which would have been the Rule 77 failure.

*(Backfilled 2026-08-09. The score was stated in session at execution time but never written into this doc. Chat is ephemeral; this file is the record, and a gate that exists only in scrollback is not a gate.)*
