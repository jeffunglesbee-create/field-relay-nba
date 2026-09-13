# CC session 2026-09-13 — `resolveTeamKey` is sport-blind: Task 0 and Task 1

CC-CMD: `docs/CC-CMD-2026-09-13-team-key-sport-blind.md`
Second CC-CMD filed this session: `docs/CC-CMD-2026-09-13-probe-commit-race-unrecoverable.md`

## HEAD progression

| commit | what |
|---|---|
| `1f2eec1` | Task 0 artifact — cross-sport substitution probe across 4 sports |
| `74cb0cb` | `/identity/substitution-census` + shared `substitutedKey` predicate |
| `207e104` | 35 assertions, 6 mutations, wired into `deploy.yml` |
| `a001dc8` | CC-CMD premise corrected, Task 1 respecified |
| `70d1e6e` | the named-rows list was capped at 100 without saying so |
| `c5b1a54` | cross-sport classification from the archive's own rows, no Odds credit |
| `443590c` | soccer is one sport across fourteen archive labels |
| `c8c7d11` | replaced a verdict the data cannot support with ambiguity |
| `65418e2` | `wnba`/`WNBA` case fold; pre-committed live expectation |
| `5014180` | re-anchor M12 after its target line was rewritten |
| `cae5a99` | second CC-CMD — the probe commit race |
| `0d2777c` | a key can be ambiguous without being a substitution (`richmond`) |

## The finding that reframed the CC-CMD

**The CC-CMD's premise was wrong.** It says the substituted keys "are written
into D1" and that the archive therefore asserts a college football game was
played by the Colorado Rapids. Checked at HEAD across all 20 `resolveTeamKey`
call sites (`src/index.js` 1218, 6597, 6610, 6739, 6748, 12987, 12989, 15038,
15049, 15078; `context-assembler.js` 449-461; `ambient-do.js` 822-825;
`wp-resolver.js` 62-63): **not one writes a key.** Every one builds a transient
`byPair` join key or compares two names. The games tables store display names;
the key is computed at join time and discarded.

**The harm runs the other way.** The join resolves BOTH sides, so a substitution
only bites when ASYMMETRIC — and it is:

```
D1     `Colorado`           -> coloradorapids
vendor `Colorado Buffaloes` -> coloradobuffaloes
```

The pair misses, the row keeps NULL odds. A missing fact, not a false one —
which is the milder of the two outcomes the original paragraph contrasted. The
struck paragraph is kept in the CC-CMD rather than deleted, because the
reasoning it produced (that this was DO NOT INVENT at the source and therefore
blocked the parent CC-CMD) is worth being able to retrace.

## Task 1 — respecified, then answered

There is no stored-key count to take. What the backfill decision turns on is the
mirror case: substituted rows that DO carry odds, meaning something matched
under a key that is not the row's own name.

**Answer: forward-only. No backfill question arises.**

| sport | rows | substituted | with opening odds | with closing odds |
|---|---|---|---|---|
| CFB | 185 | 14 | 0 | 0 |
| NFL | 50 | 6 | 0 | 0 |

Structural, not lucky: the substitution is asymmetric, so the pair misses and
the row is never written. This keeps the work clear of the standing constraint
that live archive-row mutations are authorised case by case by the user and
never wired up by a session.

## The whole-archive census

`GET /identity/substitution-census`, read-only, no Odds-API credit.

```
scanned 3191 of 3191 rows across 2 tables    complete: true
rows_unnamed                16
substituted_rows          1551
substituted_with_opening   1225
ambiguous_keys              12
```

**1551 substituted rows is not 1551 defects.** The overwhelming majority are
correct within-sport aliases — MLB `Braves` -> atlantabraves, WNBA `Aces` ->
lasvegasaces, EPL `Spurs` -> tottenhamhotspur — doing exactly their job.
Reporting that raw count as a defect count would repeat the collapse `b86b3e8`
fixed a day earlier.

### The twelve ambiguous keys — both claimants named

| key | claimant A | claimant B |
|---|---|---|
| `hullcity` | MLB `Tigers` (68) | soccer `Hull` (6: EPL, EFL Cup) |
| `stlouiscardinals` | MLB (76) | NFL `Cardinals` (3) |
| `sanfranciscogiants` | MLB (76) | NFL `Giants` (3) |
| `texasrangers` | MLB (78) | soccer `Rangers` (2: UECL Qualifying) |
| `coloradorapids` | MLS (50) | CFB `Colorado` (2) |
| `minnesotaunitedfc` | MLS (50) | CFB `Minnesota` (2) |
| `houstondynamofc` | MLS (52) | CFB `Houston` (2) |
| `fccincinnati` | MLS (46) | CFB `Cincinnati` (2) |
| `intermiamicf` | MLS (45) | CFB `Miami` (2) |
| `charlottefc` | MLS (43) | CFB `Charlotte` (2) |
| `newyorkliberty` | WNBA (35) | CFB `Liberty` (2) |
| `richmond` | AFL (16) | CFB `Richmond` (1) |

This is the enumerated pair list Task 2's fix has to resolve, and Task 4 already
requires `Colorado` under CFB against `Colorado` under MLS as exactly such a
pair.

### What decides Task 2's shape

The CC-CMD offers two candidate fixes and says the choice needs the numbers.
The numbers rule one out:

**Option (b) — "drop the bare city aliases so `Colorado` resolves to
`colorado`" — would break working joins.** MLS resolves 119 odds-carrying rows
through bare short forms (`Toronto`, `Colorado`, `Columbus`, `Salt Lake`, ...),
MLB 915 through bare nicknames, WNBA 153, EPL 28. Dropping the aliases removes
the mechanism those rows depend on.

**Option (a) — sport-scope the alias map — is the remaining one.** Not asserted
as correct here; asserted as the only one the measurements leave standing.

## Verification

`scripts/check-team-key-substitution.mjs` — 52 assertions.
`scripts/mutate-team-key-substitution.mjs` — 20 mutations, each made the check
red before the assertion it guards was allowed in (Rule 90). Both wired into
`deploy.yml` beside `check-team-identity-collisions.mjs`.

`scripts/check-substitution-census-live.mjs` — the behavioural half, written
BEFORE the probe ran: 11 keys that must appear with named families, 5 that must
NOT. The MUST NOT half is the load-bearing one — predicting that a broken
classifier flags something is easy; predicting what it must not flag is what
separates a working classifier from one that flags everything. Brighton across
EPL and Europa Conference qualifying, Man City across EPL and the Champions
League, and the Aces across WNBA and `wnba` are all in it. All 16 held.

The source-reading assertions say so in their own output: they would all still
pass if the classifier returned nothing, and they name the committed live
response as the proof instead.

## Defects found in this session's own new code

Five, each caught before the artifact was written rather than after.

1. **The named-rows list capped at 100 without saying so** (`70d1e6e`). Shipped
   in the same commit that added a Rule 91 coverage string for the scan — the
   denominator was reported for the count and withheld for the list.
2. **Soccer competitions read as different sports** (`443590c`). Brighton under
   EPL and under Europa Conference qualifying would have been reported
   cross-sport. Found by working out what the classifier would say about rows I
   could already name.
3. **A verdict the data cannot support** (`c8c7d11`). The classification compared
   against the ARCHIVE's key sets, which the substitutions themselves pollute:
   CFB's wrong row and MLS's correct one each make the other look cross-sport.
   Symmetric evidence, no verdict in it. Replaced with ambiguity, which names
   both sides.
4. **`wnba` and `WNBA` are both real labels** (`65418e2`). Without a case fold
   every WNBA club reads as two families claiming one key.
5. **A count and a list sharing one name** (`0d2777c`). `totals.ambiguous_keys`
   was a number beside the list of the same name. Live for one deploy.

And one in the source's own comment, found by writing the mutation first: the
obvious mutation — delete the combining-mark replace from `foldTeamName` — ran
and was NOT CAUGHT, because it changes no output. NFKD splits é into `e` +
U+0301 and the final `[^a-z0-9]` class drops the mark anyway. The load-bearing
half is `normalize('NFKD')`. The comment claiming accent folding was the
discriminator was true of the wrong half.

## Residual — RESOLVED, and the answer was the opposite of the prediction

**Question:** do any of the 68 MLB rows named `Tigers` (-> hullcity) carry odds?

**Predicted: no.** The reasoning was sound — the vendor sends `Detroit Tigers`
-> detroittigers, the D1 pair key is `hullcity|...`, the pair misses, nothing is
written.

**Measured: YES.** `GET /identity/substitution-census?key=hullcity`, 2026-09-13:
`MLB_2026-06-27_tigers_astros` and most rows after it carry
`has_opening_odds: true`, many `has_closing_odds: true` as well.

The argument was valid and its conclusion false, because it assumed the alias
had always been what it is now. It has not:

```
src/identity-resolver.js:253   ['Tigers',  'Detroit Tigers'],
src/identity-resolver.js:399   ['Tigers',  'Hull City'],
```

One flat `pairs` array, one loop, one `strip` object. Same key, **last write
wins, no warning.** Line 399 arrived 2026-08-21 in `0faf37f` ("all three PL
promoted clubs") and silently took over MLB's entry. The odds on those rows were
attached in June and July, while `Tigers` still resolved to `detroittigers`.

**Since 2026-08-21 every Detroit Tigers game misses the odds join**, writing
nothing and logging nothing.

Filed as `docs/CC-CMD-2026-09-13-alias-table-silent-overwrite.md` — a different
class from sport-blindness (neither entry is a bare city, so this CC-CMD's
candidate fix (b) does not touch it) with a different fix. It does strengthen
fix (a): sport-scoping resolves both defects at once.

**Not claimed: that the stored odds are wrong.** Every odds-carrying `Tigers`
row observed pre-dates the regression, and a Hull City line cannot reach a
baseball game through this path in any case — `byPair` is built from the
`baseball_mlb` vendor response alone. "Observed" is not "all 68"; confirming it
is Task 1 of the new CC-CMD, not an assertion here.

**Why the existing guard missed it.** `check-team-identity-collisions.mjs`
asserts no two clubs share a key, but over a curated list. `Tigers` is not on it.
A check over a hand-written sample cannot find the collision it was not told to
look for.

**The part worth keeping.** Running the probe was, at the moment of running it,
redundant — the answer was already deduced and the deduction was correct in every
step. This repo's rule says a cross-boundary fact is not verified by reading, and
the rule earned itself here: a sound argument contradicted by a measured fact is
what exposed a three-week-old silent regression that nothing else was looking for.

## Also observed, not acted on

- **Deploy runs complete out of order.** Run 939 (`443590c`) finished 9 seconds
  after run 940 (`c8c7d11`), so the older bundle overwrote the newer one.
  `deploy.yml` has no `concurrency:` group. Same class as the probe commit race;
  belongs in that CC-CMD's Task 3.
- **Archive id/sport disagreement.** Rows carry ids prefixed
  `FIFA World Cup 2026_` while their `sport` column says `MLS` (e.g.
  `FIFA World Cup 2026_2026-07-22_charlotte_atlanta`). Pre-existing, unrelated to
  this work, not investigated.
- **`/deploy/verify` reports the last SUCCESSFUL run's SHA**, which understates
  what is live when a run deploys and then fails a later verify step. The
  response shape is the source; `/deploy/verify` is a copy.

## Carry-forward, and what verifies it without a session

Task 2 (make the resolver sport-aware) through Task 6 remain open under the same
CC-CMD. `CC-CMD-2026-09-11-odds-identity-join-cfb` Tasks 1-5 stay blocked until
`key_substituted` reaches 0. A third CC-CMD,
`CC-CMD-2026-09-13-alias-table-silent-overwrite`, is open on the `Tigers`
regression.

**These do not wait on a session to remember them.**
`.github/workflows/identity-ambiguity-watch.yml` runs every 6 hours against the
live census and reports each done condition as DONE or OPEN in its own run
summary and in a committed artifact:

| condition | CC-CMD | met when |
|---|---|---|
| `hullcity` claimed by one family | alias-table-silent-overwrite, Task 5 | `Tigers` no longer resolves to an English club |
| ~~CFB `substituted_rows` == 0~~ | team-key-sport-blind, Task 5 | ~~resolver is sport-aware~~ |
| ~~NFL `substituted_rows` == 0~~ | team-key-sport-blind, Task 5 | ~~same~~ |
| `cross_sport_reach_failures` == 0 | team-key-sport-blind, Task 5 | **RESTATED — see the close-out below.** The two struck conditions can never be met under the fix that shipped, because `resolveTeamKey` is deliberately unchanged. |
| `ambiguous_key_count` == 0 | both | every key claimed by one family |

The watch writes a TIMESTAMPED file per run rather than rewriting a
`-latest.json`. That is deliberate: the race filed in
`CC-CMD-2026-09-13-probe-commit-race-unrecoverable` happens because concurrent
runs conflict on one regenerated file. A unique name per run cannot conflict, so
this watch sidesteps that defect by construction instead of inheriting it.

It exits non-zero only when the census itself fails. "Still open" is a
measurement, not a failure, and a watch that cried red for months would be
muted long before the condition it exists to catch ever flipped.

---

## Close-out — Tasks 5 and 6 (2026-09-13, appended)

### Task 5 was not satisfiable as written, and that is the finding

Its wording:

> `/identity/mismatches` reports `key_substituted: 0` for every sport probed in
> Task 0.

`key_substituted` / `substituted_rows` is computed with `substitutedKey`, and
**`substitutedKey` IS standalone `resolveTeamKey`.** Task 3 enumerated every
caller of that function and found three — `ambient-do.js:822`,
`wp-resolver.js:62`, `index.js:1219` — that bridge a vendor name to a FIELD name
with **no payload in hand**, relying on exactly the short-form aliases in
question. So the shipped fix (`9366af9`) left `resolveTeamKey` alone on purpose,
CFB still reports 14, and **no correct fix could have zeroed that number.**

The condition measured the alias table's shape. The defect was in the join's
behaviour. Those are different things, and the wording could not tell them
apart — a spec failure at the point it was written (Rule 89), not an execution
shortfall at the point it was checked.

**Second time today.** `CC-CMD-2026-09-13-alias-table-silent-overwrite`'s Task 5
needed the same treatment for the same reason: both were written before the fix
was chosen, and both encoded an assumed fix as if it were the property. The
pattern worth carrying forward is narrower than "write better conditions" — it
is **a done condition must name a property of the system, never a value of an
instrument that may itself be replaced by the fix.**

### The restated condition

> No substituted display name can reach another sport's club through a join, and
> every name that legitimately joined before still does.

**Artifact:** `GET /identity/substitution-census`'s `cross_sport_reach` block.
It runs once per distinct `(sport, name)` pair the scan itself classified
substituted — a measured denominator, not a chosen list — and it exercises the
**deployed** `resolveTeamKeyIn` and the **real** `src/odds-join.js`, rather than
re-implementing either.

| field | must be | meaning |
|---|---|---|
| `escapes_into_a_payload_without_it` | `false` | the defect. Before `9366af9` this was `true` for every one of them |
| `own_club_payload_still_joins` | `true` | nothing lost — the club's own payload still matches on the short form |
| `cross_sport_reach_failures` | `0` | the headline |

`cross_sport_reach_coverage` carries the denominator (Rule 91).
`cross_sport_reach_probed` / `_shown` / `_omitted` sit beside the list so the
50-row display cap cannot be read as the count. **Failures are never capped.**

### Live probe output — CFB, 16:39:08Z, HEAD `2952d14`, deploy run 949

```
coverage:                     scanned 185 of 185 rows across 2 tables (sport=CFB only)
cross_sport_reach_coverage:   probed 7 of 7 distinct (sport, name) pairs
                              classified substituted by this scan
cross_sport_reach_failures:   0
cross_sport_reach_failing:    []

Colorado    -> coloradorapids     (Colorado Rapids)      escapes=false  joins=true
Minnesota   -> minnesotaunitedfc  (Minnesota United FC)  escapes=false  joins=true
Miami       -> intermiamicf       (Inter Miami CF)       escapes=false  joins=true
Cincinnati  -> fccincinnati       (FC Cincinnati)        escapes=false  joins=true
Houston     -> houstondynamofc    (Houston Dynamo FC)    escapes=false  joins=true
Charlotte   -> charlottefc        (Charlotte FC)         escapes=false  joins=true
Liberty     -> newyorkliberty     (New York Liberty)     escapes=false  joins=true
```

`substituted_rows` is still **14** for CFB in the same response, unchanged and
expected. That is the exposure, not the defect.

### Both halves were made to fail before either was trusted (Rule 90)

| mutation | result |
|---|---|
| `resolveTeamKeyIn` → `return resolveTeamKey(name)` (the shipped defect, restored) | `escapes` **true** 7/7, `joins` unchanged |
| `if (availableKeys.has(alias)) return alias;` disabled | `joins` **false** 7/7, `escapes` unchanged |

The two halves move independently, so neither is carrying the other. Durable
coverage is S1 and S2 in `scripts/mutate-sport-blind-resolution.mjs`.

### The watch carried the same unmeetable wording

`identity-ambiguity-watch.yml` evaluated `CFB substituted_rows == 0` and
`NFL substituted_rows == 0`. Under the shipped fix **neither can ever flip to
DONE** — it would have reported OPEN every six hours forever, and a watch that
never goes green is muted long before the thing it exists to catch happens.

Both are replaced by the reach condition in
`scripts/identity_ambiguity_conditions.py`. The exposure count is **demoted, not
deleted**: it is the denominator the probe runs over, so it stays in the run
summary as a readout, labelled `(not a condition)`.

### Four mutations on the conditions module, and P2 found a real gap

`scripts/mutate-identity-ambiguity-conditions.py`:

| mutation | caught by |
|---|---|
| P1 old wording restored (`CFB substituted_rows == 0`) | `every condition met, exposure unchanged` — whose CFB/NFL counts are deliberately 14 and 6 |
| P2 reach condition hard-wired `True` | `reach is the only open condition` |
| P3 absence collapsed to zero (Rule 99) | `reach fields absent from the response` |
| P4 exposure readout dropped from the summary | `summary omits` |

**P2 failed on its first run with WRONG REASON, and the harness was right.**
Hard-wiring the condition to `True` left every existing fixture green, because
in each of them something else was already open — so the check could not tell a
live condition from a constant. The fixture `reach is the only open condition`
exists for that and nothing else: every other condition is met in it, so
`all_done` turns on the reach condition alone.

### Commits

| commit | what |
|---|---|
| `9366af9` | Tasks 2, 3, 4 — payload-scoped resolution |
| `2952d14` | Task 5 restated; live reach probe; watch conditions replaced; conditions-module mutation harness |
| `b3b5b24` | untrack `scripts/__pycache__`, committed by accident in `e58f7bb` |

### Checks at close

| check | result |
|---|---|
| `check-sport-blind-resolution.mjs` | PASS 26/26 · 4 mutations caught |
| `check-ambiguous-team-identity.mjs` | PASS 41/41 · 7 mutations caught |
| `check-team-key-substitution.mjs` | PASS 59/59 |
| `check-identity-table-collisions.mjs` | 333 pairs, 5 tables · 1 colliding key, 1 recorded, 0 silent |
| `check-identity-ambiguity-conditions.py` | PASS · 5 fixtures × 3 conditions · 4 mutations caught |

### Residual

**None on Task 5.** The CFB probe covers the 7 pairs in that sport; the
archive-wide run is `outbox/identity-ambiguity-watch-20260913T163926Z.json`,
dispatched at close:

```
coverage:  scanned 3237 of 3237 rows across 2 tables
DONE  hullcity claimed by one family                     -> one family
DONE  no substituted name reaches another sport's club   -> 0 failing of 123 probed
OPEN  ambiguous_key_count == 0                           -> 11
```

**123 pairs probed archive-wide, 0 failing. Task 5's condition is met.**

The one OPEN line is not this CC-CMD's. `ambiguous_key_count == 0` belongs to
`CC-CMD-2026-09-11-odds-identity-join-cfb`, which stays blocked on 11 keys still
claimed by more than one sport family. The watch keeps reporting it every six
hours; nothing here waits on a session to remember it.

`substituted_rows` archive-wide is **1569** in the same response — the exposure
the reach probe ran over, and still not a defect count.

**Not fixed, and out of scope by the CC-CMD's own boundary:** all 185 CFB rows
still lack odds, and only 14 were substituted. The other 171 miss for reasons
this fix does not touch. The deliverable was correctness — the join can no
longer name another sport's club — not coverage.
