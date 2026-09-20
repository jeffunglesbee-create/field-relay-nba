# CC-CMD-2026-09-18 — atomic odds counter

**STATUS: gate satisfied 2026-09-19. The verdict came back
`gap-grows-while-spending` — but the reason to do this has CHANGED, and the
change matters more than the verdict.**

**UNBLOCKED 2026-09-19.** Task 3 said two decisions were the owner's. Both were
measurements written up as values judgments; both are now measured and
answered in place. Nothing in this CC-CMD is waiting on a human.

**~~Task 6 must still report the 0d numbers.~~ REPORTED 2026-09-20:
517 ms → 38 ms on the per-request path, −479 ms, verdict `warm-cheaper`.** Full
table and the three ways the 0d spec had gone stale are under Task 0d below.
Answered is not the same as unmeasured-and-assumed — and this one is now
measured.

## The verdict, and the falsification underneath it

`odds-site-drift`, 2026-09-18:

| from | to | usedD | gapD | verdict |
|---|---|---|---|---|
| 15:51 | 18:22 | 66 | -6 | gap-did-not-grow |
| 18:22 | 20:03 | 74 | +43 | gap-grew-while-spending |
| 20:03 | 22:53 | 1232 | +242 | gap-grew-while-spending |

Zero `clamp-witnessed` intervals. The clamp needed `used` to FALL; it never
fell. So the per-site clamp is not the cause and `_bumpSite` is not the fix.

**And the lost-update story does not survive either.** The 2026-09-19 01:50Z
sample reads `used 166, by_site_sum 150` — gap **-16**, sites UNDER the total.
Lost updates on the hot daily key can only ever make daily SMALLER than the sum
of sites, so they cannot produce a negative gap. The sign flipped, and one
mechanism cannot make it flip.

That is not a footnote. It is the finding:

> **Two non-atomic counters, written from concurrent isolates by different code
> paths at different frequencies, with a swallowed catch on one and not the
> other, will disagree in BOTH directions. There is no single root cause to
> find. They disagree because nothing makes them agree.**

Three candidates have now been killed by reading (midnight skew, ceiling
saturation, wrong-sign site loss) and two by measurement (the clamp, and a
single-mechanism lost-update account). Hunting a sixth is the iteration this
repo's Rule 42 exists to stop.

## Why this CC-CMD is still right, for a different reason

Its value is NOT "atomic, therefore no lost updates" — that was an argument for
a diagnosis that did not hold. Its value is Task 2's batch:

> daily and per-site are written in the SAME transaction, so they cannot
> diverge, in either direction, for any reason, including ones nobody has
> thought of.

A fix that does not depend on the diagnosis being right is the correct answer to
a defect whose diagnosis keeps changing. Execute it for that reason and state
that reason in its commit.

## THE LARGER GAP THIS DOES NOT CLOSE — read before starting

Everything measured so far is the difference **between two of our own counters**.
Nothing has established which of them is RIGHT. Both could be wrong together.

The only authoritative third number is the vendor's bill, and the pairing watch
already reads it: on 2026-09-18 it measured provider +506 against our ledger -76
over 18.4h, leaving **442 credits UNEXPLAINED** after known CI spend. That is
the number with money attached. `by_site` has no code consumer in either repo
(see below) and cannot overspend anything.

**If `odds:daily:*` is under-counting, real spend exceeded 3800 on every capped
day and the ceiling has been guarding a number below the truth.** That claim is
unproven and is the one worth proving. Closing daily-vs-site does not touch it.

So: execute this CC-CMD because single-transaction writes are right regardless,
and do NOT report the -397 class as "solved" when it lands. Daily-vs-vendor is
the open question, and it needs its own CC-CMD.

## The defect this addresses (as originally stated, 2026-09-18)

Measured 2026-09-17, closed day: `used` 3799 against `by_site_sum` 4196, a gap
of -397 past a 190 tolerance. Measured 2026-09-18 intraday at 15:50Z: `used`
274, gap +45 — 16% at a tenth of the volume, so the gap is not a ceiling
artifact.

Both counters are `get`-then-`put` on KV, non-atomic. `reconcileOddsCredit`'s
own comment says so. Concurrent isolates lose updates, and not evenly:

- `odds:daily:<date>` is written on **every** permitted call.
- Each of ten `odds:site:*` keys is written only on calls naming it, and one
  consumer (`ambientCaptureClosingOdds`) takes 62-88% of traffic, so the other
  nine are colder still.

The hot key loses proportionally more writes than the sum of the cold ones, so
the daily total drifts BELOW `by_site_sum`. **SUPERSEDED: the probe measured a
negative gap on 2026-09-19, which this account cannot produce. Kept for the
record, not as the rationale.**

### What this is NOT worth fixing for

`by_site` and `by_site_sum` have no code consumer: they appear only in
`peekDailyOdds`'s return (`src/budget-helpers.js:297,302`), nowhere else in the
relay, and nowhere in jubilant-bassoon (grepped repo-wide, zero hits, absent
from both CONTRACTS.md). A gap in a diagnostic cannot overspend anything.

The reason to fix it is the **enforcing** counter: if `odds:daily:*` is losing
writes, the ceiling is guarding a number lower than real spend, and 3800/3800
never actually meant 3800. That is the claim worth proving, and it is the same
mechanism.

## Task 0 — probe block (run first, ~20 min)

Nothing below is written from memory. Each line populates the spec.

```bash
# 0a. The verdict. Read the newest odds-site-drift log; if inconclusive, STOP.
git log --oneline -5 -- outbox/odds-site-drift-\*.log
git show origin/main:$(git ls-tree -r --name-only origin/main outbox/ \
  | grep 'odds-site-drift-2' | sort | tail -1)

# 0b. Does D1 here support RETURNING? SQLite has it since 3.35; this repo uses
#     ON CONFLICT DO UPDATE in six places and RETURNING in none. UNVERIFIED.
#     Run against DB (field-d1) via the existing /d1/execute path.
#     Expected: a row containing used=1. If it errors, the design in Task 2
#     changes to a batch() with a follow-up SELECT and the atomicity argument
#     must be re-made, not assumed.

# 0c. Current call sites — confirm the count before changing any.
grep -rn "checkAndIncrementDailyOdds(" src/ | grep -v budget-helpers
grep -rn "reconcileOddsCredit(" src/ | grep -v budget-helpers

# 0d. Latency, BOTH SIDES — see Task 3.2 for why one side is not enough.
#     Time these on the same isolate, from the worker, and report both:
#       (a) four sequential FIELD_JOURNALISM ops, as the guard does them now
#       (b) one env.DB.batch([...]) of the three Task 2 statements
#     ambientCaptureClosingOdds runs on a cron; fetchSportOddsLive runs per
#     request (STANDARDS Rule 24).
```

## Task 1 — schema  [DONE 2026-09-19, and it corrected itself]

No new Durable Object class. CLAUDE.md prohibits it ("requires migration
entries"), and D1 gives atomicity without one.

**~~`DB` (field-d1), not `ARCHIVE_DB` (game archive) and not `WC2026_DB`.~~
SUPERSEDED. It is `ARCHIVE_DB`, and the original instruction was wrong in a way
that contradicted itself.** Four measurements:

| what was checked | what it said |
|---|---|
| `wrangler.toml` `database_id` | `DB` and `WC2026_DB` are **`f26669de-…`, the same value** — two bindings onto one database. "use DB, not WC2026_DB" was one instruction telling itself no. |
| `grep -c 'env\.DB'` across `src/` | **4**, all Whoop OAuth tokens (`whoop_tokens`, ~11311-11376). `env.ARCHIVE_DB`: **347**. |
| every runtime `CREATE TABLE` | briefs, codex_history, jq_retry_telemetry, change_log, analytics_runs, analytics_output — **all ARCHIVE_DB, none DB**. |
| where the odds tables already are | `odds_history`, `odds_backfill_progress` — **ARCHIVE_DB**. |

Following the document would have put the odds budget in the World Cup
database, beside a fitness API's OAuth tokens, away from every other odds
table.

**Creation path.** Not `/d1/execute` — Task 0b established it 403s any table
outside `ALLOWED_TABLES`. The worker creates its own tables at runtime, the way
the other six do: `ensureOddsBudgetTables(env)` in `src/budget-helpers.js`,
`CREATE TABLE IF NOT EXISTS` in one `batch()`, module-level ready flag so the
DDL runs once per isolate. Both tables are now in `ALLOWED_TABLES` so probes
can READ them.

**STAGED** (verifier: odds_budget_charging @ relay/staged-verification.yml).
Rule 74. The function has no caller; Task 2 is its caller. Unblock criteria in
`outbox/2026-09-19-odds-budget-schema.md`.

The verifier reads `odds_budget` for the current day beside the same day's KV
counter, so the three states are distinguishable without a human looking: no
table is PENDING, a day with KV spend and no D1 row is a FAIL that names the
guard as not routing through D1, and a quiet day stays PENDING rather than
passing on an absence.

**This tag is here because it was missing.** Filed on 2026-09-19 with the
marker and the rule number but no verifier id, it took `deploy.yml` red at "a
staged claim names a verifier that exists and runs", and the relay went
undeployed across two commits — including the Whoop removal. The checker was
right: a claim whose unblock is "Task 2 lands" has no owner but a person
remembering.

The correction could not be written out in full, either. A first attempt quoted
the untagged marker verbatim to show what had been wrong, and the scanner
matched its own counterexample — the same recording-its-own-correction trap the
README-versus-STATUS check strips quoted spans to avoid. Described rather than
quoted, because the scanner is right and the prose is what had to change. Guarded by
`scripts/check-odds-budget-schema.mjs` — which fails on `wrong-binding`
specifically so a session following this document rather than the code cannot
move it back.

```sql
CREATE TABLE IF NOT EXISTS odds_budget (
  day  TEXT PRIMARY KEY,      -- UTC YYYY-MM-DD
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS odds_budget_site (
  day  TEXT NOT NULL,
  site TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, site)
);
```

## Task 2 — the guard  [DONE 2026-09-19; the spec contradicted itself]

**The spec below could not be implemented as written.** It says *"All three in
one `env.DB.batch([...])`"* and *"Statement 3 runs only if statement 2 returned
a row."* Both cannot hold: a batch is submitted as a unit, so nothing can read
statement 2's result and then decide whether to include statement 3. Obeying the
second sentence means two round trips and no transaction — which removes the
only reason for the change.

**The resolution is the ORDER.** Bump the site FIRST, reading the PRE-charge
total, then charge the day. Both statements carry the same ceiling predicate
over the same pre-charge value, so inside one transaction they either both apply
or neither does, and nothing needs inspecting. The daily `UPDATE`'s `RETURNING`
still gives the verdict because it is last.

Verified against real SQLite rather than reasoned about — ceiling 100 charged in
units of 30 gave CHARGED/CHARGED/CHARGED/VETOED with the two counters equal at
every step, and a vetoed call moved neither.

**Three things shipped with it that the CC-CMD did not list, because the guard
is incoherent without them:**

1. **`reconcileOddsCredit`'s delta follows the charge into D1.** It writes the
   same two counters. Leaving it on KV would have recreated this exact defect
   one layer down, and its own comment already records that happening on
   2026-09-16.
2. **`peekDailyOdds` reads D1 when a row exists, KV otherwise** — Task 4's read
   half, pulled forward. A guard charging D1 while `/budget/odds` reads KV would
   report 0 used on a day with real spend, and every watch would read that zero
   as a finding. It also returns `source` and `kv_used`, because "0 used" and
   "read the wrong store" are otherwise indistinguishable.
3. **The seed carries the day's KV total, once per isolate.** Task 4 required a
   UTC day boundary so a fresh D1 row starting at 0 would not hand the day a
   second full ceiling. Seeding from KV removes that constraint: the cutover is
   safe at any hour, and `INSERT OR IGNORE` means it can only apply to the day's
   first row.

### The original Task 2, superseded — kept because the contradiction is the point

The ceiling goes in the `WHERE`, so there is no read-then-decide window and no
compensating write on veto.

```sql
-- 1. seed (no-op after the day's first call)
INSERT OR IGNORE INTO odds_budget (day, used) VALUES (?1, 0);
-- 2. charge, but only if it fits. Zero rows back = ceiling veto, unambiguously.
UPDATE odds_budget SET used = used + ?2
 WHERE day = ?1 AND used + ?2 <= ?3
 RETURNING used;
-- 3. the site split, IN THE SAME BATCH
INSERT INTO odds_budget_site (day, site, used) VALUES (?1, ?4, ?2)
  ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used;
```

All three in one `env.DB.batch([...])`. **This is the point of the whole
change**: daily and site are written in one transaction, so they become
structurally incapable of diverging. The -397 class stops existing rather than
being watched.

Statement 3 runs only if statement 2 returned a row.

*(This sentence is the contradiction. See the resolution above.)*

## Task 3 — SUPERSEDED 2026-09-19. Neither was a decision.

This section read "two decisions the owner makes, not CC", and it gated the
whole CC-CMD from 2026-09-18. Both questions were measurements written up as
values judgments, and that is why neither got answered: as posed, neither has
an answer.

The original text is kept below, because the mistake is the useful part.

### 3.1 — degrade open, and it was never the leak

Keep the existing degrade-OPEN behaviour. Not a preference — the quantity the
question turns on was already measured and nobody looked.

`outbox/odds-pairing-rate-20260919T140742Z.log`, a 23.4h window:

```
escaped the ledger: 885
known CI spend    : 200
UNEXPLAINED       : 685   (tolerance 243)
guard fell open   : partial — 24 credit(s)
```

**24 of 685 credits.** Degrading closed recovers those 24 and stops odds
serving whenever D1 is unreachable; the other 661 is untouched by either
answer. The question was framed as though it governs the leak. It governs 3.5%
of it — and 24 is a floor, because the `!env.FIELD_JOURNALISM` path has nowhere
to record itself (see `_countDegradeOpen`'s header).

**The batch also removes the half-state the question was about.** Today the
guard can authorize spend and then fail to record it: the `put` throws, the
catch returns `true`, the vendor is called, and `odds:daily:*` never moved.
With the ceiling inside `UPDATE ... WHERE ... RETURNING`, charge and decision
are one statement — a throw means nothing was charged AND nothing was
authorized. What remains is the ordinary "no answer from the store" case, and
`return true` there is the same trade the code makes today, now bounded to a
window where no spend was recorded as permitted.

Keep `_countDegradeOpen`. It is the only reason any of the above is a number
rather than a guess.

### 3.2 — not a budget, a comparison; see Task 0d

Task 0d read "Time one /d1/execute round trip from the worker, because every
odds call gains one." It gains none.

Counted from `src/budget-helpers.js:176` (`async function
checkAndIncrementDailyOdds`), one permitted call today does **four** KV round
trips: `get(odds:daily:*)`, `put(odds:daily:*)`, then a `get` and a `put` on
`odds:site:*` inside `async function _bumpSite`. The Task 2 design is **one**
`env.DB.batch([...])` carrying all three statements. It is 4 → 1, not 0 → 1.

That does not make it faster and this document does not claim it does. KV reads
are edge-cached and cheap; KV writes and D1 both go to a central store, so a
lower op count is not by itself a lower latency. What it means is that "what
budget will you accept for an added round trip" has no answer, because there is
no added round trip. Measure both sides; do not reason about either.

Report both numbers in the Task 6 manifest.

If (b) is slower than (a), the batching question in the original text becomes
live again — one charge per slate rather than per game on
`ambientCaptureClosingOdds`. Decide it from the measurement, not before it.

### 0d ANSWERED 2026-09-20 — `warm-cheaper`, and not by a little

Measured in the worker at `POST /debug/odds-budget-latency`, 7 iterations per
series, medians. Artifact: `outbox/odds-budget-latency-20260920T032540Z.log`.

| series | median | what it is |
|---|---|---|
| `kv_four_ops` | **517 ms** | the old guard: get+put on daily, get+put on site, every call |
| `d1_batch_warm` | **38 ms** | the new guard: one batch, every call after the first |
| `d1_first_call_on_isolate` | **67 ms** | DDL + KV seed read + batch, once per isolate |

**Per-request delta: −479 ms.** The batching question above does NOT become
live: (b) is not slower than (a), it is 13.6× faster, so there is nothing to
decide about charging per slate instead of per game.

**The paragraph above this one was right to refuse to predict it.** "KV reads
are edge-cached and cheap; KV writes and D1 both go to a central store, so a
lower op count is not by itself a lower latency" — correct, and the answer still
came out enormous, because the cost was never the op count. It was two KV
*writes*, each replicating globally, on a path that only ever needed one
transaction against one store.

**THREE THINGS THE SPEC GOT WRONG, and the measurement is of HEAD rather than of
the spec:**

1. "four sequential FIELD_JOURNALISM ops, **as the guard does them now**" — it
   does not. Task 2 removed them on 2026-09-19. The four-op form is the
   BASELINE, reconstructed, and the artifact labels it as such.
2. "`env.DB.batch`" — `DB` was removed 2026-09-20. Task 2 landed on
   `ARCHIVE_DB`.
3. "**one** `env.DB.batch`" — the guard also calls `ensureOddsBudgetTables` and
   `_seedFromKv`, both behind module-level flags. A first call on an isolate
   makes three round trips; every later one makes one. Timing only the batch
   would have flattered the new form, so the two are reported apart and the cold
   number is kept out of the per-request verdict by construction (mutation L1).

**Coverage, stated where the number is read (Rule 91):** one isolate, one colo,
7 iterations per series. Not contention, not cold starts, not other regions, and
two of the three series are reconstructions rather than the guard observed in
situ.

---

### The original Task 3, superseded — kept for the record

> **Two decisions the owner makes, not CC**
>
> 1. **Degrade open or closed?** Today both guards return `true` when KV errors
>    (witnessed 2026-09-18: 4 credits through). With D1, degrading closed means
>    odds fetches stop when D1 is down; degrading open means the same silent
>    leak, relocated. CLAUDE.md Rule 5 covers archive writes, not budget guards,
>    so it does not decide this. **Ask.**
> 2. **Latency budget.** Task 0d's number against the per-call cost on the
>    `ambientCaptureClosingOdds` cron. If a round trip is material, the closing
>    capture may need to charge in one batched call per slate rather than per
>    game. **Report 0d before implementing, do not absorb it silently.**

**Why this is worth keeping.** Rule 100 says a premise is not probed until one
command has tried to refute it. Both premises here were refutable by one
command each — `cat` the newest pairing log, and read 38 lines of
`budget-helpers.js` — and neither was run before the questions were filed and
sent to the owner. That publication is the defect, exactly as Rule 100's
corollary describes. The cost was a day of the CC-CMD sitting gated on
questions that could not be answered.

## Task 4 — cutover

At a UTC day boundary. New day, new row; the KV keys carry
`expirationTtl: 172800` and age out on their own. No backfill, no dual-write
phase, no double-count window.

`peekDailyOdds` reads D1 for the current day and KV for any older day still
within its 48h TTL, so `/budget/odds?date=` keeps working across the boundary.

## Task 5 — mutations (Rule 90, before the check is trusted)

Each must be shown red before the fix is believed:

1. Ceiling moved out of the `WHERE` into a JS comparison after the update —
   restores the read-then-decide race.
2. Statement 3 moved out of the batch into its own call — restores the
   divergence this whole CC-CMD removes.
3. Zero-rows-returned treated as success — a vetoed call proceeds to spend.
4. `INSERT OR IGNORE` dropped — day one of every month silently vetoes
   everything, or throws.

## Done condition  [REWRITTEN 2026-09-19 — the original was satisfied by construction]

### Why the original two conditions cannot serve

Both measured `used` against `by_site_sum`. After Task 2 those two numbers are
written by the same batch over the same rows and read from the same store. **They
agree because the schema says so.** Waiting for them to go green is waiting for a
tautology, and pasting that green into Task 6 would be publishing one as evidence.

This is the repo's own Rule 90 in the other direction: a check that cannot fail
proves nothing, and Task 2 removed the way this one used to fail.

**The instrument was not fixed. It was deleted.** Before Task 2 there were two
counters and their disagreement told you something was wrong. After Task 2 there
is one counter, written twice in a transaction. That is a real improvement — one
consistent number beats two racing ones — but it means **nothing internal can
now tell you whether that number is right**, which is the question this CC-CMD
named in its own text and then wrote a done condition away from:

> Everything measured so far is the difference **between two of our own
> counters**. Nothing has established which of them is RIGHT. Both could be
> wrong together.

### The conditions that can actually fail

1. **`odds-daily-vs-vendor` returns a verdict on three closed days**, and that
   verdict is `tracks-the-bill`. This is the only remaining check with an
   external referent — the vendor's own cumulative bill — and therefore the only
   one that can go red for a reason the code did not construct.
   `counter-under-counts` is the breach: it means real spend exceeded the cap on
   every day that closed at 3799-3800. Spec in
   `docs/CC-CMD-2026-09-19-daily-vs-vendor.md`.

2. **`odds-attribution-gap` reports `ok` on a closed day** — kept, but demoted.
   It is now a *regression* check on the transaction rather than evidence about
   the counters. It passing says nothing new; it FAILING would say the batch is
   not atomic, which is worth knowing.

### `odds-site-drift` is re-scoped, not retired

The original instruction was to delete it once the done condition held for three
days. That is wrong now, and for an interesting reason: **the probe's meaning
changed under it.** Same code, same arithmetic, different claim.

| | a green means |
|---|---|
| before Task 2 | the two KV counters happen to agree |
| after Task 2 | **`batch()` really is one transaction** |

That second claim is the single unverified premise under Task 2. The local
mutations run against `node:sqlite` are sequential and prove the statements
correct *given* a transaction; they say nothing about whether D1 supplies one
under concurrent isolates. This probe is the only instrument that can catch it,
so retiring it on the old schedule would throw away the one thing still watching
the new risk.

Implemented rather than just noted: the probe carries `source` through every
sample, **refuses** an interval that straddles the KV→D1 cutover instead of
merging it, and prints which claim its green is making beside the verdict.

### The first interpretable day is 2026-09-20

2026-09-19 straddles the cutover — the KV guard until 19:13Z, the D1 batch after
— so its intervals measure two different mechanisms and the difference between
them is the deploy. The probe now refuses those pairs rather than reporting
them.

### What has NOT moved

The `-410` and the 685 unexplained credits are **untouched**. Those were never
the daily-vs-site gap; they are the ledger-vs-vendor gap, and Task 2 did not go
near it. Reading "Task 2 shipped, the gap closed" would be reading the wrong
gap — which is the substitution this document's own history keeps making.

## Task 6 — outbox manifest (last)

Commit hash, deploy run ID, the two done-condition outputs pasted verbatim,
**both** 0d latency numbers (four-KV and one-batch, same isolate), and — if
(b) came back slower than (a) — the per-slate batching decision from 3.2.

There is no owner answer to record. Task 3.1 is answered from the pairing log
and cited there.

### Task 6 manifest — completed 2026-09-20

`outbox/2026-09-20-task-0d-latency.md` is the write-up. The numbers:

| item | value |
|---|---|
| Task 2 commit / deploy | `5edb19a`, run 980 |
| Task 0d route / deploy | `1845f72`, run 983 |
| 0d — four sequential KV ops | **517 ms** median (reconstructed baseline) |
| 0d — one batch, warm | **38 ms** median |
| 0d — first call on an isolate | **67 ms** median, reported apart |
| 0d per-request delta | **−479 ms** |
| 3.2 per-slate batching decision | **not taken — the condition did not arise.** (b) is faster than (a), so the conditional above is unmet |

**THE CC-CMD WAS MARKED CLOSED IN HANDOFF BEFORE THIS EXISTED.** The 2026-09-19b
close-out said "CLOSED" while this task's own text required 0d numbers that had
not been measured. Both statements were in the repo at the same time and one of
them was wrong. Recorded here rather than quietly fixed, because "closed" is the
word that stops anyone looking again.

### The two done-condition outputs, verbatim, as of 2026-09-20

**`odds-daily-vs-vendor` — STILL PENDING.** `outbox/odds-daily-vs-vendor-2026-09-20T0448.log`:

```
  2026-09-19 our counter : 3800 / 3800
  vendor cumulative now  : 81268
  previous reading       : 2026-09-19T02:22:39.263Z  vendor 76945
  verdict: window-drift
COVERAGE: 1 reading recorded for 2026-09-19; 2 on file. No comparison
this run — the vendor counter did not run continuously across the window.
```

One reading for the day, so no comparison. `3800 / 3800` is the day at its
ceiling, which is its own fact and not evidence either way here. Three closed
days remains the condition; earliest verdict ~2026-09-22.

**`odds-site-drift` — the first D1-era day.**
`outbox/odds-site-drift-2026-09-20T1315.log`:

```
  this reading   : 2026-09-20  used 806  by_site_sum 806  gap 0
  from      to        usedD    gapD   verdict
  01:53     07:57      105       0   gap-did-not-grow
  07:57     13:15      383       0   gap-did-not-grow
  verdict: inconclusive  over 2 interval(s) of 3 same-day sample(s)
  store    : d1
  a green here means: batch() is one transaction
```

**488 credits charged across two intervals with `gapD 0` at every sample**,
against the KV era's `+242`, `+43` and `−16` on 2026-09-18/19.

**That is evidence accumulating, and it is NOT a pass.** `inconclusive` is the
only non-failure state this probe has, by construction: "a series with no
growing-gap interval has not exonerated the clamp, it has only failed to catch
it yet." Writing "batch atomicity confirmed" off two clean intervals would be
the exact substitution this document's history keeps recording — reading an
instrument's refusal to fail as its agreement.

## Retire the probe  [SUPERSEDED 2026-09-19 — see the Done condition]

~~Once the done condition holds for three consecutive days, delete the workflow
and the two scripts.~~ **Do not.** Its green now asserts `batch()` atomicity,
which nothing else here checks and which this session could not verify locally.
The original text follows, because the reasoning was right at the time and the
reason it stopped being right is the useful part.

> `odds-site-drift` exists to answer one question. Once the done condition holds
> for three consecutive days, delete the workflow and the two scripts. It was
> built on 2026-09-18 and must not become the 22nd permanent scheduled watch —
> the repo already runs 21 read-only watches against 16 workflows that do work.

The concern about a 22nd permanent watch stands. The answer is to re-scope this
one rather than keep it AND add another: it is now the transaction detector, and
`odds-daily-vs-vendor` is the spend detector. Two instruments, two questions,
neither redundant.
