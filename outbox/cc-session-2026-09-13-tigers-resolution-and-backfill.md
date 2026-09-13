# CC session 2026-09-13 — the `Tigers` collision, and the backfill it left behind

CC-CMD: `docs/CC-CMD-2026-09-13-alias-table-silent-overwrite.md`

## What was wrong

`resolveTeamKey("Tigers")` returned `hullcity`. Detroit's nickname and Hull
City's are the same word; the alias table maps variant to canonical and cannot
hold a variant that means two things, so it answered by file order.
`['Tigers','Hull City']` landed 2026-08-21 (`0faf37f`) below
`['Tigers','Detroit Tigers']` and took its slot. Every Detroit Tigers game
missed the odds join from that day, writing nothing and logging nothing.

**Nobody chose Hull City.** "Which club should `Tigers` mean?" has no right
answer — both are right in their own sport — so any fix that answers it is
choosing a different coin to flip.

## The fix (`e6f57b1`)

1. **The builder records the collision** instead of overwriting, and removes the
   key, so `resolveEntity`'s existing `map[k] || k` falls through to the bare
   fold: `Tigers` -> `tigers`. An honest unknown can miss a join; it can never
   assert a team that was not named.

2. **The join resolves ambiguity from the payload it already holds.** Every odds
   join indexes the vendor's names — unambiguous full names, one sport per
   response — BEFORE reading a D1 row. `resolveTeamKeyIn(name, vendorKeys)`
   takes a key SET, not a `sport` string: a sport parameter would need threading
   through call sites that have none, and would trust the archive's `sport`
   column, which is known dirty. The payload is neither absent nor dirty.

   The guarantee is structural: the only keys it can return are keys this
   response contains, so a baseball row cannot become an English football club
   however the table is edited later.

Scope: 1 key of 269. 18 names pinned by hand prove nothing else moved.

## Verified live

Same archive both runs (3237 rows); only the deploy differed.

| condition | 12:28 | 13:15 |
|---|---|---|
| `hullcity` claimed by one family | OPEN — soccer(6, Hull) + MLB(69, Tigers) | **DONE** |
| `ambiguous_key_count` | 12 | **11** |

Vendor side the same day: `Detroit Tigers` -> `detroittigers|coloradorockies`,
which is exactly the key the archive side now produces.

## The backfill — sized before it was run, and that mattered

The regression window's rows do not self-heal: `snapshotCronOdds` only ever
works on today's date.

`/archive/odds-backfill` has **no dry-run** and fetches one historical payload
**per sport per date** at ~30 credits. So the census gained a read-only
`odds_gaps` report (`73dee59`) — the backfill's own input — before anything was
spent.

| slice | pairs | rows | credits |
|---|---|---|---|
| TOTAL archive | 458 | 1685 | 13,740 |
| future dates (not yet played) | 29 | 213 | 870 |
| CFB, past (blocked on the sport-blind fix) | 9 | 185 | 270 |
| other sports, past | 389 | 1154 | 11,670 |
| **MLB, 2026-08-21..today — the approved scope** | **19** | **30** | **3,150** |

**The naive estimate for the approved scope was 570 credits (19 x 30). The true
cost is 3,150 — 5.5x higher, and above the day's remaining 2,742** — because the
route fills every sport on a date, not the one the request is about. Running the
approval blind would have hit the ceiling partway and left a partial,
undocumented backfill.

### Tranche 1, run 2026-09-13, ordered by MLB rows recovered per credit

`2026-09-02, 09-01, 08-24, 09-04, 09-11, 08-31, 09-07, 09-08`

Measured, from two independent watch artifacts before and after — not from the
route's own `odds_populated`:

```
date          all sports        MLB
2026-08-24      4 -> 3          1 -> 0
2026-08-31      4 -> 3          1 -> 0
2026-09-01      4 -> 3          1 -> 0
2026-09-02     12 -> 1         11 -> 0
2026-09-04     14 -> 11         2 -> 0
2026-09-07      4 -> 2          1 -> 0
2026-09-08     14 -> 13         1 -> 0
2026-09-11      7 -> 6          1 -> 0
                63 -> 42       19 -> 0
```

21 rows filled. Archive-wide NULL-odds rows 1685 -> 1664.
Budget: daily used 1058 -> 1951 = **893 credits** against an 840 estimate (the
delta is cron traffic in the same window). 1849 left on the day.

### Tranche 2, run 2026-09-13 under an owner-approved one-day grant

The remaining 11 dates could not start when approved: at 15:39Z the daily
ceiling was exhausted, 3800 of 3800. Provider quota was never the constraint —
47,245 requests remained. The 3800 is a self-imposed guard.

**2500 additional credits were granted for the day.** Not by raising
ODDS_DAILY_CEILING and lowering it back — that leaves a permanently disabled
guard the moment the second deploy is skipped, and a guard that quietly stopped
guarding is worse than none because the number still looks deliberate. The grant
carries its own date (`ODDS_CEILING_GRANTS`), so on any other date it
contributes nothing and expires with no action required. Thirteen assertions and
six mutations hold that, including one that raises the standing constant instead
and must be refused.

Measured from two independent watch artifacts either side of the run:

```
date          all sports        MLB
2026-08-22      24 -> 17        1 -> 0
2026-08-23      18 -> 15        1 -> 0
2026-08-25      24 -> 23        1 -> 0
2026-08-26      13 -> 12        1 -> 0
2026-08-28      16 -> 15        1 -> 0
2026-08-29      28 -> 20        1 -> 0
2026-08-30      20 -> 16        1 -> 0
2026-09-05      86 -> 85        1 -> 0
2026-09-06      16 -> 15        1 -> 0
2026-09-09      13 -> 12        1 -> 0
2026-09-12     100 -> 96        1 -> 0
               358 -> 326       11 -> 0
```

32 rows filled. Archive-wide NULL-odds rows 1664 -> 1632.
Grant used: **2330 of 2500**, leaving 170. Daily 6130/6300 at close.

**The estimate was high on cheap dates and close on expensive ones.** The first
four cost 390 against a 630 projection, because a date's sports that have no
Odds-API key mapping are skipped at no cost — the per-sport-per-date model
prices them anyway. Running in cost order with a budget re-check between batches
is what kept this inside the envelope instead of discovering the ceiling
part-way, which is the failure the sizing existed to prevent.

### Both tranches together

19 dates, 53 rows, and **every MLB row in the 2026-08-21..09-13 window now
carries odds**. The coverage gap the alias collision opened is closed end to
end: the resolver fixed, forward coverage proven by a live cron write eight
minutes after deploy, and the backlog filled.

### What was NOT backfilled, deliberately

- **Future fixtures.** A historical odds snapshot for an unplayed game is
  meaningless; the live cron fills these at kickoff.
- **CFB, 185 rows.** Still blocked on the sport-blind resolver fix. The join
  would re-run and still miss on the bare-city aliases, so the credits buy
  almost nothing until `CC-CMD-2026-09-13-team-key-sport-blind` Task 2 lands.

### Why the remainder was never wired to a cron

A live mutation of archive rows is authorised case by case and **never wired to
a cron by a session**. "Approved" is not "schedulable": the approval covered a
batch, and a cron re-deciding each morning whether to mutate the archive would be
a session converting one approval into a standing permission.

So `odds-backfill-readiness.yml` automated the SIGNAL and not the act — it
priced the remaining dates daily and named them, and a person ran them. With
nothing pending it has been deleted, as its own header instructed; its final
artifact (`odds-backfill-readiness-20260913T160236Z.json`, 0 pending, 0 cost) is
the record. The census's `odds_gaps` is the durable capability; the workflow was
scaffolding around one approved batch.

**Two slices that must NOT be backfilled, and would have been by a date range:**

- **Future dates (870 credits).** Fixtures not yet played. A historical odds
  snapshot for a future date is meaningless; the live cron fills these at
  kickoff.
- **CFB (270 credits, 185 rows).** Still blocked on the sport-blind resolver
  fix. The join would re-run and still miss on the bare-city aliases, so the
  credits buy almost nothing until `CC-CMD-2026-09-13-team-key-sport-blind`
  Task 2 lands.

## Guards added

| script | what it holds |
|---|---|
| `check-ambiguous-team-identity.mjs` | 39 assertions, 7 mutations — the collision is recorded, the payload decides, 18 names unmoved |
| `check-identity-table-collisions.mjs` | every pair in every table: 333 across 5, exactly 1 collision, 0 silent — 3 mutations |
| `check-team-key-substitution.mjs` | 56 assertions, 22 mutations — now including the gap report |

**The old guard was requiring the bug.** `check-team-identity-collisions.mjs`
had `['Tigers','Hull City']` in its MUST_MATCH list: it did not miss the
regression, it demanded it. And its sibling asserts over a curated list that
`Tigers` was not on — which is why the new census reads every pair instead.

## Three defects in this session's own checks

1. **Section C re-implemented the join** to exercise it, so mutation N5 broke the
   real `findOddsForRow` and the check stayed green. It was verifying a copy and
   reporting on the source. `src/odds-join.js` exists because of this.
2. **Section D diffed against `git show HEAD:`**, which silently becomes a no-op
   once the fix IS HEAD — in CI it would have compared the file to itself and
   passed while asserting nothing. Replaced with 18 hand-pinned names.
3. **The first `Tigers` count assertion** counted occurrences, not distinct
   names, so it failed on a variant listed twice — which is the very thing that
   makes it collide.

## Task 1 — CONFIRMED, and the first answer was wrong

`outbox/tigers-forensics-20260913T143322Z.json`. 69 rows named `Tigers`, 52 with
opening odds, every one accounted for by a write outside the regression window:

```
written before the alias flip        41
written after the fix (live cron)     1
backfilled after the fix (tranche 1) 10
UNACCOUNTED FOR                       0
```

**The first run returned REFUTED.** It classified rows by GAME DATE inside the
window — the date of play standing in for the moment of writing. Ten of its
eleven rows were dates I had backfilled by hand three hours earlier, after the
fix: my own work read back as evidence of a defect. The eleventh was captured at
`2026-08-21T10:00:53Z`, thirteen hours before `0faf37f` landed at `23:17:42Z`.

I had written `captured_at IS NOT A WRITE TIME` into the source two commits
earlier and then reached for a date further from the write than `captured_at`
is. The wrong artifact was deleted rather than left beside the right one — an
outbox file saying REFUTED is read as a finding by whoever opens it next.

The corrected discriminator needs no memory of what anyone ran: a historical
backfill requests noon UTC on the game's own date, so its stamp lands within
minutes of it; a live capture does not.

## The end-to-end proof arrived, unprompted

The fix commit could not claim Rule 61 — I wrote "I have not observed the live
cron attach odds to a Detroit row", because `d1_missing` was 0 for MLB that
afternoon and there was nothing to watch fill.

It is in the Task 1 artifact. `MLB_2026-09-13_e401816920` — Comerica Park, a
Detroit home game — carries `opening_odds.captured_at`
**`2026-09-13T13:16:54Z`**, a live cron write **eight minutes after the fix
deployed at ~13:09Z**.

Not "the key looks right". The market data arrived, through the repaired join,
on the team the bug had silenced for three weeks.

## Task 5 restated, because the fix was not the shape the condition assumed

The done condition asked for "Detroit Tigers rows resolving to `detroittigers`".
All 69 resolve to `tigers`, deliberately — the resolver refuses to name either
club standalone and the payload decides at join time. A condition requiring
`detroittigers` presumes a fix that picks a winner, which Task 3 rejected.

Restated as: `hullcity` claimed by one family (watch artifacts either side of
the deploy, identical archive both runs), AND a Detroit game receiving odds
through the repaired join (above). Both met.

Worth keeping as a pattern rather than an excuse: **a done condition written
before the fix can encode an assumption about the fix.** This one did, and a
session reading it literally would either have mis-implemented the resolver to
satisfy it, or declared the task unfinished while the real requirement was met.

## A CC-CMD I filed and retracted, and why it is recorded rather than deleted

I read `/budget/odds` beside the provider dashboard and filed
`CC-CMD-2026-09-13-odds-ledger-undercounts` claiming the relay's monthly ledger
undercounted real spend by 16,506 — a third — and that a second error in the
configured `limit` was masking it.

**Both halves were wrong, and the source says so in a comment ten lines above
the constant.** `src/budget-helpers.js:86`:

> 100 K paid plan minus 15 K reserved for special projects

So `limit = 85000` is the relay's deliberate SHARE of a 100,000 plan, and
`monthly.used` counts RELAY spend only. The provider counts everything. The
difference is special-project consumption that the relay correctly does not
track. Nothing was broken; the two numbers measure different scopes and both are
right.

**How I got there is the part worth keeping.** I compared two fields of a JSON
response and reasoned about their relationship without reading the function that
produces them. That is reading a copy instead of the source — the exact
substitution this session built three guards against, committed while writing
about it. The rule was in my hands the whole time and I applied it to identity
keys and not to a budget field, because the budget field did not look like code.

The CC-CMD is deleted rather than struck: unlike the sport-blind premise
correction, it had no surviving work, and an actionable-looking spec built on a
false premise is worse in `docs/` than absent. The reasoning lives here instead.

## One real question the retraction leaves

Neither source reports it, so it is derived:

```
provider (all spend)      50,958
relay ledger (relay only) 34,452
                          ------
non-relay spend           16,506   against a 15,000 reserve
```

Special projects appear to be ~1,500 over their reserve, eating into the relay's
85,000. **But that figure is only sound if every relay call increments the
ledger** — if any bypass it, the relay's own spend is understated and the
"non-relay" residual is inflated by the same amount. I cannot separate those
from outside, and did not guess. Raising it as a number to check, not a finding.

## Carry-forward

- `CC-CMD-2026-09-13-alias-table-silent-overwrite`: **CLOSED.** All six tasks
  done; Task 1 proven per row, 0 unaccounted for.
- `CC-CMD-2026-09-13-team-key-sport-blind` Tasks 2-6 open; 185 CFB rows wait on
  it.
- `CC-CMD-2026-09-13-probe-commit-race-unrecoverable` open.
- Backfill: **COMPLETE.** Both tranches run, 19 dates, 53 rows, every MLB row
  in the regression window now carries odds.
