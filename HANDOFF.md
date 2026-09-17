# FIELD Relay — HANDOFF

## RESOLVED 2026-09-16 14:42Z — the odds backfill cron is alive again

`odds-backfill.yml` run **35110321483**, scheduled, started 2026-09-16T14:42:07Z,
conclusion **success**, after failing every scheduled run 2026-09-01 → 09-15
(runs 84–98, `ODDS_API_KEY` resolving to an empty string). The secret was set
between run 34983451607 (09-15, failure) and that one. Onset of the original
outage remains unestablished — run 83 and earlier were never examined.

Cost of the outage was measured separately: **0 recoverable rows**, 177 CFB
filed under their own item. Not claimed, then or now: that the outage explains
the odds gaps closed on 09-15. The 874 run-clock rows predate 2026-08-22 and the
243 cup rows have no vendor coverage.

**`scripts/watch-silently-dead-crons.mjs`** (daily, `15 12 * * *`) was built for
this and does ask the repo-wide question. **It has a measured blind spot of its
own — see the 2026-09-16d close-out §7.7:** it reads 100 of 150 workflows with
no pagination and prints "100 workflow(s)" as though that were the total. No
dead cron is hiding there today (checked, not assumed), and the fix is specced
but NOT applied.

## OPEN — the provider-vs-ledger gap is ~19,700 and unexplained

66,085 billed by the provider against 46,347 in our monthly ledger at
2026-09-16T22:05Z. Established **not** to be live leakage: the 2026-09-05
artifact shows ~17,800 already, so it grew ~1,900 over 11.5 days — an old static
offset. **Origin UNKNOWN.** `ledgerIntegrityVerdict` in
`watch-odds-pairing-rate.mjs` now watches for it *recurring* by comparing the two
deltas to each other; it cannot explain the existing offset. Unblocked by the
Odds API dashboard's per-day history, which no session here has had access to.

## RESOLVED 2026-09-16 18:0xZ — the slate matcher pairs 0 on every sport that is not CFB

**FIXED.** `nameMatches` now matches a contiguous token WINDOW instead of
anchoring at index 0. Measured on both fixtures: CFB 80/80 unchanged (73 by
name + 7 by elimination), MLB **15/15**, 0 unmatched, 0 ambiguous on each. An
MLB fixture cost 20 credits and is committed at
`outbox/fixture-mlb-2026-09-15.json`. 31 of 31 mutations.

The original text follows because the cause is worth keeping.

### Original entry

Run `35110321483`, scheduled, 2026-09-16 14:42Z, head `1fe0e1d`. First cron run
on the new matcher. It ran, it fetched, and it paired **nothing**:

```
2026-09-15 baseball_mlb           29 event(s),  5 out of window, 24 in pool -> 0 + 0, 15 unmatched, 0 ambiguous
2026-09-15 soccer_spain_la_liga   16 event(s), 12 out of window,  4 in pool -> 0 + 0,  3 unmatched, 0 ambiguous
2026-09-15 soccer_england_efl_cup  5 event(s),  1 out of window,  4 in pool -> 0 + 0,  5 unmatched, 0 ambiguous
2026-09-15 soccer_usa_mls         15 event(s), 15 out of window,  0 in pool -> 0 + 0,  3 unmatched, 0 ambiguous
done: dates=1/1 games=0 credits=80
```

**CAUSE: the predicate's direction is CFB-specific.** `nameMatches` requires
every archive token to prefix the VENDOR token at the SAME INDEX. The archive
stores MLB as a nickname alone — `Astros`, `Blue Jays`, `Braves`, `Brewers`
(confirmed from committed artifacts) — while the vendor sends `Houston Astros`.
Index 0 compares `astros` against `houston` and fails. CFB puts the school in
prefix position; MLB puts the nickname in suffix position.

**NOT a regression.** The equality matcher this replaced also scored 0 on
`Astros` vs `Houston Astros`. But 73-of-80 was measured on ONE CFB sport-date,
the coverage line said so, and it was shipped to a cron that runs MLB daily
regardless. The number was true and the inference from it was not.

**The CFB done condition is still UNTESTED** — 2026-09-15 was a Monday with no
CFB fixtures. Silence on CFB is not evidence either way.

**COST WHILE OPEN: 80 credits/day, pairing zero.** `odds-pairing-rate-watch.yml`
will now fail daily on exactly this, which is the watcher working.

**FIX, not yet built:** allow archive tokens to match a contiguous token WINDOW
of the vendor name rather than only from index 0. `astros` matches
`["houston","astros"][1..1]`. Loosening raises ambiguity, which the elimination
stage and the ambiguity refusal already handle, and the CFB fixture proves no
regression there. **It must not be shipped on the CFB fixture alone — that is
the exact mistake above.** An MLB fixture costs 20 credits and is the owner's
call.

## SESSION CLOSE-OUT — 2026-09-16d (the ledger says WHO, and three watches read the wrong thing)

**HEAD:** `9b8dce1` → `71433fe` → `a96af3a` → `a71724f` → `41b7ad4` · main throughout · 0 PRs
**Session doc:** `outbox/cc-session-2026-09-16d-odds-attribution-and-watches.md`
**Deploys:** 35137916107 ✅ · 35152703394 ✅ · 35155571062 ✅ (35135398019 ❌)

**`71433fe` was reported as landed and was not.** Deploy run 35135398019 failed
at step 63 and skipped every step after it, including the deploy. Red since run
969; last green 968 (`f384913`, 12:58Z). The gate had not changed — `ff61e97`
gave `watch-odds-pairing-rate.mjs` a file under `outbox/`, which put it in the
gate's corpus (107 → 108 scripts), and two `Number(x || 0)` reduces that had
always been wrong became lines that mattered.

**/budget/odds now decomposes.** `by_site` over nine named consumers plus
`unattributed`, with `by_site_sum` and `unaccounted` reported separately so a
divergence is visible rather than inferred.

| 2026-09-16 22:05Z | |
|---|---:|
| `ambientCaptureClosingOdds` | **1200** (62%) |
| `ambientFetchLiveOdds` | 264 |
| `getWCPregameLambdas` | 256 |
| `fetchSportOddsHistorical` / `Live` | 120 / 66 |
| `used` / ceiling | 1598 / 3800 |

**A premise was published and then refuted by its own test.** I reported the
209 unaccounted as pre-deploy residue, naming the one measurement that would
refute it. Thirteen minutes later `by_site_sum` had grown **549** against
`used` +446 — a sum cannot outgrow the total it decomposes by arriving late.
`reconcileOddsCredit` was correcting `odds:daily:*` and `odds:credits:*` and
leaving `odds:site:*` holding the estimate.

**Four of nine consumers had TWO names** — `ambientFetchLiveOdds` vs
`_fetchLiveOdds`, and three more — so pointing reconcile at the site key would
have minted keys `_readSites` never reads. One exported `ODDS_SITES` now; the
four literals renamed; `_bumpSite` called from reconcile, clamped at zero.
Confirmed live by a site counter going **down** (268 → 264), which only a
negative delta can do.

**The pairing watch had never run.** Dispatched, it produced a false FAIL:
*"the provider billed 1377 where 1232 was allowed... the signature of a guard
that stopped guarding"* — on an interval where **our own ledger charged 1467**,
ninety more than the vendor billed, on a day sitting at **42% of its ceiling**.
Two defects: it compared the provider's cumulative counter to our ledger's
ceiling (two populations, 19,582 apart), and it prorated a daily cap into a
rate the guard never enforces. Split into `ledgerIntegrityVerdict` (the two
counters against each other) and `ceilingVerdict` (`used > ceiling`, no
arithmetic).

**Both watches' schedule comments were false, and the measurement condemned one
I had shipped 90 minutes earlier.** GitHub's scheduled-run delay here is
**104–405 minutes** (25 runs, 7 workflows — `outbox/gha-cron-delay-2026-09-16.json`).
`odds-backfill.yml` declares 10:00 and starts 13:25–16:13. And it keys
`odds_backfill_progress` by the **backfilled** date, so there is never a row for
today. `odds-attribution-gap.yml` at 23:30 would have fired 01:14–06:15 the
*next* day. Fixed at the root: `/budget/odds?date=` reads a closed day, the
watcher asks for yesterday and verifies the date came back.

**Gates:** 19/19 and 35/35 mutations; 20/20, 16/16, 23/23 self-tests. Rule 90
caught four apparatus defects (A11, A12, A18, A19) — every one a check that
could not fail for the reason claimed.

**NOT DONE, and started:** `watch-silently-dead-crons.mjs` reads **100 of 150**
workflows with no pagination and prints "100 workflow(s)". Fix specced, not
applied. See the session doc §7.7.

**Carry-forwards with unblock criteria:** session doc §7. Check-in armed:
`trig_01XKN5kUAQNw6yo8bcGaUFpq`, 2026-09-18 17:00Z, for the first fully
attributed day (2026-09-17).

## SESSION CLOSE-OUT — 2026-09-16c (what the provider billed, which nothing recorded)

**HEAD:** `642b647` → `ff61e97` → the null-as-zero fix · main throughout · 0 PRs
**Session doc:** `outbox/cc-session-2026-09-16-odds-name-matcher.md`

**"10k in a day and no problems solved" could not be checked, and that was the
defect.** Nothing recorded what the provider billed per day.

| | |
|---|---:|
| provider billed, month to date | **64,546** / 100,000 |
| our monthly ledger says | 44,874 / 85,000 |
| today's daily counter (13:16Z) | 123 / 3,800 |

**A leak theory was formed and refuted before it was reported.** The ~19,700
gap looked like the CI scripts spending outside the ledger — they genuinely are
outside it, and `check-odds-calls-guarded.mjs` certifies "every odds call is
charged to the monthly ledger" while scanning exactly three files under `src/`.
But the 2026-09-05 artifact shows the gap was already ~17,800 then. Over 11.5
days it grew 1,877. It is an old static offset, not live leakage, and the
ledger tracks current spend to within ~5%. **Origin of the ~18k offset:
UNKNOWN and unexplained.**

**What the two readings do establish:** 41,002 credits over 11.5 days,
**~3,565/day sustained**, against a 3,800/day ceiling whose own comment reads
"85K/month ÷ ~22 active days". The guard is not a brake; it authorises 83,600
of an 85,000 limit in advance. Nothing asks whether the spend buys anything.

**`odds-pairing-rate-watch.yml` now records the provider figure daily** next to
games actually paired, and fails when a day's delta exceeds the ceiling prorated
by elapsed hours — the signature of a guard that degraded open, which both
guards can do (`consumeOddsCredit` returns true with FIELD_JOURNALISM unbound;
`checkAndIncrementDailyOdds` returns true on any KV error).

**Its first live run found real history:** 8 of 13 dates billed and paired
nothing — 580 credits, 16 games — which is the 0-of-80 made visible for the
first time.

**Two defects in the instrument itself, both caught here:**
1. that first run exited on the pairing FAIL *before* recording the spend. A
   failing day is exactly the one whose cost matters. One exit now, reading
   first, ordering asserted structurally (M28).
2. the report line coerced an unknown pairing baseline to 0 (M29). Third
   null-as-zero in one feature.

**NOT ANSWERED:** per-day provider usage before today. Two snapshots eleven days
apart cannot show a 10k Saturday. The Odds API dashboard has it; this series
will have it from tomorrow. **29 of 29 mutations caught.**

## SESSION CLOSE-OUT — 2026-09-16b (the initialisms, paired without reading them)

**HEAD:** `34fc037` → `642b647` · main throughout · 0 PRs
**Session doc:** `outbox/cc-session-2026-09-16-odds-name-matcher.md`

**73 of 80 → 80 of 80, with zero alias entries.** The seven initialisms (ETSU,
MTSU, FAU, FIU, Jax State, Western KY, GA Southern) are paired without the
abbreviation ever being read. The two sides are the same slate, so a vendor
event belongs to at most one game: stage 1 pins the 73 unambiguous pairs and
SPENDS their events, and each remaining row still matches uniquely on the side
that is not abbreviated.

**The other half was a fact already in hand.** The historical endpoint returns
FUTURE fixtures — 15 of the 95 events kick off 09-17 to 09-20. They were never
candidates and their only effect was to manufacture ambiguity; `GA Southern @
Clemson` had two Clemson opponents and the rival was a week later.

| stage | solved |
|---|---:|
| in-window pool (95 → 80) | — |
| stage 1, both sides unique | 73 |
| stage 2, one side + elimination | 7 |
| unmatched / ambiguous | 0 / 0 |

Six of the seven land at kickoff delta 0 on the independent cross-check; the
seventh is GA Southern at −120 min, already a known member of the disagreement
class.

**It degrades safely, as committed assertions rather than prose:** 7 forced
pairings claim 7 distinct events; 80 single-row archive gaps mis-force nothing;
7 vendor gaps produce 0 substitutes; a row with two candidates is refused; two
rows wanting one event are both refused rather than ordered.

**23 of 23 mutations caught.** Two were not caught first time and both were
holes in the checks: M17 was unreachable because after windowing every residual
row has exactly one candidate (closed with an Ohio Bobcats / Ohio State
Buckeyes collision, real in CFB), and M13 survived because the wiring check
asserted the IMPORT and not the CALL.

**AUTOMATED FOLLOW-UP — `odds-pairing-rate-watch.yml`, daily 11:00 UTC.** Fails
when `credits_used > 0 AND games_processed = 0`: the backfill paid for a payload
and paired none of it. That is precisely what the old matcher did on every CFB
date, and nothing could see it — the cron was not dead, it spent credits, and
it wrote a zero that read as health. An empty result is a failure, not a pass.

**STILL NOT VERIFIED LIVE.** Every number is offline against
`outbox/fixture-cfb-2026-09-12.json`, one sport-date. No live vendor call was
made. The cron has not yet run with either the matcher or the slate change —
the first scheduled run after 2026-09-16 10:43Z is the first production
evidence, and the pairing watcher is what will report it.

## SESSION CLOSE-OUT — 2026-09-16 (three matchers, and the cron's found nothing)

**HEAD:** `4ab995a` → `014b82a` · main throughout · 0 PRs
**Session doc:** `outbox/cc-session-2026-09-16-odds-name-matcher.md`

**`.github/scripts/odds-backfill.js`'s team-name matcher scored 0 of 80.** Not
poorly — zero. It compared whole strings for equality after stripping
non-alphanumerics, and the vendor appends a mascot to every college name, so
`Georgia` never equalled `Georgia Bulldogs`. That loop has run daily and matched
no CFB game for as long as CFB has been in the archive. Two more copies of it
existed, in `scripts/targeted-odds-fill.mjs` and the diagnosis script — the same
private-copy shape as the fourth sport-key registry deleted on 2026-09-15.

`src/odds-name-match.js` is now the only one. Positional token prefix: every
archive token must prefix the vendor token at the same index.

| matcher | solved | ambiguous | none |
|---|---:|---:|---:|
| whole-string equality (what shipped) | **0** | 0 | 80 |
| whole-string prefix + kickoff instant | 58 | 0 | 22 |
| token prefix + kickoff instant | 68 | 0 | 12 |
| token prefix, no instant | 72 | 0 | 8 |
| + apostrophes stripped | **73** | 0 | 7 |

**The kickoff instant is not the key, and measuring it is what removed it.** It
looked like the strong join. Across all 80 it is not: names alone are unique,
while 5 of the 73 pairs disagree on kickoff by −90 to +1 minutes. Filtering on
it discards five correct pairings to gain nothing. It is now an independent
cross-check — names chose 73, kickoff agrees on 68 — which is worth more than it
was as a filter.

**Residue: 7, and they are initialisms, not abbreviations.** ETSU, MTSU, FAU,
FIU, Jax State, Western KY, GA Southern. An alias table is a map of
disagreements between the two systems, not a school list — the vendor itself
writes UConn, UCF, UTSA, SMU, BYU. Named in the check so a change that improves
the count by matching the wrong thing still fails. **UNFIXED and unscheduled.**

**A second defect, found by reading.** `targeted-odds-fill.mjs` looked up
outcome prices by comparing the vendor's outcome names to the archive's team
names, so a matched event would have inserted a row with `home_ml` and `away_ml`
empty. Invisible while the matcher above found nothing. `h2hPrices()` is shared
with `buildOddsRow`, which already did it correctly.

**14 of 14 mutations caught.** Three were not caught on the first run and all
three were defects in the measuring apparatus, not the module: M7 had no case
that could reach it, and M4/M8 could not anchor because a heredoc had turned
`’` into a literal apostrophe in the source.

**guards.yml has been RED on main since 2026-09-15 and I pushed over it all
session.** Two independent failures. The first was mine: five scripts I added on
09-15/16 hard-coded `RELAY_SHARED_SECRET` in their `X-FIELD-Relay` header,
taking the ratchet from its declared 115 to 120. They now read
`process.env.RELAY_SHARED_SECRET` with no default and their workflows pass the
secret. The second was this document being stale, which is what this close-out
clears.

**NOT VERIFIED LIVE.** Every number above is offline, against
`outbox/fixture-cfb-2026-09-12.json` — one sport-date, 80 archive rows vs 95
vendor events, bought once for 20 credits. Zero ambiguity is a property of a
95-event payload. **No live vendor call was made for any of this, and the cron
has not yet run with the new matcher.** Next `odds-backfill.yml` scheduled run
is the first production evidence; it is still blocked by the empty
`ODDS_API_KEY` recorded at the top of this file unless that has been set.

## SESSION CLOSE-OUT — 2026-09-14 (a closing line that was not one)

**HEAD:** `d30138f` → `4ab995a` · main throughout · 0 PRs · deploy 960 green
**Session docs:**
`outbox/cc-session-2026-09-14-closing-odds-kickoff.md` (this arc),
`outbox/cc-session-2026-09-14-symmetric-collision-merge.md`,
`outbox/cc-session-2026-09-14-git-state-swallow-sweep.md`,
`outbox/cc-session-2026-09-14-probe-commit-race.md`
**Gate:** `CC-CMD-2026-09-14-closing-odds-captured-after-kickoff` — Tasks 0–4
and both residuals closed in-document.

Two D.C. United collision pairs each held two different closing lines and no
merge rule could pick between them. Three dead ends is the Rule 42 signal, and
what the rows were showing was not a tie: one capture was four minutes before
kickoff and the other ten minutes into the match. **Neither column was lying
about its value. The column name was wrong.**

**Archive-wide: 219 of 1412 closing values were captured after kickoff.**
1164 verified pre-kickoff, 29 unaskable. Late rate 15.8% — against the 10.4%
that looked like the answer while a third of the archive could not be asked.

**Three writers, not two.** `.github/scripts/odds-backfill.js` is the third and
runs in CI; `scripts/diagnose-staged-fails-2026-08-22.mjs:81` (`Three writers can set closing_odds`) already said so.
All three now compare capture against kickoff as **instants** — the first probe
compared them as text, where `'Z'` sorts above `':'` and a capture 30 s after a
minute-precision kickoff reads as before it.

**Every closing blob now carries `_kickoff: { at, verified, late_minutes }`,**
shipped to all three writers and backstamped onto 1383 existing rows. 476 rows
with no `start_time` were resolved from ESPN (476/476), 25 more by
twin/cardinality; **29 have no proven route** and their refusals are recorded as
evidence.

**Nothing read the mark until Task 4.** Five sites read `closing_odds` by name
and all five want the same property — the last price before kickoff. Wiring them
to it removes **7 fabricated upset findings and 0 real ones**, stops **126**
debrief prompts printing an in-play price as `closed`, and stops **130 of 1323**
pairs narrating a movement that ends in-play. The CFL row is the one to read:
pre-kickoff **−4800**, published in-play **+250** taken 180 minutes late.

No tolerance, measured: 23 rows are ≤ 2 min late, **96 are over two hours**.
Cost is **88 decided rows with no price** — unknown rather than wrongly known.

**Live proof:** `outbox/late-close-story-suppressed-2026-09-14T22-49-*.log` —
42 of 42 rows that used to compute a story now return none, 20 dates, 0 still
narrating. The verifier fails if the would-have count is zero, so an empty route
cannot satisfy it.

**Rule 100 (PREMISE-FIRST-A) written this session**, from a count of five
published-then-refuted premises. Corollary: an untested premise is not reported
as a finding.

**New blocking gates in deploy.yml:** `check-odds-consumer-rules.mjs` (32
assertions / 12 mutations) and `check-odds-consumer-wiring.mjs` (14 / 8).

**The citation checker's "the anchor gives the repair" line was itself a
premise.** Its anchor is the first quoted fragment within 400 chars that the
file contains — proximity, not meaning. All four rows it listed on 2026-09-14
were mis-paired, not stale: HANDOFF's `INSERT OR IGNORE` citation was paired
with `CREATE TRIGGER` from the sentence before, and applying the offered repair
would have pointed it at a trigger definition. Two numbers WERE stale and are
fixed — the `INSERT OR IGNORE INTO ${table}` site in `src/index.js` and
`function resolveAbbr(teamName)` in `src/context-assembler.js` — and the other
two were correct all along. The advisory now says it is guessing.

**`/archive/` handler: 9 lines of headroom** before the 1500-line brace-scan
window. `1207013` failed that gate at exactly 1500.

**2026-09-15 — the snapshot_time residual is closed at zero, and opened a
second question.** 184 `odds_history` rows, **0** NULL and **0** empty
`snapshot_time`, 2 candidate games both stamped: the 2026-09-14 skip costs no
coverage. But **22 of 182** archived closing lines carry a `captured_at` that is
not their own row's `snapshot_time`, all attributed to `odds_backfill`, with
millisecond stamps decrementing across a batch — a `new Date()` loop. The
fallback removed yesterday cannot be the source (`INSERT OR IGNORE` never
updates a row, and at 10:00Z the match had not kicked off). `CC-CMD-2026-09-15-backfill-captured-at-not-snapshot-time` Task 0 settled it,
and not from timestamps: **22 of 22 prices DIFFER, in different units.** The
blob is American with no total from DraftKings; the history row is decimal with
a total from BetRivers. `odds-backfill` carries the history row's bookmaker,
converts its decimal price and copies its `over_under` — three fields, all
wrong for these rows. **It cannot have written them.**

`change_log` named it because the sync loop logged an insert after EVERY UPDATE:
both games tables though a game lives in one, and both odds columns though the
candidate predicate is "opening OR closing IS NULL". 44 entries for 22 games,
exactly two each — the ratio was in the first measurement. The code carried a
comment asserting the invariant it broke. **Fixed**: the candidate query now
returns `game_table`, `opening_is_null` and `closing_is_null`; the loop writes
one table and only empty columns. 16 assertions, 12 mutations, blocking in
`deploy.yml`, and the edited SQL verified read-only against live D1 before its
10:00 UTC cron (2 candidates, flags agree with the rows they describe).

**Treat change_log counts with suspicion for anything before 2026-09-15.**
Yesterday's "author of the 62" stands — it rests on a dated gap, and a phantom
entry still carries a real timestamp — but count-based attribution should be
re-derived.

**The writer is named, from source, in four fields.** `extractOddsForGame`
(`src/index.js:6439`) via the `/archive/game` closing capture: it takes
`source: bk.key` with `ODDS_PREFERRED_BOOK = 'draftkings'`, emits the vendor's
American prices, omits `total` when that book prices no totals market, and
stamped `capturedAt || new Date()`. **`a1937eb` fixed that at
2026-08-22T21:11:07Z; the latest of the 22 blobs is stamped 10:00:52Z the same
day — eleven hours earlier. All 22 predate the fix.** change_log never named the
route because its first entry there is 2026-08-23.

`scripts/check-captured-at-explicit.mjs` now states the invariant where it can
fail: no call feeding `closing_odds` omits `capturedAt`, at most one call omits
it, and that one writes `opening_odds` — the live fetch, where the clock IS the
capture moment. 7 assertions, 5 mutations, blocking.

**The population is 874, not 58 or 22 — measured through three keyholes.**
22 was what the `odds_history` join reached (184-row table); 58 was
`source='draftkings'` AND no total, a description of the first examples; **874
carry `_oddsProof` with a run-clock stamp, which is the writer's own
signature.** The first watch run failed at 916-against-58 and was right to: it
gated on the millisecond shape, and `AmbientDO._captureClosingOdds` stamps
`new Date()` when the clock IS the capture. Gated now on `_oddsProof`, which
only `extractOddsForGame` writes; predicate shared by executor and watch from
`src/odds-capture-provenance.js`. Split is 874 replayed / **42** live — I
assumed ~858 live, wrong by 20×. Newest gated stamp
`2026-08-22T10:01:04.210Z`, eleven hours before `a1937eb`: all residue, nothing
new since. **APPLIED 2026-09-15T14:15:55Z: 874/874 marked, 0 unmarked, 0 `captured_at`
altered**, watch green at baseline 0
(`CC-CMD-2026-09-15-capture-provenance-mark`); daily watch at `40 11 * * *`.

**The first apply failed and the failure paid for itself.** `fetch failed`
eighteen seconds in, printing no count; recovery needed a separate query and
found **59 marked with no `change_log` entry** — the same unattributable state
2026-09-14 Task 1 spent a task reconstructing, reproduced by my own executor.
Fixed three ways: transport-only retries with backoff; `change_log` derived
from the archive ("marked but not logged") so the re-run repaired the 59
orphans rather than orphaning them permanently; and the progress count printed
into the committed log. `874 entries written` against a plan of `815` is that
second fix working.

**Rule 42 changed the mark before it was written.** `captured_at` had been
treated as noise; it is an upper bound — the vendor serves a snapshot at or
before the request and the worker stamps after receiving it. `window_end =
min(anchor, run clock)` took the undecidable count from 1 to **0**.

**Repair verified and REFUSED, on evidence.** Selecting by the writer's shape
rather than the `odds_history` join finds **58 rows, not 22** — the join saw
only the 184 games with a history row. Of those 58 the noon anchor changes the
kickoff verdict for **1**: `EPL_2026-08-22_hull_manunited`, kickoff 11:30Z,
stored 10:00:37 (verified true) against anchor 12:00 (verified false). The
endpoint serves the snapshot at-or-before noon, so the true capture is somewhere
in a window ending at 12:00 and this match started at 11:30 — **neither value is
supportable**, and `servedAt` is gone. For the other 57 the repair changes a
timestamp no consumer reads into a different timestamp no consumer reads.

A repair would also have to rewrite `_kickoff` in the same statement:
`stampKickoff` is `captured_at`'s only reader and its output is already on the
row. **The honest repair is a mark saying the timestamp is not a measurement,
not a better timestamp** — still a D1 write to 58 rows, unauthorised, not
started.

**Surfaced, not fixed:** `kickoffMark` returns `{verified: false,
late_minutes: null}` for both "late by an unknown amount" and "unreadable".
Different states; the EPL row needs the second. Changing it moves 1383 existing
marks (`src/odds-kickoff.js`).

**Open:** 29 unaskable rows; the 219 values are unmodified and a relabel into
`inplay_odds` is now optional; `CC-CMD-2026-09-14-cup-competitions-under-mls`
unstarted; the 49 brief-repoint pairs unstarted;
`odds_history.snapshot_time` NULL count still unmeasured.


## SESSION CLOSE-OUT — 2026-09-13 (Task 0 disproved the matcher)

**HEAD:** `8a84ab4` → `2a783df` · main throughout · deploy 934
**Session doc:** `outbox/cc-session-2026-09-13-odds-join-task0-cfb.md`
**Task 0 done, Tasks 1-5 BLOCKED:** `CC-CMD-2026-09-11-odds-identity-join-cfb`
**FILED:** `CC-CMD-2026-09-13-team-key-sport-blind`

Probed a real Saturday CFB slate as that CC-CMD instructed — 80 games, 24 vendor
events, 0 matched — and its five-pair sample did not survive.

**Six of eighty D1 rows carry another sport's team.** `Liberty →
newyorkliberty` (WNBA); Minnesota, Colorado, Houston, Cincinnati, Charlotte →
MLS clubs. `resolveTeamKey`'s alias map is sport-blind, and **those keys are
written into D1** — the archive asserts a college football game was played by
the Colorado Rapids. An unmatched row is a missing fact; a substituted key is a
false one.

It **blocks** the matcher: one that "succeeds" on `coloradorapids|weberst`
writes MLS odds onto a college football game, worse than the zero coverage it
replaces.

**The prescribed matcher rule fails on 35 of 80 rows** — `cmichigan` is not a
prefix of `centralmichiganchippewas`. The sample held only mascot-suffix and
`st`→`state` cases, which the rule does handle.

`/identity/mismatches` now reports `key_substituted` (6, verified live).
`San José St → sanjosest` correctly not flagged — accent-folded, so the check
separates a rendering artifact from a substitution.

**Backfilling existing D1 rows is NOT decided here.** The new CC-CMD's Task 1
produces the count so the call can be made; a live archive mutation is the
user's, case by case.


## SESSION CLOSE-OUT — 2026-09-13 (the brace counter read prose as syntax)

**HEAD:** `5640735` → `c176266` · main throughout
**Session doc:** `outbox/cc-session-2026-09-13-brace-balance-defeated.md`
**CLOSED:** `CC-CMD-2026-09-13-route-scan-brace-balance-defeated` (filed and
closed same day)

`bodyOf` counted every `{` and `}` in the raw line. Seven lines inside
`/archive/` are braces that are not structure — six comments, one string literal
— leaving residual depth 1, so the block never balanced.

**The window was never too small.** Stripped, `/archive/` balances at line 13366
(1470 lines, inside the existing 1500). `/cfl/` is at 13397, **31 lines past the
true end** — the cfl hosts that started this chain were never `/archive/`'s.

`/archive/` lost `t: 1` and `do:AMBIENT_DO` (the `/live/*` block bleeding past
the end). Truncated 2 of 225 → 1 of 225; `/mcp` survives and is **genuine**
(0 offending lines, raw depth 4 == real 4) — left flagged, not papered over.

Regex literals deliberately unhandled: an unbalanced one degrades to the flagged
partial read it already had, never a silent wrong answer. Bound documented at
the code.

19 cases, 5 mutations, both in `deploy.yml`.


## SESSION CLOSE-OUT — 2026-09-13 (a partial route parse now says so)

**HEAD:** `e30a276` → `5fa598d` · **Branch:** main throughout
**Session doc:** `outbox/cc-session-2026-09-13-route-provenance-truncation.md`

**CLOSED:** `CC-CMD-2026-09-12-route-provenance-truncation-invisible`
**FILED:** `CC-CMD-2026-09-13-route-scan-brace-balance-defeated`

`bodyOf` set `truncated: true` correctly and nothing downstream read it, so a
partial parse and a complete one landed in the manifest identically — Rule 99
inside the provenance instrument itself. Now carried through the merge and
emitted as `t: 1`, with the gate re-deriving truncation from the scanner rather
than trusting the committed file:
`ok every partial read says so (scanner 2, manifest 2, of 189 entries)`.

**2 of 225 routes truncate:** `/archive/` and `/mcp`. Four mutations break the
set / carry / emit wiring at each point; all caught.

**Raising `WINDOW` is strictly worse, measured:** 1500 → 2 truncated, 3000 → 1,
6000 → 1, 12000 → 0 — but at 12000 `/archive/` claims **50 hosts** (ATP, WHOOP,
Dropbox, Wikimedia, Bundesliga, every upstream in the worker; it fetches ~5) and
loses its `t: 1`. Under-reporting-and-flagged becomes
over-reporting-and-confident, on a value stamped onto live responses. WONTDO.

A block needing 12,000 lines to balance is not a 12,000-line block — the brace
counter is being defeated. Filed with a Task 0 that must print the line numbers
where depth crosses back above zero before anyone reaches for a fix; the
"it's the string literals" hypothesis is explicitly not claimed.


## SESSION CLOSE-OUT — 2026-09-13 (AmbientDO's swallowed alarm; two CC-CMDs close together)

**HEAD:** `af260f9` → `6089766` · **Branch:** main throughout
**Session doc:** `outbox/cc-session-2026-09-13-ambient-alarm-and-catch-collapse.md`

**CLOSED:** `CC-CMD-2026-09-12-catch-collapse-routes` ·
`CC-CMD-2026-09-12-ambient-do-setalarm-swallowed`

Done condition for both, and the artifact:

```
check-absence-collapse.mjs . --json
catch-collapse under src/ (unsuppressed): 0     (was 1)
suppressed total: 18
```

`ambient-do.js` is **clean, not suppressed** — the CC-CMD asked for that
explicitly, since *"suppressing a known concern to make a count go down is the
failure this whole rule exists to prevent."*

**The seven routes were already fixed and unclosed.** Verified at HEAD:
`d1AllOrError(stmt, label)` returns `{results, error}` with `results` null on
failure, callers branch on `error` never `results.length`, failed reads answer
HTTP 503 `{ok:false, error:'query_failed'}`. Its last blocking finding belonged
to the *other* CC-CMD by its own Rule 87.4 split.

**AmbientDO:** `_scheduleAlarm` was `.catch(() => {})`, and `alarm()`'s only
re-arm is that method — so a swallowed rejection stopped the cross-sport SSE
poll with no log anywhere. Now logs the DO id and delay, then retries **exactly
once**, bounded by a parameter rather than a timer or a loop.

**Two corrections to that CC-CMD's own framing**, from tracing rather than
repeating it: a dead instance IS re-armed by the next client connect (the second
call site), so the window is "clients connected, alarm dead, nobody new
arriving"; and the class is one instance — `bracket-do.js` and `user-do.js` call
`setAlarm` nowhere, `game-do.js` awaits it unguarded so a rejection there
propagates. Loud, not silent; left alone (Rule 69).

**Three harness defects fixed before the mutation result was trusted:** the stub
`this` lacked `_scheduleAlarm` so the retry path threw and the harness blamed
the product; dropping the retry guard made the check HANG rather than fail,
leaving the mutated file on disk (now bounded at 50 stub attempts, with a 20s
timeout reporting caught-but-HUNG); and `logs.some(...)` passed with the delay
deleted from the first line because the retry line also carried it — split
per-line, since an assertion over a collection proves something weaker than what
it was meant to say.

11 assertions, 4 mutations, all caught. Both wired into `deploy.yml`.


## SESSION CLOSE-OUT — 2026-09-12 (the odds zero was an identity join, and eight routes lied about D1)

**HEAD:** `9551b6d` → `cce2cd7` · **Branch:** main throughout
**Session docs:** `outbox/cc-session-2026-09-11-odds-cause.md`,
`outbox/cc-session-2026-09-11-odds-key-map-reconcile.md`,
`outbox/cc-session-2026-09-12-catch-collapse-routes.md`

22 work commits since the 09-09 close-out. Four threads.

### 1. The zero odds are the identity join, not the key maps or the quota

MLS, Bundesliga, CFB and NFL all read zero `opening_odds`. Three hypotheses
died: the sport-key map (the vendor serves all four keys), H1 timing, and the
H2 quota short-circuit. The cause is the identity join — CFB's five D1 rows
appear verbatim in the vendor sample with zero matches. Automated:
`odds-identity-join-saturday.yml`, cron `40 23 * * 6`.

### 2. Three numeric collapses, one of them a live cron

`quotaRemaining` could not distinguish "vendor sent no header" from "zero
credits left" (`src/index.js:6503`, `:6603`, `src/wp-resolver.js:268`).
`.github/scripts/odds-backfill.js` sized a whole day's budget from that
fabricated zero and silently no-opped at 10:00 UTC daily. `readQuotaHeader`
in `src/budget-helpers.js` returns `number | null`; both loops gate on the
null separately. Gate: `scripts/check-quota-gate-ordering.mjs`.

### 3. Eight routes answered `ok: true` on a failed D1 query

`.catch(() => ({results: []}))` at eight sites turned a query failure into an
empty result set. `d1AllOrError` / `d1FailureResponse` make it a 503 with
`error: 'query_failed'`. Contract in CONTRACTS.md; deploy run 34663070816;
all five GET-reachable routes verified 200 after.

### 4. `/context/game` answered a lookup for any string

`findBriefs` falls back to `id LIKE '%<id>%'`, so `/context/game/g19` — a
client slate POSITION, reassigned daily — returned five `mlb_game` briefs from
five different games on five different dates, and the client rendered one.
`classifyContextGameId` sorts an id into resolved / unresolved / unrecognized;
an unrecognized id gets 200 with every content field null and the four lookups
skipped. Gate: `scripts/check-context-game-id-forms.mjs`, 12 enumerated forms,
3 proven mutations. Client half: jubilant-bassoon `5931418f`.

### Open, each with a CC-CMD

- `CC-CMD-2026-09-12-ambient-do-setalarm-swallowed.md` — `ambient-do.js:950`
- `CC-CMD-2026-09-12-route-provenance-truncation-invisible.md`
- `CC-CMD-2026-09-11-odds-key-map-reconcile.md` Task 2 — budget projection,
  which also gates the `ucl`/`europa`/`conference` → `null` map gap

### User-only, not carry-forwards

`ODDS_API_KEY` is not set as a repo secret here — three workflows reference it
and the probe read `key_present: false`. The Odds API key is still in git
history in four repos and needs rotating at the provider.


## SESSION CLOSE-OUT — 2026-09-09 (four producers, and a canonicaliser that knew one)

**HEAD:** `d3e3efe` → `9551b6d` → `f18b98c` → this · **Branch:** main throughout
**Session doc:** `outbox/cc-session-2026-09-09-brief-sport-producers.md`
**Deploy:** 920, SUCCESS

`brief-label-migration` had failed on every scheduled run since 2026-08-24, and
applying it would not have helped: the count kept growing because nothing had
stopped the writers. **2 rows on 08-24, 7 on 08-31, 10 on 09-07, 12 today.**

### The four, traced to a line each

| value | rows | producer |
|---|---|---|
| `MLS Soccer` | 7 | client `game.league` — `field.js:31075`, `:41603` |
| `CFL – 2026 Season · Week 14` | 2 | client `game.league` (a caption, `field.js:9461`) |
| `PGA TOUR` | 2 | relay golf enqueue, `index.js ~8540` |
| `wc` | 1 | relay BracketDO, `bracket-do.js ~409` |

**The relay was emitting a value its own canonicaliser rejected.**
`canonicalizeWC26Sport` tested `=== 'wc26'` and `startsWith('fifa world cup')`;
BracketDO sends `'wc'`.

**`game.league` means two different things** — the relay's declared label for
relay-sourced soccer, and a display caption in the client's own hardcoded fixture
tables. So the residual was never four variants; it is whatever that field holds.
`WNBA – 2026 Season` is already in the client waiting for its first brief.

### The fix

`canonicalizeBriefSport` at both write boundaries, which were already wired.
Declared set of **28 labels measured from the live games tables**, not assembled
— `brief-label-migration.mjs` already paid for the alternative by calling 106
correctly-labelled rows non-conforming. `golf` and `wnba` are lowercase AND
correct and return unchanged before any rule runs. Casing recovery needs exactly
one match. An unrecognised value is returned unchanged, never guessed.

Both relay producers fixed at source too. The client was deliberately not
changed — the relay owns the contract (Rule 60) and a client-side normalisation
is the band-aid Rule 64 names. Recorded in CONTRACTS.md.

### Six mutations, two of which survived the first attempt

Ambiguity-ignored survived because the conforming check catches the lowercase
labels first, so casing recovery was never exercised at all. Removing the
conforming check survived because for all 28 labels the context-prefix helper
reaches the same answer — a true fact about today's labels, recorded rather than
hidden.

And `declared.size === 28` was simply wrong: it failed at 31 because three EFL
competitions are declared before their first archived game. The invariant is
coverage, not equality.

### Done condition

```
scope    12 rows, 0 unclassified
apply    12 of 12 changed, 0 skipped, 0 drift
verify   non_conforming_remaining []  recaps_remaining 0  CLEAN true
```

`verify` ran as a separate dispatch against a fresh read. **Green for the first
time since 2026-08-24.**

---

## SESSION CLOSE-OUT — 2026-09-08 (codex_write stopped destroying bodies; the recovery did not happen)

**HEAD:** `1b625b5` → `518978e` → `f2cf0fd` → `80673b0` → this · **Branch:** main throughout
**Session doc:** `outbox/cc-session-2026-09-07-codex-write-nondestructive-and-recovery.md`
**CC-CMD:** `docs/CC-CMD-2026-09-07-codex-write-nondestructive-and-recovery.md`
**Deploy:** 919, SUCCESS (85 gates + 13 verify steps)

### The guard

`codex_write` was a bare upsert: `content = excluded.content` destroyed the
prior value with no copy anywhere. On 2026-09-08 between ~03:11Z and ~03:14Z it
replaced **26** `cc-cmd-queue` bodies with verification notes.

`codex_history (id, key, category, title, content, replaced_at)` now takes a copy
whenever an update would change `content`. Signature unchanged, automatic —
the failure mode is a careless caller, and a caller who has to opt in is exactly
the caller who will not.

```sql
INSERT INTO codex_history (key, category, title, content, replaced_at)
SELECT key, category, title, content, datetime('now')
FROM codex WHERE key = ? AND content IS NOT ?
```

`IS NOT`, not `<>`: in SQLite `content <> ?` is NULL when content is NULL, so
that row would not be selected and a NULL prior state would go unjournalled.
The same clause makes it a no-op for a new key and for a rewrite that changes
nothing. One batch, and the ORDER carries the guarantee — the copy is attempted
before the upsert, so a failure refuses rather than destroys.

### Done condition — the scratch test, verbatim

```
PASS  a NEW key writes no history row
PASS  THE FIRST BODY SURVIVES IN codex_history
PASS  AN UNCHANGED REWRITE ADDS NO HISTORY ROW
PASS  the scratch key is gone from both tables

10/10 assertions passed
```

The third write is the teeth: a guard journalling on every write regardless of
change would satisfy "the first body survives" and be wrong.

### Task 0 — both diagnostics, and what they cost

**0a — no journal.** `change_log` carries 0 rows in the incident window and 0
codex-referencing rows **at any time**; `codex_history` did not exist. Measured
twice against the live database, not read off the source.

**0b — UNMEASURABLE, which is not "no window".** `wrangler d1 time-travel info`
returns Cloudflare `Authentication error [code: 10000]` on the D1 endpoint. The
same token succeeded for `wrangler deploy`, KV bootstrap and three cross-repo
secret syncs in run 34264096616 minutes earlier — so the token is valid and
lacks D1 permission specifically. Two measurements, not one reading.

`time-travel restore` was never run and must not be: it rewinds the ENTIRE
database, and 60 deployed routes read or write `d1:ARCHIVE_DB`, several on `*/5`
and `*/15` crons.

### Tasks 2–4 NOT RUN, and that is the correct outcome

Task 2's gate is "0a failed **and** 0b confirms a window". 0b confirms nothing,
and the CC-CMD is explicit: do not assume a window exists.

`cc-cmd-2026-08-08-desk-sports-followups` — the one row with no other copy
anywhere — is **unrecovered**. Its "no record in either repo" claim was verified
independently: filenames and file contents across `docs/` and `outbox/` in both
repos, four searches, all empty. `created_at 2026-08-08 22:38:47` is the only
surviving fact about the original.

### The follow-up is automated, not carried forward

`.github/workflows/timetravel-window-watch.yml`, weekly and dispatchable. It
re-asks whether the window is readable and reports one of three states; a
PENDING week commits nothing, so the one week it changes is visible. It
**reports and never recovers** — the side-restore exports production data, and
standing operations against production D1 are authorised case by case.

The classifier is fixture-driven (the real captured refusal among them) and was
mutation-tested before being trusted: always-AUTH_REFUSED, an exclusive
boundary, and latest-instead-of-earliest were each caught by the row written for
them.

### Corrections recorded rather than quietly fixed

- The CC-CMD's inherited count was **25**; measurement says **26**. Of 28 rows
  touched in the window, 2 have `created_at` inside it — new rows, not
  overwrites.
- The first diagnostics run printed "codex_history does not exist" when its query
  had returned **403 table not allowed** — the `/d1/execute` guard refusing the
  question, conflated with an answer.
- A workflow run id in the session doc's first draft was **invented**. Replaced
  with the id read back from the Actions API, and the correction left in the
  document.

### Open, and whose it is

Minting a `CLOUDFLARE_API_TOKEN` with **D1 read** permission is the only thing
that unblocks the recovery. The watch above is what notices.

---

## SESSION CLOSE-OUT — 2026-09-06/07 (a tennis draw, and a 128-ladder no slam could catch)

**HEAD:** `fd25196` → `9d029e9` · **Branch:** main throughout
**Session doc:** `outbox/cc-session-2026-09-06-tennis-draw-route.md`
**Deploys:** 912–917, all SUCCESS

### What shipped

Two routes and a model.

| route | what it does |
|---|---|
| `/bsd/tennis/draw?tournament=&season=` | one edition's bracket, edges joined by winner identity |
| `/bsd/tennis/tournaments[?category=]` | the paged competition census |

BSD serves **no** bracket — the 217-path schema census has no `/draw/` and no
`/bracket/`, and a match row carries no parent link. The edge is read anyway:
in single elimination a player appears in at most one match per round, so an
R64 winner appears in exactly one R32 match. Measured: **126 edges resolve to
exactly one next match, 0 ambiguous.**

### Done condition

`verify-tennis-draw` against the deployed route, **59/59**, four editions:

```
135/2025  64 31 16 8 4 2 1   123 edges re-derived   Carlos Alcaraz
 77/2026  64 32 16 8 4 2 1   126 edges re-derived   Mirra Andreeva
 14/2026  64 32 16 8 4 2 1   126 edges re-derived   Carlos Alcaraz
 63/2026  32 32 16 8 4 2 1    94 edges re-derived   Jannik Sinner
```

`tennis-tier-ladders`, all eight categories plus seven team events:
**637 of 637 tournaments read untruncated, 34 of 35 editions assembled, zero
interior holes, zero edge-rule violations, zero client split drift.**

### Three refusals, each measured before it was written

**A cancelled row is not a match in the draw.** Six players appeared in two
first-round rows across five editions; **six of six** were a `cancelled` row
beside its `finished` replacement, **zero** with two live rows. The player keeps
their slot and the opponent changes — a withdrawal. So 65- and 66-row first
rounds were never the vendor doubling a round; excluding cancelled rows puts
every edition at 127, which is what a 128 draw holds.

**A player twice in one round is a 409.** Found by field-laboratory's F# model,
which could not construct an input reaching its own `AmbiguousEdge` case: a
winner can only be in two next-round matches if that player is twice in that
round. The case was deleted there; the relay keeps both guards because the
reverse does not hold.

**Ambiguity is a 409, not a dropped edge.** A bracket with one guessed edge puts
a named player in a match they did not play.

### The two ends of a bracket

`canonical` was `1 << (6 - roundIndex)` — a 128 ladder — and **every edition
anything here had read was a slam**, so nothing could catch it.

| edge | the false claim | evidence |
|---|---|---|
| entry round | "R128 holds 32 where 64 make a full round" | 9 of 10 Masters flagged, **0 missing a match** |
| innermost round of a live draw | "QF holds 1 where 4 make a full round" | US Open Women 2026, 3 unplayed |

A Masters is a 96 draw (32 byes); Monte Carlo and Paris are 56 draws. Byes only
affect the entry round and the calendar only the innermost, so **everything
between them is exactly `2^(levels above the final)`** — held on all 35 editions,
across draw sizes 128, 96, 56, 32, 30, 28 and 26.

**The one true positive survives**: Toronto 2025's `R32=15` and US Open Men
2025's `R64=31` are interior, real, and still reported. A model that explained
them away would have hidden the only findings in the set.

### Open, and why

**One 409 stands. Antalya 3 (id 53), 2026.** Rus lost her R32 on 03-10 and is
scheduled in another R32 on 03-14 — **two events four days apart under one
tournament id**, main draw 36 rows where a 32-draw holds 31. The season
partition is the year of `match_date`; a match row carries no season field. A
date-clustering partition might work and might silently split a rain-delayed
slam, so it was not written. The payload now names the cause.

`atp_1000` holds **zero** tournaments — a dead entry in the client's tier table.
Reported by every weekly run.

### Automated

| workflow | cadence | what it catches |
|---|---|---|
| `verify-tennis-draw` | daily 06:40 UTC | ladder, edges re-derived, season partition, guards |
| `tennis-tier-ladders` | weekly Mon 05:10 UTC | every tier; **fails on client split drift** |
| `bsd-tennis-duplicate-rows` | dispatch, `TIDS=` | why a player is twice in a round |

The drift check is the only automated thing that can catch a stale team-event
list: those literals live in jubilant-bassoon and the truth lives here.

### Defects this session, all mine, all apparatus

1. The shape probe filtered on `tournament_id` — **already measured as silently
   dropped, with the answer in this repo's own outbox.** All eight slam ids
   returned identical rows and it reported `halves=false` as a property of the
   draws.
2. `/US Open/i` matched **US Open, Boys**; the sample player it printed was
   Jessica Pegula.
3. The 400 hint named `/bsd/tennis/tournaments`, **a route that did not exist**.
4. The tier reader printed `20 of 27` on a run where nothing failed — the
   team-event loop never incremented the counter. **A count only some of its
   subjects can move is not a count.**

---


## SESSION CLOSE-OUT — 2026-09-06 (a vendor newsletter surfaced a contradiction already in the repo)

**HEAD:** `afff86c` → `d9181cb` · **Branch:** main throughout · 4 commits
**Session doc:** `outbox/2026-09-06-bsd-param-behaviour.md`
**Probe artifact:** `outbox/bsd-param-probe-latest.txt` (committed by CI, survives the log)

### Why

BSD's August newsletter says the API now "rejects parameters it doesn't
understand instead of quietly ignoring them". Checking what that meant for FIELD
turned up a contradiction the repo was already carrying.

`src/index.js` had a comment, confirmed live 2026-08-01, saying `/api/v2/events/`
**silently ignores a bare `date=`** and returns an unfiltered page — which is why
the WC round/weather join uses `date_from`/`date_to`. Roughly **1850 lines
earlier**, `runBSDEndgameCapture` still sent `?date=`. One call site knew and the
other did not, and nothing connected them.

### Measured, not reasoned

`.github/workflows/bsd-param-probe.yml` → `outbox/bsd-param-probe-latest.txt`:

```
control page carries 21 date(s) in field 'event_date'; probing 2026-06-25

bare date=          HTTP 200   6 rows, 1 distinct date
date_from/date_to   HTTP 200   6 rows, 1 distinct date
bogus param         HTTP 400
league_id only      HTTP 200  50 rows, 21 distinct dates

accepted_parameters: ["date_from","date_to","league_id","limit","offset",
                      "round","season_id","stage","status","team_id","team_name"]
```

1. **`date=` filters now.** The 2026-08-01 comment recorded real behaviour; BSD's
   August overhaul changed it. Stale, not wrong — which is why it needed
   re-probing rather than re-reasoning.
2. **`date` is not in the accepted set**, yet returns 200 while an undocumented
   parameter returns 400. Nothing broken; one tightening pass from a 400 on a
   cron path.
3. **No RateLimit headers** on any of the four calls, though the newsletter says
   the API now returns them. Noted, unfixed, not claimed.

### Fixed — `runBSDEndgameCapture`, two lines

- `?date=` → `?date_from=&date_to=`. Safe because the equivalence was
  **measured**: both shapes returned the same 6 rows on the same date.
- `toISOString().slice(0,10)` → `getFieldDateKey()`. UTC midnight is not the
  FIELD day, and that helper's own comment records the failure it exists for —
  naive UTC advanced "today" at 8pm ET mid-primetime, before that evening's games
  finished. This is an endgame capture keyed on today's slate.

### The follow-up, so it cannot recur

`scripts/bsd-param-guard.mjs`, wired into `deploy.yml`. Every parameter sent to
`sports.bzzoiro.com` must be in the accepted set — taken from **the server's own
400 payload**, not transcribed from documentation, because the server is what
does the rejecting. Current reading: `date_from, date_to, league_id`.

Its self-test uses the **real line that was there** as the positive case, so it
is proven to catch what it was written for rather than only proven to run.

**What it does not do:** it cannot know when BSD changes the accepted set. That
is a fact about someone else's server and belongs to the probe, which asks.

### Two defects in the probe itself, both caught by reading its output

The first run printed four verdicts and three were unsupported. Its extractor
guessed `date | start_time | starts_at | datetime`; BSD uses **`event_date`**, so
it read zero dates from a 50-row page and its `distinctDates <= 1` test read
"could not see any dates" as "filtered to one date". **An extractor that cannot
see is indistinguishable from a filter that works** — the substitution the probe
was written to catch, committed in its own reader.

Also `league_id=27` is the World Cup, which had no fixtures on the probed date,
so both filtered calls returned empty and the question was unanswerable. Fixed:
the date field is discovered and its key printed, a non-empty page yielding no
dates reports CANNOT READ DATES, verdicts return UNKNOWN naming the blocker, and
the control runs FIRST so the probed date is one that carries fixtures.

### Credential state, corrected

`bootstrap-relay-secret.yml`'s header claimed the value "appears exactly once in
src/index.js (~9257)". Recounted:

| | |
|---|---|
| hardcoded occurrences in `src/index.js` | **13** |
| sites reading `env.RELAY_SHARED_SECRET` | 1 (literal as fallback) |
| auth comparison sites | 2 |

The `~9257` reference is **removed rather than corrected** — the comparisons are
past 15400, and a number that moves whenever the file grows is a citation
guaranteed to be wrong again. The grep finds them by content.

**Rotation order, now recorded in that file:** remove the 13 literals so `env` is
the only source, **then** rotate. Reversed, the workflow reinstalls the old
value. No secret value appears in any commit or document.

`SIBLING_REPO_TOKEN` no longer appears anywhere in this repo; the carry-forward
about a watcher skipping its daily run for a missing token is stale and dropped.

---

## SESSION CLOSE-OUT — 2026-09-05 (provenance: 6 of 186 routes could be judged, now 182)

**HEAD:** `18bc9d2` → `afff86c` · **Branch:** main throughout · 26 substantive commits
**Deploys:** 890–900, all green.
**Session doc:** `outbox/cc-session-2026-09-05-provenance.md`
**View:** https://claude.ai/code/artifact/a1afea94-e7d5-4848-82f8-a03a4cbf00d0 — regenerates daily from the census

### Why

Five defects earlier in the session were each found by a probe pointed at
something else: five odds call sites spending unaccounted, every `us,eu` call
charged half, a fabricated odds row served for 72 days, 48 stale `mlbRaw`
entries, an F# build read as its own source.

One shape every time — **a value is served and nothing says where it came from
or how old it is.** A census put a number on it: **6 of 186 data surfaces** could
be judged without opening `src/index.js`.

### The answer was two choke points, not 132 edits

| | mechanism | cost |
|---|---|---|
| responses | `fetch` → `_fetch` → `stampProvenance` at the single exit | 1 edit, 186 routes |
| stored values | `env` wrapped at `fetch` and `scheduled`, plus each Durable Object | 6 edits, 62 KV writes |

Headers, not bodies, so response bytes are unchanged and no consumer broke —
Rules 60 and 70 never came into it. It also covers the 23 proxy routes, the class
that cannot be fixed in a body at all because we never construct theirs.

**KV metadata, not a value envelope.** 16 of the 62 writes store the bare string
`'1'` as a warn flag, read back as `if (await KV.get(k))`; others store a bare
number. Wrapping those would not have failed — they would have silently stopped
meaning what they mean.

### What is live

| layer | state |
|---|---|
| header | 186/186 stamped: route, kind, source, served-at, **data age** |
| store | every KV write attributed to `route:`, `cron:` or `do:` |
| manifest | **182 of 186 name a real source**, generated from the code, gated against drift |
| ledger | reconciled against the provider's `X-Requests-Last`, both directions |

The 4 that do not name a source say why: `/rss-proxy` fetches a caller-supplied
URL, `/health/sources` reads through a dispatch table no static parser follows,
and two `/test/*` routes are genuinely pure.

### Standing guards, all blocking in `deploy.yml`

| gate | proven mutations |
|---|---|
| `check-route-provenance.mjs` | 7 |
| `check-kv-provenance.mjs` | 9 |
| `check-odds-calls-guarded.mjs` | 4 |
| `check-odds-reconciled.mjs` | 4 |
| `check-no-fabricated-values.mjs` | 3 |

`provenance-runtime-probe.mjs` runs on every successful deploy and daily. Its
load-bearing assertion is **drift**: deployed `X-FIELD-Source` against the
committed manifest, because a stale worker answering from a map of code that no
longer exists is indistinguishable from a correct answer unless something
compares.

### The odds ledger was wrong in both directions in one day

Morning: five call sites spent provider quota and charged nothing, and every
`us,eu` call was charged half — measured, not assumed, from
`X-Requests-Last: 6` on a 3-market call over 2 regions. Evening: the corrected
ledger charged 4 for a call the provider billed 0. Both make `ODDS_HARD_LIMIT`
mean something other than what it says. Now reconciled against the receipt, with
cache hits worth zero regardless of the header they replay.

### Germany v Ecuador, closed after 72 days

`/wc/odds-probs` pushed a hand-entered row — pHome 0.56, lambdas off a screenshot
— whenever the Odds API did not list the fixture. A defensible two-week bridge on
2026-06-12 whose own exit condition ("once the Odds API lists this game") became
unreachable at kickoff on 06-25. Measured 09-05: `probs: 1` with provider cost
`0`, meaning zero WC events listed and the single row was the fabrication.
Deleted, not corrected — the fixture is complete and its real closing line was
never captured. `check-no-fabricated-values.mjs` guards the source; a permanent
runtime assertion guards the served response.

### The finding that governs the rest

**Seventeen defects, and fifteen were in the measuring apparatus.** Every wrapper
— response stamp, KV write, KV read — worked first time and needed no correction.
What failed repeatedly were the census, the manifest generator, the gates, the
tests, the probes, and once the mutation harness itself.

Two rules were written from that count, not from principle:

- **Rule 90 (MUTATE-FIRST-A)** — an assertion is not trusted until it has failed
  on purpose. Six defects are tabulated in `CLAUDE.md` with why each passed.
- **Rule 91 (SAMPLE-COVERAGE-A)** — a sampling probe states its coverage where
  the result is read. The runtime probe checks 6 routes of 186 and said PASS;
  status reports then claimed "186/186 verified live" for hours.

The audit of the 21 routes labelled "reads nothing" is the case study: **19 were
reading something the parser could not see**, across six distinct blind spots —
an else-if chain that truncated the body to two lines, a block longer than the
scan window, a constant declared inside a function, a binding name too short to
match, a constant whose name lacked "BASE", and a child route whose prefix parent
knew more than it did.

### Residual, disclosed

- **The body layer is RETIRED as a target**, not open. `outbox/decision-2026-09-05-body-layer-retired.md`
  carries the evidence: the client stores a transformed structure so relay body
  fields never reach it, the relay's own KV caches already carry writer and time
  in metadata, 24 passthrough routes have no body of ours to put anything in, and
  all 186 routes already carry the same facts in headers. The census still counts
  it — the number is real and free — under a label that says it is retired.
  The sharper reason was the old label: `none` read "a value with no visible
  origin", which became false the day the response wrapper shipped. Labels now
  describe only what they check.
- **`unstamped` is 5 of 8 on `prefix=odds`.** Expected — keys written before the
  wrap expire on their own TTL. The probe now fails if it RISES, which is only
  assertable because every write path is wrapped.
- **`cf-cache-status` vocabulary is partly unmeasured.** Only `HIT` is treated as
  zero-cost. Observed so far: `EXPIRED`, `HIT`. `STALE` and `UPDATING` would be
  charged a replayed receipt; that over-charges, the safe direction. The probe
  tallies what this worker actually produces and fails once it sees one the
  reconciler mis-prices. Deliberately not fixed from memory.
- **`/d1/execute` is still gated by a hardcoded string literal**, not an env
  binding, in a public repo. Unchanged from 2026-09-03. Fix order: source first,
  then retire `bootstrap-relay-secret.yml`, then rotate.

## SESSION CLOSE-OUT — 2026-09-03 (the duplicate MLS rows, and who writes them)

Covers 2026-09-01 through 2026-09-03.

**HEAD:** `ccc39ce` → this commit · **Branch:** main throughout
**Deploys:** 888 / `33655153163` green (`ce32eaa`, carrying `d253209`);
889 / `33712050255` green (`17ec554`, the provenance instrumentation).
**Session doc:** `outbox/2026-09-03-d1-write-provenance-control.md`

Three CC-CMDs, one closed, one open with two tasks done, one open at Task 1.

### The question

51 MLS fixtures exist twice in `regular_season_games`, under two id schemes:
`MLS_2026-08-29_dcunited_lafc` (ours) and `2026-08-29-mls-dc-lafc` (not ours).
`created_at` moves on the second, the day AFTER the game it covers — measured
twice, a month apart, most recently 2026-08-31. That is an INSERT, not an update
of a seeded row.

### What shipped

| commit | change |
|---|---|
| `d253209` (deployed in `ce32eaa`) | `/archive/game`'s id keys on a bare numeric ESPN event id when one is present, so two spellings of one club upsert onto one row |
| `ca00ee9` | probe: can this repo's token read Analytics Engine? **HTTP 200.** The CC-CMD had said no session credential covers that read — written from reading, not from trying |
| `47c27f3` | `d1_write_provenance` verdict, five states; and the hole that let it in — the "can reach PASS" loop iterated `CAN_PASS`, so a verdict with no entry there was exempt from the one check saying it can ever go green |
| `ce32eaa` | check 6 in `verify-staged-items.mjs`, reading AE over 48h; the deploy's `staged-verifier-check` gate clears |
| `3635050` | the numeric-key done conditions, asserted against the DEPLOYED worker |
| `9ece38e` | `scripts/d1-write-sites.mjs` — **285 `prepare()` sites, 87 writes, 0 unreadable** |
| `42c2f30` | the verify script's relay gate moved to `process.env`; the exposed-secrets ratchet had gone 115 → 116 and it was right |
| `17ec554` | the provenance instrumentation: `src/d1-provenance.js` and ten call sites |
| `6f59058`, and two before it | the control, rebuilt twice as Analytics Engine's sampling was measured rather than assumed |

### The findings

**A grep could never have answered Task 1.** The SQL is written as multi-line
template literals, so `grep -n 'INSERT INTO'` finds the line a word is on and
nothing about which binding it runs against. The enumerator balances parens and
tracks string state. Its first run reported one UNREADABLE — `CREATE TRIGGER`
behind a twelve-line indented comment, a write that would have been silently
missing. And it found `src/index.js:19459` (`:17571` when this was written),
`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
reached from `POST /savant/sync` — a fully dynamic INSERT that no search for
`INSERT INTO regular_season_games` could ever have found. It is excluded by an
allowlist holding one table, `pitcher_expected_stats`.

**So no path in this repository can INSERT a dash-scheme row**, and that is now a
measurement rather than the result of not finding something.

**Which narrows what the instrument can claim, and the CC-CMD says so.** It
proves the write is not ours; it cannot name an external writer. That needs
Cloudflare's own D1 audit or an origin column stamped at insert time, neither
reachable from a route the writer does not call. Recorded before Task 2's edits
rather than discovered after them.

**Scope: 10 sites, not 87.** 20 of the 87 are schema statements and 57 target
tables the question does not concern. The instrumented set is every runtime write
to `regular_season_games` and `postseason_games`. Task 1 answers the "an
unwatched door" objection by reading, permanently, at zero runtime cost.

**Golf is the assertion that mattered.** `golf_<eventId>` is a per-TOURNAMENT key
covering R1..R4 as separate rows. A numeric-key change that passed "two spellings
collapse to one row" and failed "a golf key still yields two" would be data loss
wearing a success. Both are asserted.

### Residual, disclosed

- **197 rows (18.2%)** of the 1085-row census keep the team-name key — non-numeric,
  non-`golf_` source ids or none at all. Outside `d253209`'s reach; not claimed.
- **The 51 duplicate pairs remain.** A single upsert key both writers can agree on
  cannot be designed until the second writer has a name.
- **`d1_write_provenance` reports PENDING daily** until the instrumentation deploys
  and a 48h window containing a day-after-game elapses.
- **`/d1/execute` is gated by a hardcoded string literal**, not an env binding, in a
  public repo. Recorded in `docs/CC-CMD-2026-09-02-d1-write-provenance.md`
  deliberately rather than as a public issue. The fix has an order: source first,
  then retire `bootstrap-relay-secret.yml`, then rotate.
- **`guards.yml` had been red since 2026-09-01** on three separate failures, two of
  them mine: a stale HANDOFF (this section), the exposed-secrets ratchet at 116 of
  115 (`42c2f30`), and three bare doc citations taking the count to 12 of 9. All
  green now. `guards.yml` runs only on non-`src` pushes and reports separately from
  `deploy.yml`, so a red job there blocks nothing and went unread for two days.
- **Analytics Engine's `_sample_interval` is a stream-level rate, not a per-site
  count.** Four control runs: 9 writes → 5 rows, 9 → 7, 90 → 20, 90 → 20, and the
  sum exact every time. The first run fit "one point per invocation" perfectly and
  that model was wrong. Per-site claims moved off AE onto the routes' own
  responses. See `outbox/2026-09-03-d1-write-provenance-control.md`.

## SESSION CLOSE-OUT — 2026-08-29 (CFB landed, and three labels were unscoped)

**Deploys:** `bad7971` green (CFB seeded), `7a0caad` in flight.
**Live proof, first FBS slate, 2026-08-29:** `cfb-first-slate` run 33251392427,
**4/4** — 8 ESPN events, CFB rows present in `/context/date` under the declared
label, and `#14 USC` a real poll rank rather than the unranked sentinel 99. That
last one closes a STAGED item open since 2026-07-15.

### What shipped

| commit | change |
|---|---|
| `c52f496` | CFB seeded — label `CFB` declared before any row landed |
| `bad7971` | the LEAGUES count ratchet the seed row tripped |
| `41140b6` | the CFB checker: `NOT OBSERVABLE` neutral on the cron, `UNREACHABLE` never neutral |
| `ba8fe22` | the archive fetch had the same defect as the ESPN one above it |
| `7a0caad` | three seeded labels classified to null; the check that connects the two tables |

### The finding: null is not "no exemplars", it is all of them

`detectSportClass('CFB')` returned **null**. `'cfb'` matches none of `nfl`,
`football`, `cfl` — `NFL`, `CFL` and `College Football` all classify, and the one
string the archive serves does not.

`voiceRegisterFor`'s fallback keeps EVERY segment, so an unclassified sport is
written against basketball, hockey, soccer, football, tennis and golf exemplars
at once, while looking classified. This file's own comments already record that
happening to CFL and to golf before 2026-08-24.

**A census over all 22 seeded labels found three.** CFB, plus `EFL Cup` and
`EFL Trophy` — `'efl cup'` does not contain `'epl'`, one transposed letter, and
those two have been unscoped for weeks through every review they have had.

`cfb` → football, sharing Exemplar I; `efl` → soccer. `LEAGUES` declares a label
and `detectSportClass` must recognise it, and nothing connected those two:
`scripts/check-seeded-labels-classify.mjs` now does, blocking in `deploy.yml`.

### Residual, measurable and dated

- **Peak volume, 2026-09-05.** 8 games measured opening day; a September Saturday
  is 80, against a shared odds ceiling that now includes
  `cfb: 'americanfootball_ncaaf'`.
- **`groups=80` still unappended**, re-verified only on dates carrying 0 or 8
  games. Week 1 Saturday is when FCS games exist to be excluded.
- **Two soccer-odds asks regressed** on 2026-08-27 and stay fatal in
  field-laboratory: 42 soccer games, 9 spreads, none soccer. Three candidates,
  none measured.

## SESSION CLOSE-OUT — 2026-08-27 (the NFL EP model moved here)

**HEAD:** `ccc39ce` → this commit · **Branch:** main throughout
**Deploys:** 7d95d2f green. Live probe run 33123265487, post-deploy:
Seahawks at Titans, **149 route plays / 149 client plays / 0 disagreements**,
12 enumerated pairs all non-zero.

**Client landed the same day:** jubilant-bassoon `7f6fab4`, smoke 986/0,
SW_VERSION `2026-08-27a`. `_computeESPNPlayEPA` is deleted there.

### What shipped

| commit | change |
|---|---|
| earlier | `GET /nfl/epa/plays?event=` + `src/nfl-epa.js` + transcription check + live probe |
| `7d95d2f` | the situation inputs, and a `currentDrive` that answers its own name |
| this one | the probe manifest records its checks by name; CONTRACTS.md synced |

### Three defects found, all the same shape

**The route passed the whole `epa_table.json` document to the lookup.** The
1120 EP entries live under `.ep`. Every key missed, `?? 0` came back, and the
live probe reported "ROUTE MATCHES CLIENT — 0 disagreements" — both sides
agreeing on a field of zeros, because only the client had unwrapped. The tell
was a touchdown scoring exactly 6.96. `epTableFrom` plus four shape assertions
plus three non-vacuity assertions now stand where that agreement did.

**`currentDrive` was named for one thing and measured another.** It read
`drives.current ? all.length-1 : (all.length ? all.length-1 : null)` — two arms,
one expression. It meant "the drive in progress" and computed "the index of the
last drive", going null only on a game with no drives at all. Its only consumer
needs to know whether a drive is live. It answers that now, and `driveCount`
carries what it used to.

**Both "verbatim" copies of the client reference had silently dropped its
`downs`/`sit` lines.** Nothing compared `situation`, so the omission cost
nothing and stayed invisible — until a new check read `ref.situation` and got
the string `"undefined"` for all 305 plays. A reference pruned to what is
currently checked is not a reference; it agrees with whatever it was pruned to
match. Restored in both, and both now assert the label rebuilds from the three
served numbers byte for byte.

### Follow-up, automated

`.github/workflows/nfl-epa-route-probe.yml` fires on `workflow_run` after a
successful **Deploy RELAY Worker**, and now also on a daily cron — the client is
a live consumer of this route as of today, so drift needs to break a check
without a session being open to notice it. A run that finds no NFL game with
plays exits 1 with `NOT OBSERVABLE`, which is a real answer, not a pass.

## LANDED 2026-08-26 — the soccer draw price reached a client

`5a2bacc` (deploy 874, 2026-08-24) made `extractOddsForGame` project the h2h
draw into `opening_odds.moneyline` via `drawPriceFrom` in `src/odds-shape.js`,
identifying it by POSITION — the outcome that is neither team — so a renamed
selection cannot silently drop it again.

**Observed live 2026-08-26**, field-laboratory drift-sentinel run 32923712900,
probing `/context/date/2026-08-25` — the first slate captured against the
deployed adapter, since `opening_odds` freeze at capture (~10:01Z on the game
date). That slate carried EFL Cup 17, UCL Qualifying 3, EFL Trophy 2, La Liga 1,
MLS 1.

The laboratory has promoted the ask from open to landed, which makes a
regression here fatal on their side: a soccer moneyline that stops carrying a
draw sends `winProbability` back to `ThreeWayDrawMissing`. Their off-day case is
`null`, not a failure.

Filed there as `docs/CC-CMD-2026-08-23-soccer-three-way-odds.md` (CLOSED) and
`outbox/2026-08-26-soccer-draw-landed.md`.


## SESSION CLOSE-OUT — 2026-08-25 (golf modelled, two credentials, four guards)

**HEAD:** `9f6bbbb` → `ccc39ce` · **Branch:** main throughout
**Deploys:** 875 (`218ede4`) and 876 (`0607526`), both green. Odds verified live
after the key removal: `/cfl/odds-probs` returned four games at 18-19 bookmakers
with `"remaining":"47407"` — a real call through the changed code path.

**Session docs (Rule 67)** — `outbox/2026-08-25-*`:
`non-contest-probe`, `odds-key-removal`, `doc-citations`.

### What shipped

| commit | change |
|---|---|
| `218ede4` | a tour is not a sport — golf stops being archived through the team-sport walker |
| `0607526` | the Odds API key removed; `update-odds-key.yml` **deleted**; secrets ratchet gate |
| `94679a4` | the shared-secret CC-CMD corrected against HEAD |
| `5a962f6` | three holes in the secret scanner; the count it published was low |
| `6ce3bc4` | a doc citation must be anchored, because line numbers rot |
| `cf88ac0`, `ccc39ce` | two odds CC-CMDs, both with census evidence behind them |

### The golf fix, and why it was flagged on the ENTRY

`src/index.js`'s LEAGUES table now carries `individual:true` on the golf row,
carried into `gameMeta` and gated at the catch-up write.

Two rows existed for ESPN event 401811963 — the BMW Championship. One correct
(`sport='golf'`, `home='BMW Championship'`, `away='R4'`,
`note='Wyndham Clark -17'`) from the golf-aware `[GOLF-BRIEF]` path. One from
this walker: `sport='PGA Tour'`, both names null, `home_score=away_score=-6`.

**That `-6/-6` was never a tie.** The walker derives sides with
`teams.find(t => t.homeAway === 'home') || teams[0]` — a fallback for
neutral-site fixtures that cannot tell a neutral site from a leaderboard. On a
golf event it returns the first two PLAYERS, whose `.team` is undefined because
a golf competitor carries `.athlete`. Round one's leaders, names stripped.

Flagged on the entry rather than tested as `sport === 'golf'` at the use site,
so Korn Ferry, Champions, LPGA and DP World carry the fact with them instead of
needing the gate widened four more times.

### Two credentials, and three published counts that were all low

The Odds API key is gone from four files, and
`.github/workflows/update-odds-key.yml` was **deleted rather than edited**: its
only job was `wrangler secret put ODDS_API_KEY` from a repo literal, under a
step named "Set ODDS_API_KEY to 20K plan key" — while writing the **exhausted**
key. One dispatch would have replaced the working production key and printed a
green checkmark.

The shared secret's exposure was published three times in one day and each
figure was low: **~41** (from grepping `src/`), then **114** (a scanner with a
hole), now **115**. And "the Odds key is out of the repo" meant out of ONE repo
— jubilant-bassoon still had it in three files, with its own ratchet now.

That is the argument for the ratchet in `docs/exposed-secrets.sha256`: the
number is a floor that may only come down, not a fact.

### Four new deploy gates

| gate | what it refuses |
|---|---|
| `check-individual-sports-not-archived` | a golf-shaped event reaching the catch-up write |
| `check-exposed-secrets` | a known credential appearing more often than declared |
| `check-doc-citations` | a document quoting a fragment that is not in the file |
| `three-way-odds-check` | (2026-08-24) a soccer h2h without its draw |

### Open, with the human named

1. **Rotate `RELAY_SHARED_SECRET`** — `docs/CC-CMD-2026-08-25-rotate-relay-secret.md`.
   The order is **source-first**, and that is not the obvious order:
   `bootstrap-relay-secret.yml` extracts the value FROM `src/index.js`, so
   rotating first leaves a dispatchable job that reinstalls the old one. Steps
   1, 2, 4, 5 are automatable; step 3 needs Cloudflare and GitHub credentials.
2. **The PGA Tour archive rows** — recommended against deleting; they are inert
   and are the reason `Unnamed` exists. Proposal kept with its exact predicate.
3. **Three CC-CMDs awaiting a session:** `golf-slate-line` (the same broken
   derivation feeds the journalism prompt, and `buildGolfCronContext` has no
   caller at all), `spread-price-capture`, `misjoined-opening-odds`.

### What the laboratory measured about this relay

- **The band `favouriteAgreement` declines to judge is empty.** 143 games,
  47.6% agreement — a coin flip, twice measured.
- **Its disagreements are one-sided.** 9 of 143 home-favourite games, **0 of 80**
  away-favourite. That is a feed or adapter artefact, not market behaviour.
- **Three MLB rows on 2026-06-28 hold another sport's odds.** Total 3.5 where
  MLB runs 7-11, `captured_at` equal to `finalized_at`, no `_oddsProof`.

---

## SESSION CLOSE-OUT — 2026-08-24 (seven asks, eras 5 and 6, ten new gates)

**HEAD:** `95bf3c0` → `021c43c` · **Branch:** main throughout
**Deploys:** 869-874 all green. Live verification on 873: `quality-source=fresh`,
journalism generating, both 400 validations correct.

**Session docs (Rule 67)** — `outbox/cc-session-2026-08-24-*`:
`recap-window-generated-vs-touched`, `scale-declared-vs-implemented`,
`era-6-margin-agreement`, `scorethreshold-fossil`,
`aggregate-launders-unknowns`, `soccer-attempt-enrichment`, `name-graph`,
`negative-examples`, `style-gating`, `cite-golf-analytics`, `voice-exemplars`,
`soccer-three-way-odds`.

### The six-item queue, all closed — plus the one open CC-CMD found after

| # | item | outcome |
|---|------|---------|
| 1 | `finality-dimension` | **era 5** — Dim 11 reads game state |
| 2 | `matchup-note-starvation` | **era 6** — Dim 10 reads the result, not a note |
| 3 | `scoreThreshold` 110 → 196 | **deleted** — read by nothing for 39 days |
| 4 | `n: null` in `/quality/report` | **fixed** — it was publishing `briefs_counted: 0` beside `cleared_196: 66` |
| 5 | `soccer-near-miss-enrichment` | **built** — woodwork and attempts, labelled separately |
| 6 | `prompt-numeral-mining` | **fixed** — plus the STYLE lines the ask ruled out |

### The seventh: soccer three-way odds

`CC-CMD-2026-08-23-soccer-three-way-odds` was the only OPEN command left in
field-laboratory after the queue closed. Built as relay `5a2bacc`.

```
"moneyline": { "home": 125, "away": 180, "draw": 240 }
```

**The draw was never dropped — it was never asked for.** `extractOddsForGame`
matched h2h outcomes against `home` and `away` and nothing else; soccer prices
three, and the third matched neither predicate. Fifteen MLS games measured
2026-08-23, every one two-way, so field-laboratory rendered "three-way market;
no draw price served" on every soccer card.

Identified **by position, not by name** — `o.name === 'Draw'` is an unverifiable
literal and a renamed selection would drop the price again, the same class that
emptied `UNREACHABLE_DIMS` the same day. No sport check: a two-outcome market has
no third entry, so the SHAPE enforces "non-soccer gains no null draw".

**PREMISE VERIFIED 2026-08-24T23:48Z**, and it had not been when the fix shipped.
The command asserts the feed prices three outcomes; that was inherited (Rule 72)
and the sandbox 403s `*.workers.dev`, so it went to CI:

```
PREMISE HOLDS — 10 of 10 sampled soccer h2h markets price three outcomes
soccer_usa_mls  30 games  Chicago Fire @ Seattle  {home 170, away 120, Draw 285}
soccer_epl      20 games  Man City @ C Palace     {home 400, away -165, Draw 320}
```

`outcome_count: 3`, `third_selection: "Draw"` on every one. The feed **does** call
it "Draw" today, so a name match would have worked — position costs nothing extra
and survives a rename. Routed through the relay's `/odds` proxy and its 3600s
cache: at most two credits, zero on a hit (Rule 78 — this repo burned 19,999 of
20,000 in one June sitting).

Artifact `outbox/odds-h2h-shape-20260824T234850Z.json`, workflow
`odds-h2h-shape-probe.yml`, probe `df64b28`.

**Awaiting the artifact, and the wait is structural.** field-laboratory's
`cc-cmd-followup.mjs` probes `/context/date/${yesterdayUTC()}` and `opening_odds`
freeze at capture (~10:01Z on the game date), so the first slate captured against
the deployed adapter becomes "yesterday" for the **2026-08-26 02:30Z**
drift-sentinel run. Runs #46 (13:02Z) and #47 (23:21Z) on the 24th both read
pre-deploy rows — a `false` from either is arithmetic, not evidence. A check-in
is scheduled for 2026-08-26 03:15Z (`trig_01H5WvdFB2EzsMJroVF92BAA`).

If that run reads `false` on a post-deploy slate, the premise is no longer a
candidate — the fault is between the adapter and `/context/date`.

### Eras 5 and 6

```
era 5  Dim 11 finality agreement, 20 pts, funded from arc 45->33 and ctx 25->17
       LIVE_LANG gap  -14.1 (4.4x se)  ->  -0.2 (0.1x)  — one instrument, both runs

era 6  Dim 10 re-pointed from matchupNote ECHO to margin agreement, 30 pts
       rows judged  0/190  ->  17/128 (13.3%), first real defect caught
       repeated byte-identical across two runs
```

### Three recorded figures corrected

- **Era 4's `+11.5`** was a simulation, not a measurement. The live gap is
  **4.5 and is noise**. Half the SCALE table was documentation: dims 6-10 carried
  their ceilings as literals and the declared weights were read by nothing.
- **Era 5's headline `-11.1`** was taken from the AFTER run's `candidates` block
  while `-0.2` came from the same run's `rescored` block — two instruments read as
  a before/after. `DIM_TO_SCALE` still named `matchupDepth`/`matchup` and had no
  `finality` entry, so that block rebuilt a **244-point rubric and reported 294**.
- **Era 2 recorded one of its commit's two changes.** `6aed3bb` is era 2's
  boundary commit; its `change` field notes the scoring half and omits the
  retry-gate removal named in its own subject line — which is what orphaned
  `scoreThreshold`.

### Ten new deploy gates

```
check-scale-matches-implementation             declared weight = code ceiling
check-slate-caps-are-derived                   caps derived by calling the functions
check-opts-keys-are-read                       a passed key must be read by its callee
check-aggregate-launders-unknowns              no ?? / || between a missing field and a sum
check-name-graph                               every name resolves to a name that exists
check-negative-examples-are-not-instantiable   a forbidden example must not be copyable prose
check-no-foreign-league-in-prompt              no sport's prompt names another sport's league
finality-agreement-check / margin-agreement-check   the two new dimensions' 2x2s
three-way-odds-check                           soccer h2h yields a draw, no other market does
```

All ten are unconditional `run:` steps — none can skip silently. 16 guards green.

### Contamination: the structural cause, and the number

Sport content was **universal by default and scoped by exception**, so every
addition reached every sport until someone gated it — silently. Four instances in
one day. The worst: `voiceRegisterFor` gave any sport with no segment of its own
**all** of them, live on **905 of 1322 finalized games (68.5%)**, MLB alone 830.

Closed by authoring exemplars **H (baseball), I (football), J (golf), K (tennis)**
and classifying CFL and atp/wta. Every briefed sport now has a class and its own
exemplar; the keep-everything fallback survives only for the mixed-sport slate.

Figures in H-K are `##`, unlike A-G — A-G's real numbers are precisely the
literals layer 2f exists to catch the model mining.

### The recurring defect class, named

A value whose name and measurement disagree. Eight instances this session, from
`docs/history-boundary.txt` pointing at a rebased-away sha to `scoreThreshold`
being a whole subsystem with only its consumer removed. `check-name-graph` is the
registry the six single-edge guards were each written instead of: run against
real pre-fix source it reports all three of era 6's rename breaks at once, which
took three separate days to find by hand.

### Open, with unblock criteria

- **No post-deploy EPL sample** for either the recap-context wiring or the
  attempt enrichment. Unblocks on the next EPL matchday; verify via
  `staged-verification.yml` check 4 with an EPL row carrying `generated: true`.
- **Dim 10's separation is UNDERPOWERED** — 16 agrees against 1 disagree.
  Unblocks at `margin_census.separation.n_disagrees >= 2`; the weekly cron
  (`0 6 * * 1`) reaches it or does not on its own.
- **34 rows make no closeness claim, 24 have a game row with a null
  `home_score`.** Both counted in every `rescore-quality-6b` manifest.
- **Five positive exemplars still carry real figures** (`29.0 PPG`, `48 minutes`,
  …). They are sport-gated now, so each reaches only its own sport, and 2f
  catches a leak. Neutralising them is content authoring.

### Security items still awaiting a decision

- Rotate `field-relay-cron-2026` and drop the relay's compiled-in literals
  (27 in `src/index.js`, 1 in `analytics-engine.js`, 5 workflows, 8 docs).
- Rotate/redact the `GITHUB_PAT` found in plaintext in a Drive doc — repo+workflow
  scope, can write secrets into all four repos. The value has never been
  reproduced in chat and must not be.

**Closed from the previous entry's "unchanged" list:** `scoreThreshold` 110 → 196
and `n: null` in `/quality/report`. Both turned out to be defects rather than
tuning: one inert, one publishing an arithmetic impossibility.

---

## SESSION CLOSE-OUT — 2026-08-23b (ask 6b, scoring era 4)

**HEAD:** `7c75dad` → `95bf3c0` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-23-ask6b-scoring-weights.md`
**Artifacts:** `outbox/rescore-quality-6b-2026-08-23T144*.json` (three runs),
`outbox/quality-scale-verify-20260823T145535Z.json` (11/11 live)

| commit | what |
|--------|------|
| `09aada2` | measure ask 6b's baseline before moving any weight |
| `91626aa` | evaluate candidate weightings on the rows already scored |
| `74dc759` | 245 is the ceiling for a slate brief, not for every brief |
| `95bf3c0` | era 4 — weight the dimensions that tell a finished game from an unfinished one |

Deploys 847 and 848 green. Live verification 11/11.

**Era 4**

```
arc 45->55   ctx 25->32   temporal 20->25
voice 30->20 density 16->10 matchup 30->24      nominal total held at 300
```

Measured on the same 190 rows before and after: in-progress/final gap
**6.4 → 11.5** points, **2.8× → 4.2×** the standard error. n=95 per class.

**Two premises this session had to correct**

- A first re-score over the 160 most recent rows reported the gap REVERSED.
  That sample was 144 finals to 16 in-progress; stratified to 95/95 the
  original direction holds. The artifact from the wrong run is committed and
  the session doc says which to believe.
- `UNREACHABLE_DIMS` called `ctx` unreachable "by construction". It scored
  above zero on 181 of 190 real rows. 245 is the slate-brief ceiling; the
  game-shape ceiling is 276 and the 240 bar is 86.96% of it, not 97.96% —
  which changes what "0 of 523 cleared 240" means.

**New deploy gate:** `check-scoring-era-recorded.mjs`. A `SCALE` edit without
a `SCORING_ERAS` entry now stops the deploy, and an era entry whose
`measuredEffect` carries no number is rejected. Negative-tested.

**Carry-forwards — both filed as commands, not carried (Rule 87)**

- `CC-CMD-2026-08-23-finality-dimension` — nothing in `scoreProse` reads game
  state; reweighting's ceiling is 41.6 and costs the rest of the rubric.
- `CC-CMD-2026-08-23-matchup-note-starvation` — Dim 10 scored zero on 190/190;
  `regular_season_games.note` is populated on 36/1284 finalized games.

Unchanged from earlier sessions: `scoreThreshold` 110 → 196 (needs a retry-cost
estimate), `n: null` in `/quality/report` rows.

---

## SESSION CLOSE-OUT — 2026-08-23 (recaps now say what happened in the game)

**HEAD:** `77eff06` → `90e6c99` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-23-match-events.md`
**Artifacts:** `outbox/scoring-containers-2026-08-23T05-58-*.json` (pre-build
probe), `outbox/staged-verification-20260823T061855Z.json` (post-deploy)

**Shipped**

| commit | what |
|--------|------|
| `8701b6b` | the sport-key table's multi-word entries were never reachable |
| `644d7f6` | ground briefs in ESPN scoring plays (ask 5) |
| `8c7b5a6` | run this session's quality-chain guards at the deploy gate |
| `90e6c99` | check 4's column names, read from the schema this time |

Deploy 846 green, all 13 gate steps. Client `575e5d3` mirrors CONTRACTS.md
byte-identically.

**Verified vs staged**

- VERIFIED here: `scripts/match-events-check.mjs` 25/25 and
  `scripts/sport-key-check.mjs` 13/13, both blocking at the gate. The
  sport-key negative tests fail against the pre-fix lookup, which is the
  artifact that the defect was real.
- STAGED: that a live recap names a scorer. Not a note — check 4 of
  `scripts/verify-staged-items.mjs` on the daily 06:00 schedule. Run 14
  reported `PENDING — no game_recap in the six sports since match_events
  deployed`, seven minutes after the deploy, which is the correct answer and
  proves the check runs end to end. Tonight's slate answers it.

**Two things found while building, both fixed**

- Every multi-word key in the sport-normalization table had been unreachable
  since it was written, so a D1 row reading "Major League Baseball" resolved
  to no ESPN slug and `buildESPNSummaryContext` returned '' with no error.
- Four guards written on 2026-08-22 were wired into nothing and would have
  kept passing while the code they guard drifted.

**Carry-forwards**

- A third sport-key table, `_CONTEXT_LEAGUE_TO_SPORT` (`src/index.js` ~8452),
  maps league labels to the same keys in the other file. Currently correct and
  consistent, which is when a table is cheapest to consolidate. Its own commit.
- NBA and NHL scoring containers are PENDING, not assumed — both out of season
  in August. Re-probe at season open; a wrong container presents as a silently
  missing block.
- `CC-CMD-2026-08-23-soccer-near-miss-enrichment` (filed in field-laboratory):
  ask 5's `commentary` layer was not built and is a second command, not a
  follow-up line.

---

## SESSION CLOSE-OUT — 2026-08-22b (the 240 bar has never been cleared)

**HEAD:** `aca5c93` → `e128a4f` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-22-quality-scale-verified.md`
**Artifact:** `outbox/quality-scale-verify-20260822T234307Z.json`

Ran the DONE CONDITION that `cc-session-2026-08-16-quality-bar-scale.md` wrote
for itself and left UNVERIFIED for six days on sandbox egress —
`rule-gha-for-sandbox-egress-blocks` says that is not a stopping point. All four
of that session's own assertions **PASS** live: `reachable_ceiling === 245`, and
`cleared_196` numeric on all 47 rows.

**The finding — 523 briefs over 7 days:**

| bar | cleared | rate |
|---|---|---|
| 240 (documented "excellence") | **0** | 0% |
| 196 (`FOUR_FIFTHS_REACHABLE`) | 61 | 11.7% |

No brief has ever cleared 240. With 55 of 300 points unreachable by
construction (`ctx`, `matchup`), 240 is **97.96% of what a brief can earn** — a
near-perfect-score requirement wearing an 80% label. **196 discriminates**,
which closes the adoption question 08-16 explicitly deferred.

**`scoreThreshold: 110` is inert, not wrong.** Both sites (`src/index.js:8855`,
the path writing every EPL game brief; and `:7337` wc-morning) predate the 240
standard. EPL briefs average 141.4, so 110 is cleared by ~30 points and the
retry gate never fires. NOT changed: 240 would fail all 523 into max-retry
exhaustion, 196 would retry ~88% — a Rule 78 spend decision needing a cost
estimate first.

**Also found:** `/quality/report` returns `n: null` on every row; totals derived
from `below_240` instead. Filed, not fixed (Rule 60/69).

**Re-runnable:** dispatch `verify-quality-scale.yml`.

---

## SESSION CLOSE-OUT — 2026-08-22 (staged FAIL diagnosis: a third closing-odds writer)

**HEAD:** `5f2fabb` → `aca5c93` · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-22-staged-fail-diagnosis.md`
**Deploy:** run 834 (`0d74e2b`), 21:13:25Z, success

Two staged checks were FAILing. `soccer_opening_coverage` was the probe's fault
— it called a regression off a single fixture; over 30 days EPL rose to 66.7%
and La Liga to 22.2%, both above baseline. A 4-game floor now holds small
samples at PENDING.

`closing_after_opening` was real. The 41 failing rows came from a **third
closing_odds writer** — `/archive/game` — that wrote **no change_log row**, so
it had no attribution, and whose `start_time` gate did not test finality. It
fired pre-kickoff and pre-filled `closing_odds`, permanently defeating
AmbientDO's `WHERE closing_odds IS NULL` guard: 19 hook writes in all of
history. Second, independent cause: `captured_at` was stamped `new Date()` even
for noon-UTC historical snapshots, so the check was comparing cron execution
order, not market time. Both fixed (`f6fa820`, `a1937eb`).

**State:** `closing_after_opening` PENDING · `soccer_opening_coverage` PASS ·
`epl_brief_event_grounded` PARTIAL · **no false FAILs remain.**

**Follow-up is automated:** `staged-verification.yml` now runs daily at 06:00
UTC, reversing its own earlier "no schedule" argument — every answer so far had
required a human to remember to dispatch it.

**Standing:** the Odds API key is still unrotated, and `ODDS_API_KEY_FALLBACK`
in `src/index.js` is a hardcoded key constant in a public repo. Remove it as
part of rotation.

---

## SESSION CLOSE-OUT — 2026-08-20 (UEFA club competitions: archived at last)

**HEAD:** `8a6d05e` → `8289762` (feat) → `07b987e` (ci) · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-20-uefa-club-competitions.md`
**Serves:** `docs/CC-CMD-2026-08-20-uefa-club-competitions.md` (filed by field-laboratory,
in that repo — not this one).

**The ask was already half-done, and its premise was stale.** `V2_LEAGUES` has
carried `ucl`/`europa`/`conference` with the exact slugs and BSD lids requested
since the June 26 migration, and `SOCCER_LEAGUE_LABELS` already declared all six
labels. Probing HEAD first (Rule 87) is what surfaced that.

**Real root cause — a third table nothing guarded.** `/context/date` reads ONLY
`ARCHIVE_DB`; the archive is written by the journalism cron iterating the
`LEAGUES` table (~L7500), which had no UEFA row. So `/v2/games?sport=ucl` worked
on demand while nothing was ever persisted — `/context/date/2026-08-19` listed 49
games with no Champions League among them, against config that reads as complete.
(Note: `/archive/query?sport=` reads the BRIEFS table, not `regular_season_games`.
The CC-CMD cited `count: 0` from it as games evidence; it is not. Its `/context/date`
measurements are the sound half.) The existing live
"Soccer league label contract check" passes either way, because an on-demand
fetch is healthy with or without a `LEAGUES` row.

**Declared labels (the laboratory's answer to ask 2)** — `sport` AND `league`
both carry the same string:
`UEFA Champions League` · `UEFA Europa League` · `UEFA Europa Conference League`
· `UEFA Champions League Qualifying` · `UEFA Europa League Qualifying` ·
`UEFA Europa Conference League Qualifying`.
The CC-CMD's suggested labels (no `UEFA` prefix) appear nowhere in this repo and
would have split each competition across two archive id namespaces.

**Qualifying slugs included deliberately.** Probed 2026-08-20 via CF-Worker
egress: `uefa.champions?dates=20260819` → `events: []`, while
`uefa.champions_qual` → real fixtures. The CC-CMD's own cited observation date is
a qualifying matchday, so the literal three-entry ask would have rendered zero
games on the very date that motivated it. Main-draw slugs stay empty until the
league phase opens 2026-09-16 per ESPN's calendar.

**Guard added (`07b987e`):** `scripts/check-leagues-label-contract.mjs`, blocking,
pre-deploy. (A) every soccer `LEAGUES` label is a declared `SOCCER_LEAGUE_LABELS`
value; (B) every `espnLeague`-routed soccer `V2_LEAGUES` key has a `LEAGUES` row,
except allowlisted `eflchamp`/`eflone`/`efltwo`. Both negative-tested — they fail
by name, and (A)'s test uses exactly the label the CC-CMD proposed.

**Integration status: VERIFIED end to end.** Deploy succeeded on `07b987e`
(13:09Z). Archive confirmed by CI-as-proxy probe (`uefa-archive-probe.yml` +
`scripts/probe-uefa-archive.mjs`, `d5a1002`) — a runner POSTs `/d1/execute`,
which binds `ARCHIVE_DB` and allows `regular_season_games`. Manifest
`outbox/uefa-archive-probe-manifest-20260820T131905Z.json`: `landed: true`,
**43 UEFA rows, 36 dated today** (Conference qual 24, Europa qual 12, UCL qual 4),
real fixtures (Shamrock v KuPS at Tallaght; Getafe v Partizan; Braga v Vienna).

The earlier `count: 0` readings were the briefs-table trap, not a missing write
path. `query_ok` is separate from `landed` in the manifest so a broken probe can
never be misread as an empty archive.

**Label fragmentation: CLOSED.** The probe found one row outside the six declared
labels — `2026-05-27-conference-crystalpalace-rayovallecano`, `sport: 'UEFA
Conference League'`, `created_at 2026-07-05`, from the early-July hand-seeded
schedule import (its id uses the legacy `{date}-{comp}-{home}-{away}` slug form, not
the cron seed's). Fixed by `6b0525f` — a dispatch-only, `APPLY`-gated, idempotent
one-shot that targets the row by primary key, asserts pre-state, and re-reads to
verify. Dry run then apply: `rows_changed: 1`, `verified: true`. Re-confirmed by
the independent archive probe: `labels_missing: []`, `nonconforming_count: 0`,
43 UEFA rows across all six declared labels.

Both one-shot workflows (`uefa-archive-probe.yml`, `uefa-label-fix.yml`) are
dispatch-only with no `schedule:` — deliberately, per the 2026-08-16 workflow
waste audit. They are inert until fired.

---

## SESSION CLOSE-OUT — 2026-08-16 (quality-bar scale: all 3 asks executed)

**HEAD:** `665c68f` (+ this) · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-16-quality-bar-scale.md`
**Serves:** `docs/CC-CMD-2026-08-15-quality-bar-scale.md` (filed by field-laboratory).
Reporting/measurement only — **no scoring behaviour changed**.

**The finding:** 55 of the 300 rubric points are unreachable BY CONSTRUCTION in the
Worker runtime — Dims 7 (context) and 10 (matchup) have no game object and return
N/A→0. So the flat 240 bar is 80.00% of the nominal rubric but **97.96%** of what a
brief here can actually earn, and `below_240` near 100% is an arithmetic certainty,
not an editorial verdict.

**Ask 3 (derive the ceiling)** — added a `SCALE` table to `src/journalism-quality.js`
and derived `NOMINAL_TOTAL` (300), `REACHABLE_CEILING` (245), `FOUR_FIFTHS_REACHABLE`
(196) from it. `scoreProse`'s local `W` now derives from that same table instead of
holding a second copy — two parallel copies would drift, which is the exact failure
this ask exists to prevent. Verified the derivation reproduces every documented
figure: base 150 / nominal 300 / reachable 245 / four-fifths 196 / 80.00% / 97.96%.

**Ask 1 (name the scale)** — `/quality/report` now emits `quality_scale`
{nominal_total, reachable_ceiling, unreachable_dims, unreachable_points, flat_bar,
flat_bar_pct_of_nominal, flat_bar_pct_of_reachable, four_fifths_of_reachable}.
Emitted ALONGSIDE `below_240`/`above_240` rather than renaming them — the CC-CMD
offered either, and renaming breaks every current consumer (Rule 60).

**Ask 2 (cleared_196)** — the CC-CMD called this "the one thing worth running D1
for". It does not need a separate D1 session: `/quality/report`'s query is ALREADY a
`GROUP BY` over ARCHIVE_DB computing below_240/above_240 with the same
`SUM(CASE WHEN …)` shape, so this is one more line in a query that already runs. The
adoption question it deferred — is 196 discriminating or another unreachable bar —
is now answerable from the endpoint on every call, permanently. Self-completing
(Rule 87) instead of a carry-forward.

**Integration status:** code VERIFIED statically (`node --check` both files; all four
imported names resolve; derivation assertions pass). Live response UNVERIFIED from
sandbox (403s `*.workers.dev`); lands on the next push-triggered deploy.
DONE CONDITION (Rule 90): `GET /quality/report` returns
`quality_scale.reachable_ceiling === 245` and every `summary` row carries a numeric
`cleared_196` — exact curl+assert in the session doc.

**Correction:** an earlier claim in this session that the CC-CMD sat on a `claude/*`
branch was WRONG — `14ac236`/`55a3a34` are on main. Misread a coincidental
"[new branch]" line from an unrelated fetch. No branch-policy violation.

**Not executed here:** `docs/CC-CMD-2026-08-16-quality-coverage-route.md` (`be8b38f`)
— expose jq-scoring-coverage on a GET (per-day series, era3ByType, `scoring_version`
on /archive/query). Complementary but a separate CC-CMD. Also note: there is no
`/quality/coverage` route today; only `/quality/report` and `/quality/backfill-scores`.

**Companion client work (jubilant-bassoon):** NFL standings dropdown — 4 stacked
defects, 3 fixed, 1 OPEN (ESPN v2 standings returns HTTP 200 with an error body for
browser-origin requests). See that repo's HANDOFF.

## SESSION CLOSE-OUT — 2026-08-15b (ESPN fantasy ownership route)

**HEAD:** `6532d9d` (+ this) · **Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-15-fantasy-ownership-route.md` — DONE, confidence 96
**Deploys:** 31853774282, 31854044681 — success. Done-condition artifact:
`outbox/verify-fantasy-ownership-*.log` 10/10 PASS (limit=400→count=400, Gibbs 99.87% owned).

`GET /fantasy/ownership` — ESPN percentOwned/percentStarted/ADP per player, reshaped to a
small `{ espnId: {name, proTeamId, percentOwned, percentStarted, adp} }` table, top-N by
ownership, zero-owned dropped, 6h edge cache. Transform not passthrough: kona_player_info is
header-driven (relayFetch keys on URL only) and the full set is ~25MB.

**ADR-002:** commodity (ESPN publishes it) + pull-only + proxy-not-compute + edge-cache-not-a-binding.
NOT a drama/watch/RUWT value. (Initial "engagement-adjacent" framing was wrong and corrected.)

**Caught + fixed live (Rule 77):** ESPN ignores the x-fantasy-filter limit (2615 rows for any
limit); the param was a no-op fragmenting the cache. `6532d9d` made it a real post-fetch cap.

**Cross-repo status (Rule 61):** relay half only. No client consumer yet — the NFL card is where
this renders, alongside the NGS/injuries chips. Client wiring is the open end-to-end step.

---

## SESSION CLOSE-OUT — 2026-08-15 (NFL data integrity, paired with jubilant-bassoon)

**HEAD:** `2e5f4d8` (+ this commit) · **Branch:** main throughout
**Session doc (Rule 67):** `jubilant-bassoon/outbox/cc-session-2026-08-15-nfl-b-pipeline-fixes.md`
— DONE, confidence 97 (the work is mostly client-side; both repos' commits are covered there)

Two relay commits, both paired with `jubilant-bassoon 317f9cb`:

1. **`680ac26`** — `ngs-passing.json` added to `NFLVERSE_OUT_ALLOWED`. It was in
   `NFL_R2_FILES` (R2-first) but not the fallback allow-list, so unlike
   `ngs-receiving`/`ngs-rushing` an R2 miss fell through to the allow-list check
   and 403'd, despite a fresh copy existing in the client's `outbox/nfl/`.
   Measured latent, not live: `outbox/nfl-route-coverage-probe-*.log` shows all
   three serving 200 from R2 today. `pfr-rec.json` / `player-stats.json`
   deliberately NOT added — they are R2-only (written by this relay's own cron)
   and would 404 rather than serve.

2. **`2e5f4d8`** — `runNFLR2Update` (`src/nfl-r2.js`): refuses zero-row writes
   (`count` was computed then ignored — same defect as MLB Savant `7588b24`), and
   stamps `season`/`targetYear` to match the client pipeline's envelope.

**Why #2 was necessary, not scope creep:** `nfl/{year}/ngs-passing.json` has TWO
independent writers — the client pipeline (Mon 07:00 UTC, nflverse **parquet**)
and this relay cron (Wed 12–15 UTC, legacy **CSV**). Wednesday runs last, so it
would have stripped the client's new season labelling off every week.

**Open, gated:** `docs/CC-CMD-2026-08-15-ngs-passing-two-writers.md` — one key,
two writers, two sources is the real defect; #2 only makes the race harmless for
the fields we know about today. That CC-CMD also covers this writer's hardcoded
`nfl/2026/` prefix, which diverges from the route's dynamically computed year
(`src/index.js` ~15797) from August 2027.

**NFL route coverage, measured today** (`outbox/nfl-route-coverage-probe-*.log`):
6/17 allow-listed files serve 200. The six nflverse Stage-1 tables
(`team_epa`, `qb_metrics`, `receiver_metrics`, `defense_metrics`, `schedule_refs`,
`team_tendencies`) all 404 — the relay half of that design was built in May and
the producing pipeline never was.

---

## SESSION CLOSE-OUT — 2026-08-14 (J-layer model provenance)

**HEAD:** `12e4018` (+ this commit)
**Branch:** main throughout
**Session doc (Rule 67):** `outbox/cc-session-2026-08-14-jlayer-model-provenance.md`
— DONE, confidence 97

**What changed:** `/test/gemini-judge` reported a hardcoded
`model: 'gemini-via-proxy'` — an assertion, never a reading. It now returns the
`X-FIELD-Model` the proxy actually sent, plus `X-FIELD-Gemini-Error`, using the same
provenance headers `src/index.js:8915` already reads at the journalism call site.

**Measured before changing (Rule 72):** CLAUDE.md's "Gemini 3.1 Flash-Lite primary,
Haiku 4.5 fallback" claim is **confirmed** — 6/6 calls across two runs answered by
`gemini-3.1-flash-lite`, header present every time, `X-FIELD-Gemini-Error` empty
every time (2026-08-14, direct POST from a GH Actions runner; fallback-under-quota
behavior NOT exercised). Artifacts:
`outbox/jlayer-model-probe-20260814T0126*.log` (before) and `...T0135*.log` (after,
live, `judgeRouteMatchesReality: true`).

**Deploy run 31760675673 attempt 1 failed and attempt 2 passed on identical code** —
a CF 1101 from field-claude-proxy in the post-deploy WOW 6 probe, not from this diff;
re-run rather than reasoned away.

**RESOLVED same day** — `docs/CC-CMD-2026-08-14-verify-test-model-override.md` executed.
Session doc: `outbox/cc-session-2026-08-14-test-model-override.md` — DONE, confidence 96.

The override **is** honored; round 1's null result was caused by sending a Claude
model name, which is outside the proxy's allow-list and falls through to the default.
But the discriminating arm found a live regression: **`gemini-3.5-flash` returns HTTP
500 from field-claude-proxy, 3/3, against 3/3 interleaved unforced controls at 200** —
deterministic, cache excluded by unique prompts. It worked on 2026-07-16.

**Production unaffected** (nothing in production sets `X-FIELD-Test-Model`; 9/9
unforced calls returned `gemini-3.1-flash-lite`). Two in-repo consumers are dead and
annotated in place, not deleted: `/debug/gemini-model-test` (`src/index.js` ~8926) and
`scripts/gemini-model-sanity-check.mjs`.

**Worth reading in that session doc:** the probe printed `VERDICT B — override
ignored, dead weight` and that verdict was **wrong**. Its predicate swept HTTP 500
into the same bucket as "answered with a different model" — opposite conclusions.
Accepting the summary line would have concluded the mechanism was dead weight while
missing the regression. Fixed at the root; non-200 is now its own class.

**J-layer impact check (asked and measured, not inferred):** a fresh `jq-health-watch`
run (`outbox/jq-health-watch-20260814T100504Z.log`) confirms the model work changed
nothing in the production journalism path — routing is unchanged and no production
call sets the override. Two real deltas vs the 08-13 baseline, neither caused by it:

1. **Era-scoped calibration ACTIVATED for `game_recap`** — the watch item from the
   08-13 provenance pass. `era_scoped=true`, era-3 n=19, and the threshold moved
   `157 → 184`. This raised `alert_count` `14 → 18`: the Dim 4 fix lifted scores, the
   era-3 p25 followed, and sports that cleared the old bar no longer clear the new
   one. Working as designed — the alert rise is the instrument re-zeroing, not a
   quality regression. `alert_count (legacy predicate)` held flat at 23 throughout.
2. **11 `pre_game` briefs never scored**, oldest 27 days — gated below. Distinct from
   the 4 unscored rows the same run showed in-window, which were in flight and scored
   within ~3h.

**RESOLVED same day** — `docs/CC-CMD-2026-08-14-unscored-pre-game-backlog.md` executed.
Session doc: `outbox/cc-session-2026-08-14-unscored-pre-game.md` — DONE, confidence 96.
Done condition artifact: `unscored rows (repo-wide, not window-scoped): 0`
(`outbox/jq-unscored-triage-2026-08-14T13-25-32-902Z.log`, post-deploy). Deploy 31804447440.

**Root cause was NOT the literal-NULL insert** the CC-CMD suspected. 105 of 116
pre_game rows come from that same writer and ARE scored. `context_hash` identified the
real mechanism: **105/105 scored rows were scored by a CLIENT round-trip** through
`/archive/brief`, whose upsert does
`quality_score = COALESCE(excluded.quality_score, briefs.quality_score)`. Where the
client never re-posted, the row stayed NULL forever — hence 4 days holding both scored
and unscored rows, which reads as intermittent because it tracks client behavior.

**Fix (`93ce859`):** bounded score-fill in the existing dead-hours block — max 5/tick,
all brief_types, Rule 5 guarded, `ORDER BY created_at ASC`. The ASC is load-bearing:
`/backfill/brief-scores` orders DESC, so any backlog past its LIMIT starves its own
tail permanently. Server-side completeness no longer depends on a client action.

**Not yet observed firing** — dead hours only (UTC 02:00–10:00) and there is currently
nothing to score. First real exercise needs a future NULL row.

**Disclosed side effect:** the 11 rows were scored under era-3 code but carry no
`scoring_version` (stamp-on-write still unbuilt), so the date-derived era will
attribute them to **era 2**. Small (11 rows, none `game_recap`) but it is this
session's recurring defect — a derived value with no stored provenance — resurfacing.
Strengthens `docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md`; no new CC-CMD.

**Open, gated:** `docs/CC-CMD-2026-08-14-gemini-35-flash-route-500.md` — the fault is
in `workers/field-claude-proxy`, outside this repo's scope. Deliberately no relay-side
workaround (Rule 64/76). Cause unknown: the 500 body is a CF error page with no
`error code:` string, and `X-FIELD-Gemini-Error` does not populate on that path.

**Trap for the next session:** this working clone was shallow (52 commits, back to
2026-08-11 only). `git log -S` silently returns nothing for earlier history — run
`git fetch --unshallow` before any archaeology.

---

## SESSION CLOSE-OUT — 2026-08-13 (BSD average-positions + JQ scoring instrument)

**HEAD:** 47ba213 (+ this commit)
**Branch:** main throughout
**Session docs (Rule 67):**
- `outbox/cc-session-2026-08-13-bsd-avgpos.md` — DONE, confidence 95
- `outbox/cc-session-2026-08-13-jq-density-unit-fix.md` — DONE, confidence 95
- `outbox/cc-session-2026-08-13-jq-provenance-pass.md` — DONE, confidence 95 / 96
- `outbox/cc-session-2026-08-11-archive-gap-real-write-path.md` — DONE, confidence 96

### What changed, all verified against the live worker

1. **BSD average-positions served from `/stats/`** (`f6a1fd5`, `1e6b449`,
   `1f08656`). The dedicated endpoint 404s unconditionally — settled by
   probing a LIVE match (event 207955, `2nd_half`), which every prior
   investigation lacked and which CONTRACTS.md had recorded as an open
   question since 2026-07-15. Route now 200s with real player coordinates.
   The capture path's dead level-1 fallback removed, and an empty-write guard
   added: `{}` is what a match in progress returns and would otherwise
   overwrite populated positions.

2. **JQ Dim 4 measured the wrong unit** (`940e06b`). It counted
   `properNouns + numbers` while citing a rule that governs numbers, and was
   FLOORED for 91.2% of a 592-brief corpus. Now `numbers/sentence`: floored
   7.9%, mean contribution 0.35 → 9.89 of 16 points.

3. **`/quality/report` counted failures against a different number than it
   reported** (`88adb01`). Hardcoded 240 in SQL vs the calibrated p25 in the
   alert. 13 permanently-firing alerts, several reporting `failure_pct: 100`
   while exceeding their own threshold. Self-contradictory alerts now 0, and
   the same response carries the old predicate's count for comparison:
   **23 → 14**.

4. **Scoring provenance stored** (`430dfdf`, `496ea93`). `briefs.scoring_version`
   plus `SCORING_ERAS`, so calibration runs within a scoring era instead of
   across a mixture of two instruments. 3,156 historical briefs labelled
   (1941/1158/1, with 56 boundary-date rows correctly NULL).

### Method worth reusing

For a value that is a pure function of its inputs, **measure the inputs, not
the rendered output**, and compute every candidate variant over ONE dataset in
ONE run. The density census did this and its before/after is exact and
repeatable; the alert predicate did not, and its baseline was lost to elapsed
time until `alert_count_legacy_predicate` recovered it.

The session's unifying diagnosis: **a stored derived value with no stored
provenance**. Three independent instances — `pitch_arsenals` (empty R2 object
indistinguishable from never-fetched), BSD `average-positions`, and
`quality_score`.

### Open, with specs

- `docs/CC-CMD-2026-08-13-jq-dim1-unit-and-taper.md` — Dim 1's identical
  conflation (deliberately NOT changed: unlike Dim 4 it is not saturated) and
  the taper peak that docks its own exemplar 45%.
- `docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md` — 13
  `INSERT INTO briefs` sites need enumerating before being stamped.
- `docs/CC-CMD-2026-08-10-pre-window-mls-duplicates.md` — 82 pre-window MLS
  duplicate groups, mechanism unmeasured.
- `docs/CC-CMD-2026-08-08-fa-cup-coverage.md` — blocked on ESPN rolling
  `eng.fa`; that claim is now ~5 days old and needs re-probing (Rule 72).

### Automated, not carried

`.github/workflows/jq-health-watch.yml` — daily 09:00 UTC, runs scoring
coverage + report verification and commits the artifact. Scoring measured
healthy at **312/312 over 7 days**. Era-scoped calibration is deployed but not
yet active: era 3 needs ≥5 briefs *per brief_type* (~0.3 days for
`game_recap`, ~7 for `epl_match`, possibly never for `compound`).

---

## SESSION CLOSE-OUT — 2026-08-06 (soccer-label-fix + CI honesty) — FINAL

**HEAD:** d0b9139 (+ this commit)
**Branch:** main
**Session docs:** `outbox/cc-session-2026-08-06-apply-soccer-league-label-fix-v2.md`,
`outbox/cc-session-2026-08-06-deploy-verify-commit-push-race.md`,
`outbox/cc-session-2026-08-06-close-rule-registry-carryforward.md`

### ⚠️ SUPERSEDES a carry-forward the last two close-outs both repeated

The 2026-07-25/27 and 2026-07-26/27 entries below both carry forward:

> `verify` job continues failing on pre-existing Rule-90 staleness gate
> — Rule-90/91/…/96 staleness gate — separate session, still pre-existing.

**That was accurate when written and became false on 2026-07-31.** Commit
`c2d2327` moved the staleness check out of `deploy.yml`'s blocking
`verify` job into the standalone, non-blocking
`rule90-staleness-monitor.yml` (daily). Those historical entries are left
intact above/below as the honest record of what those sessions saw — this
entry supersedes them. **Do not re-inherit "deploys are blocked by Rule
90"; they are not, and have not been since 2026-07-31.**

But do not read that as "nothing outstanding" either:

- The **staleness condition is still real and still red daily** —
  `rule90-staleness-monitor.yml` has failed every run since at least
  2026-08-02. It no longer gates deploys; it is still an honest signal.
- As of this session: `rule-92` (Watch Engine WC tier selection),
  `rule-93` (OTW momentum), `rule-94` (`_fieldDataReady` sentinel) remain
  UNEXERCISED at 25.7 days. **This is correct, not a gap to close** — no
  session has had a genuine applicable case, and Rule 90's own text calls
  an honest UNEXERCISED "the correct signal to surface… not a false alarm
  to suppress." Flipping them without a real case is fabrication (Rule 2).
- `rule-90` itself was flipped to EXERCISED this session with a real case
  (run `31117941940`): the carry-forward above is *itself* an instance of
  RULE-COMPLIANCE-FOLLOWUP-A — the mechanical artifact held the true state
  while the human-propagated HANDOFF channel went stale and wrong.
- `rule-98` (added 2026-08-03) is UNEXERCISED but only ~3 days old — not
  yet stale, no action needed.

### Commits this session
- `3235749` — fix: archived soccer games labeled by real competition, not always the World Cup
- `7f51bdd` — fix: verify job's lost push race no longer reports healthy deploys as failures
- `9078d8a`, `fa3e37c` — soccer-league mislabel scope probe (slate/scope/apply/verify) + weekly regression guard (`504b0e5`)
- `b2baf5f`, `d0b9139` — one-shot rule-registry exercise (rule-90 only)

### Result
- **Soccer label bug fixed; 52 rows mislabeled as the World Cup corrected
  to their real competition (all MLS)**, 103 genuine World Cup rows
  untouched, 0 mismatches remaining. Weekly regression detector added
  (`soccer-league-mislabel-scope-probe.yml`, Mondays).
- **Deploy runs can report `success` again.** Run `31114735011` is the
  first fully-green run; `verify`'s `Commit results` step no longer fails
  the whole run on a lost push race, while a genuine *permission* failure
  still fails loudly.

### Known-noisy, not a defect
GitHub Actions had a real platform incident during this session —
`Failed to resolve action download info. Error: Service Unavailable`
killed three runs in `Set up job` before any repo code ran
(`31115370947`, `31116882733`, `31117153055`). Unrelated to any change
here. The one-shot exercise workflow was rewritten to drop its
unnecessary `actions/checkout` dependency as a result.

### Carry-forwards
- None from this session. The Rule-90 item above is **not** a
  carry-forward — it is a standing, correct signal with no action
  available until a genuine case for rules 92/93/94 arises.

---

## SESSION CLOSE-OUT — 2026-07-26/27 (journalism-brief-history) — FINAL

**HEAD:** cff1477
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-26-journalism-brief-history.md

### Commits this session
- `cff1477` — feat: add /journalism/brief/history endpoint -- browse past slate briefs from ARCHIVE_DB

### Result: /journalism/brief/history SHIPPED (relay side VERIFIED, client side STAGED)

- Root cause: `/journalism/brief` only reads FIELD_JOURNALISM KV (24h TTL) — could never show more than today's brief.
- Fix: new route reads the durable `ARCHIVE_DB.briefs` table (`brief_type='slate'`), same table `findBriefs()` already queries for `priorBrief`. No new storage, no new write path.
- `GET /journalism/brief/history?limit=N` (default 14, capped 1-30) → `{ok, count, briefs:[{date, brief, proseScore, wordCount, model, source, generatedAt}]}`.
- **Field-naming flag:** `generatedAt` here is a SQLite UTC string, NOT epoch ms like `/journalism/brief`'s `generatedAt`.
- Live verification (verbatim, `probe_relay_route`): HTTP 200, 3 real archived briefs returned across 2026-07-25 and 2026-07-26, newest first.

**CI gate note:** `verify` job continues failing on pre-existing Rule-90 staleness gate. Unrelated to this change — `deploy` job (structural probes, wrangler deploy) succeeded.

### Carry-forwards
- Client-side CC-CMD (jubilant-bassoon) needed to wire the Journalism tab to this endpoint — out of scope for this relay-only session.
- Rule-90/91/92/93/94/95/96 staleness gate — separate session, still pre-existing.

---

## SESSION CLOSE-OUT — 2026-07-25/27 (playground-secret-bootstrap) — FINAL

**HEAD:** ea2bf38
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-25-playground-secret-bootstrap.md

### Commits this session
- `175e1f6` — ci: add field-playground CLOUDFLARE_API_TOKEN bootstrap step to deploy.yml
- `48873cd` — fix: correct Salsa20/HSalsa20 rotation -- >> to >>> (unsigned) in sealedBox
- `b145307` — docs: session close-out — playground-secret-bootstrap [skip ci]
- `0729094` — feat: add /delete route to Deploy Courier + one-off step to remove field-playground/wrangler.jsonc
- `ea2bf38` — ci: remove one-off wrangler.jsonc delete step (task complete, avoid permanent scope creep)

### Result: playground-secret-bootstrap COMPLETE + wrangler.jsonc cleanup COMPLETE

- Bootstrap step added to deploy.yml. Mirrors jubilant-bassoon bootstrap pattern exactly.
- Root cause of prior 422: `sealedBox()` used signed right shift `>>` in HSalsa20/Salsa20 rotations. Fixed to `>>>` throughout `hsalsa20()` and `salsa20Blk()` in `workers/field-deploy/src/index.js`.
- Courier response (verbatim): `{"ok":true,"message":"Secret CLOUDFLARE_API_TOKEN created in jeffunglesbee-create/field-playground"}`
- `deploy-playground.yml` dispatched and succeeded (GHA run `4b89406`, 2026-07-25T23:39Z). Live HTTP 200 check embedded in that workflow passed.
- Done condition met: `https://field-playground.jeffunglesbee.workers.dev/` returns HTTP 200 with no human credential entry.
- **Follow-up (2026-07-27):** `field-playground/wrangler.jsonc` duplicate deleted. Added general-purpose `/delete` route to the Courier (mirrors `/push`'s pattern — target repo is a body param, uses existing `GITHUB_PAT`, no new credential), invoked once via a temporary deploy.yml step, then removed the step. Courier response (verbatim): `{"ok":true,"message":"Deleted wrangler.jsonc from jeffunglesbee-create/field-playground","commit":"c711f18b1b224ac0166e867ecd2a478c9d959bb0"}`.

**CI gate note:** `verify` job continues failing on Rule-90 staleness (rule-90 through rule-96 entries >14 days). Pre-existing, separate session required.

### Carry-forwards
- Rule-90/91/92/93/94/95/96 staleness gate — separate session to exercise entries.

---

## SESSION CLOSE-OUT — 2026-07-25 (start-time-persistence) — FINAL

**HEAD:** c2e667e
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-25-start-time-persistence.md

### Commits this session
- `c2e667e` — feat: add start_time to regular_season_games and postseason_games INSERT + ON CONFLICT

### Result: start_time persistence COMPLETE

- TASK 1: `ALTER TABLE regular_season_games ADD COLUMN start_time TEXT` + `ALTER TABLE postseason_games ADD COLUMN start_time TEXT` — both executed against field-archive D1 (cc49101c).
- TASK 2: Both INSERT statements in `src/index.js` updated with `start_time` in column list, VALUES, bind list, and `ON CONFLICT ... COALESCE`. Deployed at c2e667e (wrangler deploy job success, run 30177665738).
- TASK 3: Verified — `start_time` key present on `/context/date/2026-07-25` game objects; D1 direct insert confirmed value persists correctly. Pre-existing rows `null` as expected.

**CI gate note:** `verify` job has been failing since pre-session (fece9027) due to stale rule-90–97 registry entries (>14 days). Pre-existing, unrelated to this change. Wrangler deploy itself succeeded.

**Format:** `gm.startTime` sourced from ESPN CDN `comp.date` — UTC ISO 8601 `YYYY-MM-DDTHH:MM:SSZ`, consistent across all ESPN sports.

### Carry-forwards
- None from this session. Pre-existing rule-90/91/92/93/94/95/96 staleness gate needs a separate session.

---

## SESSION CLOSE-OUT — 2026-07-22 (add-field-playground-repo) — FINAL

**HEAD:** 0348dfd (after GHA verify result commit)
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-22-add-field-playground-repo.md

### Commits this session
- `a4654ee` — docs: CC-CMD — extend FIELD Handoff MCP repo enum to include field-playground [skip ci]
- `4f64d33` — feat: field-playground as a third valid repo for FIELD Handoff MCP tools (REPO_NAMES, routing fix, schema enums)
- `8c9c15f` — ci: field-playground MCP live verification workflow + session doc [skip ci]
- `0348dfd` — chore: field-playground MCP verification result [skip ci] (GHA auto-commit)

### Result: field-playground MCP routing COMPLETE — 100/100

`REPO_NAMES` extended to include `field-playground` (line 153). Binary ternary routing bug in `trigger_workflow` fixed (line 16198 — was silently routing any non-jubilant-bassoon value to field-relay-nba; now routes through REPO_NAMES with jubilant-bassoon default). All 10 tool schema enums updated from 2-value to 3-value. Archive handler confirmed covered automatically via REPO_NAMES.

**Live verification (GHA run 29962867352, 2026-07-22T22:26:46Z):**
- `read_file README.md repo=field-playground` → HTTP 200, `{"repo":"field-playground","path":"README.md","sha":"a731811c6e244bbeb3d4e04b168fe1b6e7794fa7","size":18,"content":"# field-playground"}` — PASS
- `commit_file docs/mcp-access-confirmed.md repo=field-playground` → HTTP 200, `{"repo":"field-playground","path":"docs/mcp-access-confirmed.md","created":true,"commit":"e2f3f3e6b1bc9244823537079f1d9af78515253e"}` — PASS

Both responses reference `field-playground`. No silent fallback. `docs/mcp-access-confirmed.md` exists in field-playground at commit `e2f3f3e`.

### Carry-forwards
- None.

---

## SESSION CLOSE-OUT — 2026-07-21 (record-streak-board) — FINAL

**HEAD:** 8c5e1bf (after CI auto-commit live-verify outbox)
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-record-streak-board.md

### Commits this session
- `11e6489` — feat: Phase 13 Record Streak Board — real win/loss streaks, separate from Phase 7's quality-based streak_board (fixes streak-board-metric-mismatch)
- `ddf9a41` — ci: add Phase 13 record-streak-board probe to verify job [skip ci]
- `8c5e1bf` — chore: post-deploy live verification [skip ci] (CI auto-commit)

### Result: Phase 13 SHIPPED — real win/loss streaks live

`runPhase13RecordStreakBoard` added to `src/analytics-engine.js`, wired into `processDate` + `PURE_PHASE_DISPATCH`. New `/analytics/record-streak/recompute` endpoint in `src/index.js`. `record_streak_board` field added to newspaper bundle.

**Live verification (deploy run 29864646895):** POST → HTTP 200, `ok: true`. Real teams: Red Sox (MLB) streak=10, Lynx (WNBA) streak=6. Phase 7 untouched: Brewers streak=19 (quality streaks, distinct). Newspaper null = SOFT-SKIP (cache timing; populates on next nightly cron). Confidence: 100/100.

### Carry-forwards
- Client (jubilant-bassoon) CC-CMD required: rewire STREAK BOARD card from `streak_board` (Phase 7 quality) to `record_streak_board` (Phase 13 win/loss). Codex incident `streak-board-metric-mismatch`: relay side RESOLVED, client side OPEN.

---

## SESSION CLOSE-OUT — 2026-07-21 (chat-closeout) — FINAL

**HEAD:** 561ab98
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-chat-closeout.md

### What happened
Chat session close-out. Pushed the pending outbox + HANDOFF commit (`561ab98`) that
carried over from the prior context window. No src/ changes. Research only.

**Verify job:** VERIFIED and stable. Run 29843677043 (`workflow_dispatch`, HEAD
`8379f69`): `success`. All 9 probe steps green. System is clean.

### Carry-forwards
- Cancel GitHub Support ticket for workflow ID 317109373 if opened — YAML syntax
  error was the root cause, not a GitHub-side freeze. Ticket is unnecessary.

---

## SESSION CLOSE-OUT — 2026-07-21 (verify-job-deploy)

**HEAD:** bbbe4af
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-verify-job-deploy.md

### Commits this session
- `7174db2` — ci: migrate verify job into deploy.yml; delete broken post-deploy-verify.yml
- `bbbe4af` — ci: fix YAML syntax error in verify job -- convert heredoc steps to base64

### Result: verify job wired into deploy.yml; YAML fix confirmed; run in progress

All verification steps from `post-deploy-verify.yml` are now a second job (`verify`, `needs: deploy`) inside `deploy.yml`. The broken standalone workflow is deleted.

**Root cause retrospective:** Prior sessions diagnosed the `post-deploy-verify.yml` failure as a "GitHub YAML indexing freeze." The actual cause was almost certainly a YAML syntax error — `python3 - <<'PYEOF'` heredoc content at column 1 breaks YAML literal block scalar parsing, producing identical symptoms (0 jobs queued, `name` field showing file path). The GitHub Support escalation (workflow ID 317109373) is likely unnecessary.

**YAML lint added to workflow edit protocol:** `python3 -c "import yaml; yaml.safe_load(...)"` before every push.

**Verify job status:** VERIFIED. Run 29843677043 (`workflow_dispatch`, 15:22:38Z, HEAD `8379f69`): `success`. Both deploy + verify jobs passed. All 9 probe steps green. Confidence-gate flagged two prior sub-95 docs on first run; both reviewed and acknowledged in `docs/confidence-gate-acknowledged.txt` (`8379f69`); second run clean.

### Carry-forwards
- Cancel GitHub Support ticket for workflow ID 317109373 if it was opened — root cause was YAML syntax error in the workflow file, not a GitHub-side registry freeze.

---

## Prior state (truncated for brevity — see git log for full history)

Prior sessions: 2026-07-21 (push-trigger-fix), 2026-07-21 (recreate-workflow-new-filename), 2026-07-21 (test-real-commit-reindex), 2026-07-21 (investigate-post-deploy-verify-failures), 2026-07-21 (complete-combined-judge-test), 2026-07-21 (fix-test-route-allowlist), 2026-07-21 (combined-prefilter-test), 2026-07-20 (workers-ai-judge-test), 2026-07-20 (amnesty-leaderboard-relay), 2026-07-20 (MLS novel metrics), 2026-07-20 (mls-journalism-xg-fix audit).
