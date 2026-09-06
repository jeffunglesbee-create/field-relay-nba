# 2026-09-06 — tennis on BSD, and three Durable Objects that had been dead for a day

## HEAD progression

`f5e418b` → `171476d`. Fourteen substantive commits, listed against what each
one settled.

## The incident, because it outranks the feature

**AmbientDO, GameDO and UserDO were throwing `ReferenceError` at construction
from 2026-09-05 10:08 UTC until 2026-09-06 17:03 UTC.** Roughly thirty-one
hours. That is the cross-sport SSE stream, the live-score WebSocket fan-out and
per-user state, all down.

`dde1dc4` added `withKvProvenance(env, 'do:X')` to four Durable Object
constructors. Its diff stat is the whole story:

    src/ambient-do.js   12 +++++++
    src/bracket-do.js   13 ++++++++     <- one line more
    src/game-do.js      12 +++++++
    src/user-do.js      12 +++++++

The extra line in bracket-do.js is
`import { withKvProvenance } from './kv-provenance.js';`. It went into one file
of four. The identical eleven-line comment and the call went into all four.

### Three things that should have caught it and could not

`node --check` parses one file and cannot see across modules.

Wrangler bundles an undefined identifier without complaint. It is not an error
until the line executes, and the line executes in production.

`check-kv-provenance.mjs` — written in that same commit, for this exact purpose
— tests:

    /this\.env = withKvProvenance\(env, 'do:\w+'\)/.test(t)

It asserts the CALL TEXT is present. It never asks whether the symbol resolves.
It matched a string rather than reaching what it was aimed at, passed on all
four files, and the commit shipped believing itself covered. Two mutations were
proven on that gate — "an object that stops wrapping" and "two objects sharing a
writer label" — and neither could have caught a missing import, because both
mutate the same text the check reads.

### Two layers of disguise, both with precedent in this repo

Cloudflare returns its own 500 page for a thrown exception (error code 1101),
and that page carries no CORS headers. A browser therefore reports "No
Access-Control-Allow-Origin header is present" and the 500 never surfaces.
Relay commit `c135dcc` recorded that exact substitution on 2026-05-31, where a
405 from the method gate wore the same costume. `f949456` recorded another 1101,
from a TypeError thrown outside a try/catch.

Then the client's `AmbientEventSource` retries five times with 1.5x backoff and
falls back to polling BY DESIGN. The page degrades from sub-3s SSE latency to
the 15-30s poll cycle and reports nothing. Nothing broke visibly, so nothing was
looked at.

Neither repo nor three Drive docs contain any mention of it. jubilant-bassoon
`cb111471` (2026-08-09) proves the stream was alive then: a probe using
`networkidle` hung *because* FIELD holds an SSE connection.

### What the object itself said when it came back

    {"clientCount":0,"lastPoll":"2026-09-05T10:08:38.781Z",...}

Thirty-eight seconds after `dde1dc4` was committed at 10:08:00. It polled once
on deploy, died on its next construction, and never polled again. The timeline
came from the DO's own state, not from reading commit dates.

### Fix and gate

`a95d5ab` adds the three missing imports. `scripts/check-imports-resolve.mjs`
asserts that every identifier a module calls, which a sibling module exports, is
imported or locally defined — 36 modules, 144 exported symbols, 0 unresolved.
Wired into `deploy.yml` beside the gate that missed it.

Mutation-proved against the real defect rather than a synthetic one: removing
the import from ambient-do.js alone reports 1 and names it; removing all three
reproduces exactly what production shipped and reports 3. A name appearing only
in a comment is not flagged. An empty directory exits 1 rather than reporting a
clean sweep of nothing.

Verified live after deploy 909:

    /ambient/state   500/1101  ->  200, x-field-source: do:AMBIENT_DO
    /live/ambient    500/1101  ->  200, text/event-stream, ACAO *, event: connected
    clientId 2 at 17:06Z  ->  clientId 70 at 17:26Z, liveGames carrying real MLB scores

Sixty-eight browsers connected in twenty minutes once it was serving again.

## Tennis

**The surface.** `/api/schema/` declares 217 paths; 220 endpoints offered in
total. FIELD fetches **8**. 213 offered and never touched, including whole
sports — basketball, hockey, darts, padel, horseracing, CS:GO.

**The competition census** (`scripts/bsd-leagues-baseline.mjs`) reads 1,531
competitions across 8 surfaces. Tennis is the largest at 636 — 7.5x football's
83 — and was the one FIELD rendered nothing from. Now stores `category` and
`circuit` per competition, discovered rather than assumed, with the migration
handled so a shape change reports zero renames instead of 1,531.

By the vendor's own `category`: 301 utr, 117 challenger, 97 wta_250, 31
atp_250, 25 grand_slam, 17 wta_500, 16 atp_500, 11 other, 11 wta_1000, 10
masters_1000. `circuit` is unreliable — it reads "ATP" on women's matches.

**Two new routes.** `/bsd/tennis/matches/by-date` exists because `/live` is
match-level: the US Open was in the feed at 03:23Z with Round of 32 in play and
gone at 05:55Z without having ended. Its day's play had. A page driven by the
live feed alone shows nothing for a Grand Slam through roughly twelve hours of
every tournament day.

Only `date_from`/`date_to` filters. `date`, `match_date`,
`start_date`/`end_date` and `day` all return HTTP 200 with the SAME unfiltered
page — accepted and silently dropped, no 400 anywhere. `date` is the public
parameter name this relay's own football route uses, so the internally
consistent guess was one of the four that does nothing. A control-first probe is
what caught it.

**The route shipped clipped and was fixed.** First live reading: count 159, one
page of 100, a `next` at offset=100. Fifty-nine matches absent, a 200, and
nothing saying so. BSD documents no ordering, so a client filtering to majors
could not know whether the Grand Slam rows were in the hundred it got — a
missing US Open would look exactly like a US Open with no play. Now pages,
bounded at 5 pages, and carries `declaredCount` and `truncated`.

**Draw feasibility: YES.** 126 edges resolve to exactly one next match by winner
identity, 0 ambiguous. There is no parent-link field and none is needed — in a
single-elimination draw the winner IS the link, and that edge is read rather
than inferred.

## The probe that produced three wrong verdicts

`bsd-tennis-draw-probe.mjs` published three confident conclusions about BSD, all
three defects in the question rather than the data:

| verdict | actual cause |
|---|---|
| "sizes halve: false" | limit=100 and 1+2+4+8+16+32=63; the top round was cut off by the fetch |
| "DERIVABLE ONLY BY POSITION" | a claim about a join it never attempted |
| "ambiguous on 106 matches" | joined across every EDITION; tournament id 15 is the series, `Final=2` said so |

Every underlying measurement was fine each time. The scoping was wrong. The
season fix is mutation-proved against the defect: a synthetic two-year draw
where one player reaches both finals reports 2 ambiguous unscoped, 0 scoped.

## The instrument defects, counted

Nineteen this session, against four product defects. Every one had the same
shape — a check that could not reach what it was aimed at:

- a mutation anchored to a set score the next capture replaced
- a hardcoded `= 11` against a fixture a workflow rewrites
- `\b` before a digit, unmatchable when textContent glues chip to name
- a field name banned in the comment explaining the ban
- a count standing in for a reading (7 empty cards passed)
- `innerText` returning "" for a card a screenshot plainly showed
- a probe reading `/live` while the page reads two feeds
- `curl -sI` sending HEAD to a route that requires GET
- `grep FILE >> FILE`, which made the ACAO verdict print NO on every run ever
- a page size reported as the size of the thing, twice
- a sandbox curl against a host this sandbox 403s
- a monitor matching a commit sha without requiring a conclusion

The two mechanisms that actually caught things: `NoTeeth` as a first-class
verdict in the F# suite, and guards that live in the value rather than in a
comment asking the author to check.

## Open, named rather than closed

**AmbientDO's REST branches ship no CORS headers.** `/ambient/state`,
`/ambient/kick` and the BSD subscribe/unsubscribe routes build responses with
`Content-Type` alone; only `_handleSSE` sets ACAO. The client uses the SSE route,
so this is latent rather than breaking. Not folded into an unrelated commit.

**Three /bsd routes remain unprobed:** `/bsd/events/season`, `/bsd/r2/list`,
`/bsd/tennis/matches/{id}`. Coverage is 11 of 14, stated in the probe's own
output.

**European handicap and opening prices** are not in BSD's odds payload despite
the August newsletter. **RateLimit headers were not observed** on any of 21
responses. Both measured, neither fixed — they are the vendor's.

**Nine new competitions** cannot be confirmed until the census has two readings
to diff. The baseline is set; next month answers it.
