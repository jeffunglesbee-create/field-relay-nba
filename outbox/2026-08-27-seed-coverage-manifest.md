# Every fetchable competition is now declared, and one gap-detector was blind

**2026-08-27** · field-relay-nba · closes
`CC-CMD-2026-08-21-archive-seed-coverage` asks 1 and 2 (ask 3 was withdrawn at
filing time — its premise was false two ways).

## The gap this closes

`V2_LEAGUES` says what the relay can FETCH: 25 competitions. The journalism
cron's `LEAGUES` table says what it ARCHIVE-WRITES: 21. `/context/date` reads
ONLY the archive. A competition in the first and not the second answers
`/v2/games?sport=…` on demand and never persists — and nothing anywhere said
whether that was deliberate.

That state has been found by a human pointing at ESPN twice. The six UEFA club
competitions sat in `V2_LEAGUES` with slugs and BSD ids while
`/context/date/2026-08-19` listed 49 games with no Champions League among them.
The config looked correct.

## Seven competitions were in it. All seven are now declared.

| key | ESPN slug | state | why |
|---|---|---|---|
| `atp` | `atp` | **excluded** | individual sport — the team walker cannot derive two sides |
| `wta` | `wta` | **excluded** | same |
| `cfb` | `college-football` | **undecided** | team sport, ESPN scoreboard already fetched, FBS-scoped. Seed like NFL, or state why not? |
| `afl` | `afl` | **undecided** | team sport with two sides and a scoreboard |
| `eflchamp` | `eng.2` | **undecided** | the EFL **cups** are seeded; the league tiers are not |
| `eflone` | `eng.3` | **undecided** | see above |
| `efltwo` | `eng.4` | **undecided** | see above |

**The exclusions carry in-repo evidence, not opinion.** ATP/WTA reuse the golf
row's `individual: true` device (`218ede4`,
`CC-CMD-2026-08-25-golf-sport-label`): the walker derives sides with
`teams.find(t => t.homeAway === 'home') || teams[0]`, a neutral-site fallback
that cannot tell a neutral site from a draw sheet. On an individual event it
returns the first two COMPETITORS, whose `.team` is undefined because the
competitor carries `.athlete`. That is how ESPN event 401811963 got an archive
row reading `sport='PGA Tour'`, both names null, `home_score = away_score = -6`.
That `-6/-6` was never a tie.

**UNDECIDED is a declaration, not a fallback.** The ask names the bug as a
competition "absent from both lists" — not one whose owner has not chosen yet.
"We have not decided about the EFL Championship, and here is the question" is a
different object from silence: the first appears in a check's output every run.
The five undecided entries are five real coverage questions for a human, and
they are visible now instead of invisible forever.

**`pga` is seeded AND individual.** It is archived through the golf-aware
`[GOLF-BRIEF]` path, not the team walker, so `individual: true` is not itself an
exclusion. Named explicitly in the manifest so the next reader does not conclude
from the ATP entry that every individual sport is excluded.

## Ask 2's artifact had to be rewritten, and the ask said so

The original read: *"on 2026-08-22 the check flags EPL (fixtures on ESPN
`eng.1`, zero rows in `/context/date`)."* That is a false positive, and it would
have fired every day forever.

EPL was seeded — it had been in the table since before the ask was written. What
the author read as a gap on a FUTURE date is game-day seeding: **MLB,
indisputably seeded and playing, was present on 3/3 past days and 0/2 future
days, exactly like EPL.** Only MLS pre-seeds ahead.

So the live half refuses a future or same-day date outright and defaults to three
days back. Encoding the false positive as the artifact would have built a check
whose first act was to be wrong.

## What was found on the way: the gap-detector has the gap

`GET /integrity/games` exists to find seeded games that never reached D1. It
carries `LEAGUES_LOCAL`, commented *"Mirror handleJournalismCycle's LEAGUES list
(kept inline so a future LEAGUES extraction in the cron doesn't ripple here)."*

It is not a mirror:

```
/integrity/games covers 7 of 21 seeded competition(s).
Blind to 14: La Liga, Serie A, Bundesliga, Ligue 1, EFL Cup, EFL Trophy,
UEFA Champions League, UEFA Europa League, UEFA Europa Conference League,
UEFA Champions League Qualifying, UEFA Europa League Qualifying,
UEFA Europa Conference League Qualifying, NFL, PGA Tour
```

The comment's stated reason for duplicating — insulation from a future
refactor — is exactly what went wrong. Every UEFA competition added by the CC-CMD
this ask generalises is invisible to the endpoint whose job is finding that class
of gap. So is NFL, mid-season.

**Reported, not failed, and filed as its own ask.** The seed-coverage check
prints the drift and passes, because nothing could act on it while it was
unfiled. `CC-CMD-2026-08-27-integrity-leagues-drift` now carries it, with a done
condition that ends the leniency: the check gains an assertion that FAILS on the
drift. Rule 87 #4 — deferred work gets a second CC-CMD, not a carry-forward.

## The checks

`scripts/check-seed-coverage.mjs`, two halves with two triggers because they
answer different questions.

**Offline (blocking, `deploy.yml`, on `src/**` pushes).** Eight assertions. Every
fetchable competition is declared; no manifest entry names a competition the
relay can no longer fetch; every exclusion states a reason and every undecided
states its question; `LEAGUES_LOCAL` contains nothing the cron does not seed.
Three non-vacuity assertions run FIRST, with floors below the real counts, so a
regex that stopped matching fails instead of agreeing with everything.

**Live (`seed-coverage.yml`, daily 15:30 UTC, ~1 min).** Every seeded competition
with ESPN fixtures on a past date must have rows in `/context/date`. It asserts
the date carried fixtures somewhere before concluding anything — a day on which
ESPN answered nothing everywhere would show zero gaps and prove nothing. A
competition ESPN could not be reached about is counted neither way and named.

**Nine self-tests, run in both places.** The load-bearing one feeds a fixture
carrying a `ghost` competition in no list and asserts it classifies as
`undeclared` — a detector that cannot fail is not a detector. Another feeds the
golf row specifically, because it carries a fourth field (`individual:true`) and
a regex anchored on the closing brace silently drops it. That regex bug was live
in my first draft: it reported 20 seeded competitions when there are 21.

### Parsing source, and why that is the lesser evil

Both tables are literals inside `src/index.js`, which imports
`@cloudflare/puppeteer` and cannot be imported by a gate script (the same
constraint that put `spreadFrom` in `src/odds-shape.js`). Copying the tables into
the check would create the third copy of a list whose second copy is already
stale. A parser that stops matching fails on the row-count floor; a stale copy is
silent.

## Cost

Offline half: zero, inside an existing gate. Live half: one run a day. The ESPN
scoreboard is public and unmetered; `/context/date` is a cached archive read. 21
scoreboard GETs and one relay GET per run.
