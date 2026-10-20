# CC session — odds_history held American odds, and the sync converted them twice, 2026-10-20

`docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md`, dispatched by
the owner with "go with Claude's best recommendations". Status DONE.

**HEAD:** `a4208b46` → `e18359e1`, `01dde259`, `c4d54e34`, `fce341d9`, `32a51a04`,
plus this docs commit. Branch main throughout.
**Proof:** `outbox/odds-american-units-2026-10-20.log`
**Data:** `outbox/fixture-odds-american-targeted-2026-10-20.json`. It holds all
211 `_targeted` rows as read from D1, checked against 11 aggregates recomputed
there.
**Readers:** `outbox/odds-american-readers-2026-10-20.md` (69 readers, 4 repos)

## TASK 0 — premises, one command each (Rule 100)

| premise | command | result |
|---|---|---|
| the damage is 206 rows | the signature over every `_targeted` row, both columns | **false.** 211 games, 422 blobs, every one the double conversion of its own row, plus 47 draws. The 206 skipped every null side |
| all 210 American rows came from the targeted fill | the unit census over all 954 rows, by writer | **211.** The IPL row was written before the census window. The 2 American-looking `_close` rows are decimal in-play extremes |
| changing `oddsFormat` costs nothing | read `REQUEST_SHAPE` and the dead-pair fingerprint | **true.** The format is not in it, so no dead pair reopens and no credit is re-spent |
| the sync will not overwrite a repair | read `syncOddsToGameTables` | **true.** It writes NULL columns only. No game had a second history row, and today's 14:48Z run touched none of them |
| decimal conversion is exact through the sync | the sync's own decimalToAmerican, read from source, on every real side | **true,** 469 of 469 sides, including −100000 → 1.001 and +100 → 2 |
| something persisted the damaged values | D1 briefs and analytics_output, plus every repo's committed files | **no.** 0 rows built after the damage, and none of the 106 damaged values appears in any tracked file |
| the damage reached a reader that the D1 repair fixes | the 38-agent reader census | **mostly.** The client caches debrief context with no age check (filed, see Residual) |

## What landed

| commit | task | what |
|---|---|---|
| `e18359e1` | 2 | the fixture, and the repair generator with its SQLite self-test on the 211 real rows |
| `01dde259` | 1 | the fill asks for decimal; `check-odds-history-units.mjs` in guards and the deploy gate; U1-U7 |
| `c4d54e34` | 1 | review fixes: comments cannot hide a format, every request is held (not only writers), the pinned mechanism leaves the gate; U8-U10 |
| `fce341d9` | 1 | three deploy gates the work tripped, found by running every step before the push |
| `32a51a04` | 2 | the apply as six set-based statements, proven byte-equal to the 1,266-statement oracle; SB1-SB7 |

## Done conditions (Rule 89)

1. **TASK 0, each output with its denominator:** proof log §1 (954 rows by
   writer; 211 games by sport, both columns) and the readers file (69 readers,
   34 re-checked).
2. **TASK 1, red before, green after, with mutations:**
   - the base fill fails the units check (`asks for oddsFormat=american`); HEAD passes;
   - `mutate-odds-matcher` 86 of 86;
   - "275 must sync to +275" holds on all 469 real sides (proof log §2-§4).
3. **TASK 2, applied and read back.** The CC-CMD's condition was "0 rows
   matching the UNITS signature".
   - The read before the write equaled the fixture, 13 of 13.
   - The SQL was sent as ONE D1 call: 6 of 6 statements, 211 changes each, and
     633 change_log rows (22971-23603).
   - The verify read gave 11 of 11 fields as expected.
   - 0 of 211 games still have a price of +10000 or more, or a null side.
4. **The deploy path:** every `run:` step of deploy.yml and guards.yml, run on a
   clean copy (proof log §8). The Deploy RELAY Worker workflow did not run: no
   `src/**` file changed, so no deploy was due. Repo guards: success on `fce341d9`
   (39445964746) and on `32a51a04` (39446788616).

## What this session got wrong, and the cost

- **The fixture's first census counted 206 and 229.** That was the CC-CMD's
  figure, from a census that skipped null sides. Read again over both columns,
  it is 211 games and 422 blobs. The repair was sized from the second reading.
- **The first units check could be fooled, four ways the review proved:**
  - a comment naming decimal hid an American request;
  - a writer split across files passed;
  - UPDATE and REPLACE writers passed;
  - the gate pinned a past measurement to the live sync.

  All four were fixed before the push, each with a mutation.
- **Three deploy gates went red on my own changes,** found by running every
  step before the push, not by CI:
  - a reduce coerced a missing value to zero;
  - a mutation anchor added two `|| []` sites;
  - a mutation string named the vendor host.
- **The apply was first planned as 1,266 literal statements carried by hand.**
  That would have made the SQL sent a copy of the generator's output, not the
  output itself. It became six set-based statements proven equal to the
  literal plan.
- **The 10:45Z check-in for the two other odds CC-CMDs fired before their
  backfill ran.** That premise had not been checked: the cron says 10:00Z, but
  GitHub starts the job at 13:30-19:40Z. It was re-armed for 17:30Z.

## Residual, filed (Rule 87.4)

**The client's debrief cache.**
- **What happens:** `injectDebriefCards` reads the `field-debriefs` Cache API
  first, with no age check. The only eviction is in sw.js activate, for
  entries older than 7 days.
- **Who is affected:** a browser that opened one of the 211 games between
  2026-09-16 and the repair keeps rendering e.g. "E Michigan null ·
  Sacramento St +27400".
- **How long:** until the entry is 7 days old and a new service worker has
  activated. In practice that is about 7 days after it was cached.
- **Why it isn't fixed here:** no read of D1 can see it, and the fix is in
  the client. Filed as jubilant-bassoon
  `docs/CC-CMD-2026-10-20-debrief-cache-outlives-archive-repair.md`
  (`1fc8f319`, owner decision).

## Limits, printed with the result (Rule 91)

- **The units check is structural.** It reads the request each file builds, in
  287 runtime files (142 check and mutation harnesses are counted out), not a
  live response.
- **The converted rows are exact conversions, not the vendor's own decimals.**
  The vendor rounds to two places; these keep full precision, which is what
  makes the round trip exact.
- **The readers census was taken before the repair,** against the damaged
  state. Its "affected" answers describe that state.

## Integration state (Rule 65)

- **Relay contract:** unchanged. Blobs still hold American integers; the
  repaired ones now hold the right ones.
- **Client and laboratory consumers:** no code change. They read the repaired
  values on their next fetch. The client's cached copies are the residual
  above.
- **Behaviour changes:** the targeted fill asks for decimal. Guards and the
  deploy gate fail on any new non-decimal odds request outside the six reviewed
  readers.
