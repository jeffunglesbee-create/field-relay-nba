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

### Remaining, and why it is NOT wired to a cron

11 dates, **2,310 credits**: `08-22, 08-23, 08-25, 08-26, 08-28, 08-29, 08-30,
09-05, 09-06, 09-09, 09-12`.

This is a live mutation of archive rows. The standing rule is that those are
authorised case by case by the user and **never wired to a cron by a session**,
so the remainder is left for an explicit go-ahead rather than scheduled. The
`odds_gaps` list makes the cost of that decision readable in advance, and the
watch re-reads it every 6 hours so the number cannot go stale.

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

- `CC-CMD-2026-09-13-alias-table-silent-overwrite`: Tasks 0, 2, 3, 4, 5 done.
  Task 1 (confirm the date story for all 68 rows) is now strongly supported —
  every MLB gap in the archive sat inside the regression window — but not
  exhaustively proven per row.
- `CC-CMD-2026-09-13-team-key-sport-blind` Tasks 2-6 open; 185 CFB rows wait on
  it.
- `CC-CMD-2026-09-13-probe-commit-race-unrecoverable` open.
- Backfill tranche 2 (11 dates, 2,310 credits) awaits an explicit go-ahead.
