# CC-CMD-2026-08-25-misjoined-opening-odds

> **The name is now wrong and is kept for its links.** These rows are not
> misjoined from another event. They are the RIGHT event's odds, captured after
> it finished.

**Filed from:** field-laboratory, from a 60-day census.
**Ask to:** field-relay-nba.
**Status:** OPEN, and **substantially rewritten 2026-08-25** after a 90-day
census. The original title and premise were both wrong; they are corrected
below rather than quietly replaced.

## CORRECTED: ~156 rows hold IN-PLAY odds, not another sport's

**What this document originally claimed:** three MLB rows on 2026-06-28 carry
odds from another sport, evidenced by a total of 3.5 where MLB runs 7-11.

**Both halves were wrong.** A 90-day census over 789 games with a moneyline and
a balanced handicap (field-laboratory `favourite-band-census`, run 3):

```
totals outside their sport's own median range    1 of 789
opening odds captured at finalisation          156 of 789   (19.8%)
```

**One** total outlier, not three. And the second signal is the real finding:
nearly a fifth of the corpus has `opening_odds` written at the instant the row
was finalised.

### The decisive row

`MLB_2026-06-28_angels_athletics`, probed directly:

```
final:  Angels 4, Athletics 1        home won by 3; 5 runs total
odds:   moneyline  home -10000 / away +1360
        spread     home -2.5  / away +2.5
        total      5.5
        captured_at 2026-06-28T21:50:25.898Z
        finalized_at 2026-06-28 21:50:24
```

Every number describes the FINISHED GAME. `-10000` is the price of a settled
winner. A `2.5` handicap matches a three-run margin — and an MLB run line is
`±1.5` pre-game, never 2.5. A `5.5` total matches five runs scored.

These are in-play or settled odds stored in a column named `opening_odds`. The
`3.5` total on `cardinals_marlins` — which this document called "a soccer or
hockey market" — is a live total late in a game that finished 2-1. Same
explanation, no cross-sport contamination anywhere.

### The window

Every flagged row falls in **2026-06-23 → 2026-07-11**, a continuous block, plus
a single CFL row on 2026-08-15. Nothing before, nothing between, nothing after
except that one.

### Why it matters more than three rows did

Any consumer treating `opening_odds` as a pre-game line is wrong on a fifth of
the corpus. `OddsStory.Moved` compares opening against closing; where opening is
a settled price the movement is fiction. It also explains every extreme
moneyline the laboratory's `favouriteAgreement` flagged at 11-13x the vig.

## The original text, kept because it was wrong in a specific way

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

1. ~~**Probe first, and get the scale** via `POST /d1/execute`.~~ **DONE, and
   the credential was never needed.** `/context/date` serves `opening_odds`
   verbatim and publicly. 156 of 789, window 2026-06-23 → 2026-07-11 plus one
   CFL row on 2026-08-15. See `field-laboratory outbox/2026-08-25-odds-plausibility.md`.

   The remaining unknown is the DENOMINATOR inside the window: what fraction of
   rows dated 06-23 to 07-11 are affected. If it is nearly all of them, the
   capture path was wrong for that whole period rather than intermittently.

2. **Identify the writer.** These rows have no `_oddsProof`, so they predate
   that marker — the question is which path wrote them and whether it still
   runs. If it does, this is live. If it does not, this is historical and the
   ask becomes step 4 alone.

3. **If the path is live, fix the join.** A `captured_at` equal to
   `finalized_at` means an odds write is happening at completion time, which
   `opening_odds` by definition should not.

4. **Guard it — and the guard changed with the finding.** A total-range check
   would have caught ONE of 156 rows. The signal with teeth needs no range at
   all: **refuse to write `opening_odds` when the row already has a
   `finalized_at`, or when `captured_at` is within a minute of it.** An opening
   line written at completion is not an opening line, whatever the numbers say,
   and that test has no threshold to argue about.

## Done condition

Not a green deploy. A named writer from step 2; the in-window denominator from
step 1; and, after one cron cycle, a `favourite-band-census` run whose
`opening odds captured at finalisation` count does not grow.

The 156 existing rows are NOT expected to change — see the scope boundary.

## Scope boundary

Do **not** correct the 156 rows. There is no source of true opening lines for
games played two months ago, and inventing plausible odds is the fabrication
this project refuses. Nulling `opening_odds` on rows whose values are
known-not-opening is a separate decision and needs the human, like the PGA Tour
rows — and it has a real cost, since those values are a true record of the
market at THAT moment, just not the moment the column name claims.

A better answer than deletion may be to record the distinction: the rows are
identifiable by `captured_at ≈ finalized_at` with no schema change at all.
