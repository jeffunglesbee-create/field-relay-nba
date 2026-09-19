# CC session 2026-09-18/19 — odds counters, the fill, and what the day actually cost

**Session doc (Rule 67).** HEAD at close: `634ff04`.
Credits spent this session: **240** — two 20-credit probes and one 200-credit
fill. Ceiling 3800/day, untouched.

## What shipped

| commit | what |
|---|---|
| `69c8615` | undeployed-src watch — committed src no successful deploy has built |
| `052d762` `93800ce` `d0e7cc2` | odds-site-drift probe: the site-vs-daily gap measured INSIDE a day |
| `da3f058` `f7db129` | odds-daily-vs-vendor: the enforcing counter against the bill |
| `0fe3415` `ff65104` `6249bf9` `0f37446` | targeted fill: cost model, a silent drop, the bookmaker rule, `--date` |
| `b068f00` `ec6088e` `6f3c26b` | two CC-CMDs and the rewrite of one when its premise died |

## The measured findings

**1. The fill's price is per CALL, not per game.** `odds-backfill.js:43` — one
historical `/odds` call is 10 credits per region per market, run at
`regions=us&markets=h2h,totals`, so every call is a flat 20 and covers a whole
sport-date slate. "10 credits/game" was a day's credits over a day's paired
games: an outcome of slate size and match rate. Costing 516 games at it would
have given 5,160 against a true 2,640.

**2. The matcher works in production.** 2026-09-12 cfb, the same pair, same
price, before and after the `matchSlate` fix: 0/80 matched → 73 by name + 7 by
elimination → 66/80 priced, 66 rows. Verified by the plan shrinking by exactly
66 games, read from D1 rather than from the run's own claim.

**3. Two counters that nothing makes agree.** `odds-site-drift` returned
`gap-grows-while-spending` twice (usedD +74 → gapD +43; usedD +1232 → gapD
+242), zero `clamp-witnessed`. But the lost-update account that predicted it is
ALSO dead: 2026-09-19 01:50Z read `used 166` against `by_site_sum 150`, a
negative gap, which losing writes on the hot key cannot produce. Five candidates
are now dead — three by reading, two by measurement. Conclusion: two non-atomic
counters written from concurrent isolates by different paths at different
frequencies, with a swallowed catch on one and not the other, disagree in both
directions. There is no sixth candidate to find.

**4. Nothing had checked the enforcing counter against the bill.** All three
existing watches compare two of OUR counters. `by_site` has no code consumer in
either repo and cannot overspend. The open claim — if `odds:daily:*`
under-counts, real spend exceeded 3800 on every day that closed at the cap, and
four consecutive days have now closed at 3799-3800 — is unproven and is the only
one with money attached.

**5. The 14 missing games are the vendor's, not ours.** The fill read
`bookmakers[0]` and gave up; `odds-backfill.js`'s `pickConsensus` already took
"the first bookmaker that CARRIES h2h". Applying the correct rule recovered
**1 of 14**. So the 82.5% pricing rate is real vendor coverage, not a code
defect, and 200 credits buys ~157 games rather than 190.

## Defects in my own work, counted

Every defect this session was in the measuring apparatus. Zero were in the relay.

| defect | how it was caught |
|---|---|
| "10 credits/game" published as a price | reading `odds-backfill.js:43` |
| drift probe read the route's top level, recorded undefined, **exited 0** | running it |
| 14 matched games left through an uncounted `continue` | reading the probe's own output |
| daily-vs-vendor rejected the vendor's string — the fact was in the pairing watch's self-test, read the same hour | first live run |
| vendor window vs calendar day mismatch (runners drift 104-405 min) | writing the comparison |
| `--sport=cfb --max-pairs=1` silently retargeted once the pair filled | dry run before spending |
| ceiling framing, published then withdrawn | the guard returns false before BOTH writes |
| lost-update account, published then withdrawn | its own probe's next sample |

Two were published to the owner before being refuted. That is the expensive
half of Rule 100 and it happened twice in one day.

## Rule 42 pass, applied twice

**First:** 21 of 37 scheduled workflows in this repo are read-only watches
against 16 that do work; I added two more in a day while the product produced no
defects. The change: cost-first triage, and for a value with no code consumer,
remove the divergence rather than watch it.

**Second:** the atomic-counter spec survives, but NOT for its stated reason.
Its value is one transaction — daily and per-site unable to diverge for any
reason, including ones nobody has thought of. A fix that does not depend on the
diagnosis is the right answer to a defect whose diagnosis keeps moving.

## Open, with unblock criteria

1. **DONE — the 200-credit fill ran** (03:26Z, run `35418498902`): 200 credits,
   **143 rows**, verified from D1 by the plan dropping 130 → 126 pairs. Six
   pairs priced 99-100%; four bought one game between them. 120 credits bought
   142 games, 80 bought 1. Session total: **240 credits**.
   **What it taught, and it is not what was predicted:** ~157 came from the
   82.5% pricing rate, and six pairs beat that rate. The miss is vendor
   COVERAGE, which the yield curve does not model — it counts games the ARCHIVE
   holds and assumes the vendor has the slate. Two August NFL dates returned 272
   events with 0 in window. The curve is an upper bound, never an estimate.
   **Now open in its place:** nothing records a pair that proved empty, so the
   next 200 re-buys those three dead pairs — 60 credits known dead in advance.
   Unblocks with an exclusion the plan consults. NOT built, not asked for.
2. **daily-vs-vendor verdict.** Baseline stored (09-18: ours 3799, vendor
   76945). Needs three closed days. Expect one `window-drift` refusal because
   the baseline landed off-schedule at 02:22Z.
3. **Atomic counter** (`CC-CMD-2026-09-18`). Two owner decisions first: degrade
   open or closed when D1 is unreachable, and the per-call latency budget.
   Priority depends on (2): breach → urgent, tracks-the-bill → housekeeping.
4. **undeployed-src is red daily for a timestamp.** The provenance census writes
   `ROUTE_PROVENANCE_GENERATED_AT` into `src/` AND carries the skip directive.
   Fix is in whatever generates that commit, not in the watch.
5. **Retire `odds-site-drift`** once the atomic counter's done condition holds
   three days. It answered its question; it must not become the 22nd standing
   watch.
