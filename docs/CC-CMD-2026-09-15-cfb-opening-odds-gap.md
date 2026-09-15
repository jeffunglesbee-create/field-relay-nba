# CC-CMD-2026-09-15 — 177 CFB games since 2026-09-01 have no odds at all

**Status:** **CAUSE FOUND 2026-09-15.** Premises 1 and 2 both refuted the
framing they were written in. Split out of
`CC-CMD-2026-09-15-odds-backfill-missing-api-key` Task 3 under Rule 87.4.

## THE CAUSE — a fourth sport-key registry

Premise 1 asked whether the vendor offers CFB. **Wrong party.** It does:
`ARCHIVE_SPORT_TO_ODDS_KEY` carries `cfb: 'americanfootball_ncaaf'`, and `nfl`,
`cfl`, `ufl` besides.

`.github/scripts/odds-backfill.js:48` declares its **own** `SPORT_TO_ODDS_KEY`
with eight entries — MLB, NBA, NHL, WNBA, two FIFA WC aliases, EPL, MLS. It
imports nothing from `src/odds-sport-keys.js` and contains no American football
key of any kind. Every CFB game is dropped at the candidate filter (line 278)
before one fetch is issued.

`src/odds-sport-keys.js` calls itself *"the one place a sport's Odds API key is
written down"* and documents three tables (ARCHIVE 16, CRON 6, AMBIENT 11).
This is a fourth, in a directory that file does not look at. Its own header
says of this very symptom:

> "MLS, Bundesliga, CFB and NFL resolve through these tables and still receive
> nothing; **the cause is downstream of every table here.**"

A prior session checked the three *documented* registries, found CFB present,
and concluded the cause was downstream. It was upstream, in the registry that
runs rather than the one that is written down.

**Premise 2, same command:** `git log -L48,57` shows those eight entries were
written on **2026-06-20** and never touched since — 73 days before the outage
began. The gap is structural and predates the dead cron entirely.

## Measured (run `35014093789`, `scripts/check-backfill-registry-coverage.mjs`)

10 archive sports the backfill cannot name: la liga, ligue 1, bundesliga,
serie a, cfl, cfb, nfl, ufl, afl, ipl.

| sport | games | null | reachable? |
|---|---:|---:|---|
| mls | 310 | 247 | CAN fetch |
| mlb | 201 | **0** | CAN fetch |
| cfb | 177 | 177 | **STRANDED** |
| la liga | 24 | 10 | STRANDED |
| serie a | 20 | 4 | STRANDED |
| epl | 20 | 2 | CAN fetch |
| uefa champions league | 18 | 18 | no key in either table |
| ligue 1 | 18 | 7 | STRANDED |
| bundesliga | 18 | 18 | STRANDED |
| nfl | 16 | 16 | STRANDED |
| efl cup | 11 | 11 | no key in either table |
| cfl | 8 | 1 | STRANDED |
| efl trophy | 7 | 7 | no key in either table |

**`mlb 201 games / 0 null` is the control.** Where the backfill has a key and
the vendor has data, coverage is complete. The pipeline works; the table is the
defect.

## The 532 fully decomposed (518 regular + 14 postseason)

| cause | n | fixable? |
|---|---:|---|
| registry gap — 10 stranded sports | **233** | yes, by adding keys — **budget decision** |
| MLS-labelled cup fixtures, vendor has no data | 247 | no (CC-CMD-2026-09-14) |
| UCL / EFL Cup / EFL Trophy — no key in either table | 36 | needs a key in BOTH tables; vendor coverage UNVERIFIED |
| postseason cups — NOT OFFERED | 14 | no (CC-CMD-2026-09-14) |
| EPL, reachable, ordinary misses | 2 | — |

**The outage caused none of it.** The catch-up recovered 0 because nothing was
recoverable; every gap here is structural and older than the dead cron.

## A second defect found on the way

`odds-backfill.js:389` counts `no_mappable_sports` toward `datesDone`. A date
whose games are all unmappable is recorded **complete**, which is why the
catch-up reported "all dates complete" while leaving 532 games untouched. The
completion criterion cannot distinguish "fetched everything" from "asked for
nothing." Same absence-collapse shape as Rule 99.

## What is NOT done, and why it is not a carry-forward

`src/odds-sport-keys.js` records that widening a registry is a budget decision,
not a code cleanup, so the keys are not added here. But the size of that
decision was quoted from a header comment rather than measured, and measuring
it changes the answer.

### Measured (run `35017010215`)

`PER_CALL_COST = 20` (odds-backfill.js:35 — 10 credits × 2 markets, regions=us),
billed **once per sport-date, not per game**. CFB's 177 games sit on ~15 dates;
177 games cost exactly what 15 would.

| | pairs | credits |
|---|---:|---:|
| one-time, every archived date | 175 | **3,500** |
| one-time, dates ≥ 2026-09-01 | 48 | 960 |
| ongoing, last 14 complete days | 47 | 940 |
| **ongoing, per-day run rate** | 3.4 | **67/day** |

### The framing this corrects

An earlier draft of this document said *"39,534 remaining, ~15 days left,
2,700/day budget — roughly break-even already."* That compared the budget
**ceiling** against remaining headroom, not actual burn against it. Actual
steady-state spend is ~80 credits/day (odds-backfill.js:15). Adding all ten
sports takes it to ~147/day against ~2,636/day available — **5.6% of headroom,
not break-even.**

The full historical catch-up, 3,500 credits, is 8.9% of what is left this month.
Both together are ~11%.

**This is cheap.** It is still the owner's call, as the empty `ODDS_API_KEY`
was — but it should be decided against 67/day, not against the alarm the
earlier draft raised.

### It splits into two decisions, and the cheap half stands alone

1. **Add the ten keys** — costs only the recurring ~67/day, fixes coverage
   going forward. Does NOT recover one historical row.
2. **Reset `odds_backfill_progress` for the affected dates and re-run** —
   costs the one-time 3,500, recovers the 233 historical nulls. Needed because
   `odds-backfill.js:389` counts `no_mappable_sports` toward `datesDone`, so
   every past date is already recorded complete and adding keys alone
   backfills nothing.

`scripts/check-backfill-registry-coverage.mjs` fails while any archive sport is
unreachable, so the gap cannot widen unnoticed while the decision is pending.

## Measured

Run `35013308603`, `scripts/measure-backfill-outage-cost.mjs`, head `da80809`.
Games dated ≥ 2026-09-01 with `opening_odds IS NULL` **and** no `odds_history`
row, by league:

| league | n |
|---:|---:|
| MLS | 247 |
| **CFB** | **177** |
| UEFA Champions League | 18 |
| Bundesliga | 18 |
| NFL | 16 |
| EFL Cup | 11 |
| La Liga | 10 |
| Ligue 1 | 7 |
| EFL Trophy | 7 |
| Serie A | 4 |
| EPL | 2 |
| CFL | 1 |

Postseason resolves completely and is **not** part of this question: TELUS
Canadian Championship 10, U.S. Open Cup 2, Campeones Cup 2 — 14 of 14 already
established as **NOT OFFERED** by the vendor in
`CC-CMD-2026-09-14-cup-competitions-under-mls`.

## Why CFB is the one worth asking about — and the bullet in it that was wrong

Every other large bucket has a candidate explanation on file. CFB does not.

- **MLS 247** — consistent in size with the 243 cup fixtures that
  CC-CMD-2026-09-14 carries under `sport='MLS'`. NOT PROVEN to be the same
  rows; that is its own small task, not this one.
- ~~**The European leagues** — UCL, Bundesliga, La Liga, Ligue 1, Serie A, EPL
  are all vendor-offered, and the counts are small enough to be ordinary
  per-date misses.~~ **WRONG, refuted by run `35014093789` an hour after it was
  written.** Bundesliga, La Liga, Ligue 1 and Serie A are STRANDED by the same
  fourth registry as CFB — 39 nulls between them, not noise. UCL has no key in
  *either* table. Only EPL (2) was the ordinary miss this bullet described.
  The error was reading small counts as a different KIND of cause; they are the
  same cause with fewer fixtures in the window.
- **CFB 177** — the vendor does list American college football. 177 games in a
  fifteen-day window is not a rounding error, and the backfill's own catch-up
  run (`35012183015`) reported `games=19` across all 22 dates, so whatever it
  fetched, it was not these.

## The premises — how each one landed

1. ~~**"The vendor offers CFB."**~~ **REFUTED AS A QUESTION.** It does, and that
   was never the constraint. The framing pointed at the vendor when the answer
   was in an eight-line map in this repo. The cheapest command was not the one
   this premise named.
2. ~~**"These 177 are in the outage window for a reason."**~~ **CONFIRMED
   STRUCTURAL.** `git log -L48,57:.github/scripts/odds-backfill.js` — the map
   dates to 2026-06-20, untouched, 73 days before the outage.
3. ~~**"`odds_backfill_progress` thinks these dates are done."**~~ **CONFIRMED,
   and it is a real second defect.** `odds-backfill.js:389` counts
   `no_mappable_sports` toward `datesDone`. See above.
4. ~~**"CFB label matches what the odds lookup keys on."**~~ **This was the
   right instinct aimed one table too far downstream.** It is a registry
   mismatch — but between the backfill's private map and the canonical one, not
   between a label and a key.

The note that "premise 4 is the one to take seriously" was the closest call and
still missed, because it assumed the registries in `src/` were the registries in
play. Enumerating premises does not help if every one of them shares an
unstated assumption — here, that `src/odds-sport-keys.js` was authoritative
because it says it is.

## Done condition — MET

> "N of 177 are explained by X, measured by <command>."

**177 of 177 CFB nulls are explained by `.github/scripts/odds-backfill.js:48`
omitting any American football key**, measured by
`scripts/check-backfill-registry-coverage.mjs` (run `35014093789`), with
`mlb 201/0 null` in the same output as the control showing the pipeline works
wherever a key exists.

The remainder is declared, not fixed: 233 nulls across 10 stranded sports are
fixable only by a metered-credit decision that belongs to the owner.

## Scope boundary

Read-only until the cause is named. No D1 writes, no re-fetch, no relabelling.
The 177 rows are not modified by this investigation.
