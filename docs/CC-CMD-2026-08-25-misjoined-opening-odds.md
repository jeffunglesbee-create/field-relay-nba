# CC-CMD-2026-08-25-misjoined-opening-odds

**Filed from:** field-laboratory, from a 60-day census.
**Ask to:** field-relay-nba.
**Status:** OPEN.

## Three MLB rows hold odds from another sport and another moment

`MLB_2026-06-28_cardinals_marlins`, probed 2026-08-25 via `/context/game`:

```json
"opening_odds": {"source":"draftkings","captured_at":"2026-06-28T20:35:24.440Z",
  "moneyline":{"home":-1940,"away":780},
  "spread":{"home":1.5,"away":-1.5},
  "total":{"over":3.5,"under":3.5}}
"created_at":"2026-06-28 20:35:22","finalized_at":"2026-06-28 20:35:22"
"home":"Cardinals","away":"Marlins","home_score":2,"away_score":1
"venue":"Busch Stadium","espn_event_id":"401815947"
```

Three independent signals, each sufficient:

1. **A total of 3.5.** MLB totals run 7 to 11 — the 2026-08-25 slate served
   7.5, 8.5, 9, 9.5 and 10.5. A 3.5 total is a soccer or hockey market.
2. **`captured_at` equals `finalized_at` to within two seconds.** These are not
   opening odds. They were written at the instant the row was finalised, with
   the 2-1 final already known.
3. **No `_oddsProof`.** Every current row carries
   `{"adapterId":"odds-api","sourceId":"odds-api-the-odds-api"}`. These do not.

The other two, same date, same shape:

```
MLB_2026-06-28_giants_braves   ML -1320/+640  H +1.5
MLB_2026-06-28_twins_rockies   ML  -780/+462  H +1.5
```

Found because all three surfaced as `favouriteAgreement` disagreements at
separation ratios of 11–13× the vig, far outside anything a real baseball
market produces. The laboratory's rubric caught them; it could not explain them.

## The ask

1. **Probe first, and get the scale.** Do not write from this document.
   ```sql
   SELECT id, date, sport, json_extract(opening_odds,'$.total.over') AS tot,
          json_extract(opening_odds,'$.moneyline.home') AS mlh,
          created_at, finalized_at
   FROM regular_season_games
   WHERE sport='MLB' AND opening_odds IS NOT NULL
     AND CAST(json_extract(opening_odds,'$.total.over') AS REAL) < 5;
   ```
   Three rows are known. The count is not. Paste it.

2. **Identify the writer.** These rows have no `_oddsProof`, so they predate
   that marker — the question is which path wrote them and whether it still
   runs. If it does, this is live. If it does not, this is historical and the
   ask becomes step 4 alone.

3. **If the path is live, fix the join.** A `captured_at` equal to
   `finalized_at` means an odds write is happening at completion time, which
   `opening_odds` by definition should not.

4. **Guard it.** A deploy gate, or an assertion in the odds writer: a stored
   `opening_odds` whose `total.over` is outside the sport's plausible range is
   refused rather than written. MLB is 5–15. This is the cheapest possible
   check and it would have refused all three.

## Done condition

Not a green deploy. The row count from step 1, verbatim; a named writer from
step 2; and — if step 3 applies — a `/context/date` probe after one cron cycle
showing no MLB row with a sub-5 total. If the count from step 1 is exactly the
three known rows and the writer no longer runs, say so and close at step 4.

## Scope boundary

Do **not** correct the three rows' data. There is no source to correct them
from, and inventing plausible odds is the fabrication this project refuses.
Deleting the `opening_odds` value on a row whose odds are known-wrong is a
separate decision and needs the human, like the PGA Tour rows.
