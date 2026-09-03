# The control gate is open, and the instrument is not what the first run said

**CC-CMD-2026-09-02-d1-write-provenance, Tasks 2 and 3.**

**Deploy:** 889 / `33712050255`, commit `17ec554` — success.
**Control:** run `33713216975` — **ALL ASSERTIONS PASSED**.

## Task 2 — 10 sites, and Task 1 is why it is not 87

`src/d1-provenance.js` plus ten one-line call sites: every **runtime** write to
`regular_season_games` and `postseason_games`. Of the 87 writes Task 1 found, 20
are schema statements and 57 target tables the question does not concern.

The CC-CMD's original argument for instrumenting all 87 was that watching only
the suspected door makes a null result unable to separate "nothing wrote" from
"it came through a door nobody was watching". That separation is real, and Task 1
makes it **by reading, permanently, at zero runtime cost** — including the one
door a grep could never see, `src/index.js:17571`,
`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
excluded by an allowlist holding one table.

`scripts/d1-provenance-check.mjs` is a new deploy guard: 20/20 plus 16/16
self-tests, proven by mutation — remove one call site and it is 8/10; make one
site name stale and it is 17/20.

**That last check exists because the first draft of the site list said
`/archive/drama-peak`**, written from the field name rather than probed. The
route is `/archive/drama-by-id`. A site name that names nothing looks identical in
the data to one that names a real door.

## Task 3 — the census

```
=== A. id-scheme census — every id in both archive tables ===
  regular_season_games: 2475 row(s)
  postseason_games: 275 row(s)

  2750 id(s) classified:
     2140  underscore  e.g. AFL_2026-03-05_sydney_carlton, AFL_2026-03-07_brisbanelions_westernbulldogs
      591  dash        e.g. 2026-03-07-mls-ne-hou, 2026-04-11-mls-sea-rsl, 2026-05-09-epl-bright-wolver
       19  other       e.g. nba-ecf-2026-g1, nba-ecf-2026-g3, nba-ecf-2026-g4, nba-wcf-2026-g3
```

All 19 `other` ids printed in full rather than sampled, because that bucket is
where a misfiled external id would land:

```
nba-ecf-2026-g1 · g3 · g4 · nba-wcf-2026-g3 · g4 · g5 · g6 · g7
nhl-east-semis-2026-g6 · g7 · nhl-ecf-2026-g2 · g3 · g4 · g5
nhl-wcf-2026-g2 · g3 · g4 · ufl-playoffs-2026-wk10 · wk9
```

None is dash-scheme: each is a **round label**, not a date, so `idScheme`'s
requirement of a leading ISO date correctly excludes them. The predicate was
written from two observed examples and this is what tests it — 2750 strings, 19
of which a looser predicate would have swallowed into `dash`.

**591 dash-scheme rows exist right now**, far past the 51 MLS pairs the sibling
CC-CMD counted, and spanning EPL as well as MLS. That is a count, not a verdict:
these rows predate the instrumentation and carry no provenance entry. Only writes
after `17ec554` are attributable.

## Task 3 — the control, and the three runs it took

| run | writes issued | rows kept | `sum(_sample_interval)` |
|---|---|---|---|
| `33712204759` | 9 | 5 | 9 |
| `33712779159` | 9 | 7 | 9 |
| `33712991908` | 90 | 20 | 90 |
| `33713216975` | 90 | 20 | 90 |

**Run 1 fit a clean model exactly and the model was wrong.** Every two-write
request produced one row with `_sample_interval = 2`; the single-write request
produced a row with 1. That is precisely what "Analytics Engine keeps one data
point per Worker invocation" predicts.

**Latency was ruled out rather than assumed.** `--readback` — a mode that writes
nothing and looks over six hours — ran five minutes later and found the same five
rows. It exists because "the writes were lost" and "AE has not ingested them yet"
produce identical output at minute three, and polling harder inside the same run
cannot separate them.

**Run 2 disproved the model.** Same nine writes, seven rows, and
`/archive/game:postseason` — the single-write request that cannot be sampled
under a per-invocation rule — absent entirely.

**Run 3 settled what the column is.** Ninety writes across ten rounds:
`_sample_interval` came back 12 and 13 on two sites and 1 on two others. It is a
**stream-level rate stamped at ingest, not a per-site count**. It makes the total
exact and says nothing reliable about any one site.
`/archive/score-by-id:postseason` surfaced zero rows across ten rounds while its
sibling in the same request surfaced four — and no number of rounds fixes that.

### So the per-site claim moved off Analytics Engine

```
  per-site execution proof, from the routes' own responses:
    ok    /archive/game:regular                  R1 response table=regular_season_games
    ok    writeMLBSeriesResult:regular           regular_season_games.importance for the control row = sweep; only writeMLBSeriesResult sets it
    ok    /archive/game:postseason               R2 response table=postseason_games
    ok    /archive/score-by-id:regular-espn      R3 changes=1 — the postseason UPDATE is only reached when this one returns 0
    ok    /archive/score-by-id:postseason-espn   R3 changes=1 — 1 means the postseason UPDATE matched the control row
    ok    /archive/score-by-id:regular           R4 changes=1
    ok    /archive/score-by-id:postseason        R4 changes=1
    ok    /archive/drama-by-id:regular           R5 changes=1 (round 1)
    ok    /archive/drama-by-id:postseason        R5 changes=1 (round 1)
PASS  all 9 controllable sites are proven to have executed
```

The mechanism: `R3`/`R4`/`R5` address the postseason control row created earlier
in the same round rather than a nonexistent id. The regular UPDATE then changes 0
rows, the postseason UPDATE changes 1, and `changes: 1` in the route's own
response proves **both** branches ran — the second is only reached when the first
returns zero.

```
  total rows 20, sum(_sample_interval) 90, writes issued 90
PASS  all 90 control writes reached the dataset

  survived sampling by name: 8/9. Absent this run: /archive/score-by-id:postseason
  — sampling, not silence; see the proofs above.

PASS  every site records the verb its statement uses
PASS  every site records the table its name claims
PASS  every surviving site is one this build declares
PASS  every control entry carries scheme=control
PASS  country and ASN travel; an IP never does
```

The last three are not decoration. A call wired to the wrong table would satisfy
both counts above and fail "the table its name claims". And an entry carrying an
IP would violate the CC-CMD's third security constraint silently.

### The tenth site, reported as its own state

```
NOT OBSERVABLE  /admin/archive/backfill-went-to-ot:regular: absent. Not a failure
      and not a pass — the route writes only when a real MLB/WNBA row with a NULL
      went_to_ot matches a live /v2/games entry for its date, and no synthetic row
      can produce that (the run reports `no v2/games match` for the 2099 row it was
      handed), and it is issued ONCE rather than per round because it touches real
      rows. It is an UPDATE, so it cannot create a row of any scheme; its silence
      does not weaken the finding, and this line says so rather than omitting the
      site.
```

### Cleanup asserted, not assumed

```
PASS  cleanup: 2099-04-01 is empty
PASS  cleanup: 2099-04-02 is empty
PASS  cleanup: the control brief is gone
```

Synthetic 2099 dates so no real slate was written to, a pre-check clearing
leftovers so no assertion could pass for the wrong reason, and the brief
`writeMLBSeriesResult` inserts deleted along with the rows.

## What sampling costs, and what it does not

**Nothing this CC-CMD turns on.** Both writes in every pair target the same row
`id`, so they carry the same `blob1`. A dash-scheme write cannot be sampled into
another scheme. `verify-staged-items.mjs` check 6 now reads
`sum(if(blob1 = 'dash', _sample_interval, 0))` — `countIf` undercounted by exactly
the factor the dataset was already reporting.

What is lost is which of two doors inside one request. Making that lossless needs
one data point per request rather than one per write, and every mechanism for it
is a structural change to the fetch handler, which CLAUDE.md says requires
explicit authorization. Not done, and not smuggled in under a telemetry commit.

## Three guard failures were sitting at HEAD, and two were mine

| guard | since | cause |
|---|---|---|
| `check-exposed-secrets` | 2026-09-02 | `3635050` compiled the relay gate in, taking the ratchet 115 → 116 |
| `check-doc-citations` | 2026-09-02 | `9ece38e`'s three bare citations took the bare count 9 → 12 |
| `check-handoff-current` | 2026-09-01 | 12 work commits post-dating the 2026-08-29 close-out |

`guards.yml` runs only on non-`src` pushes and reports separately from
`deploy.yml`, so a red guards job does not block anything and had gone unread for
two days. All three are green now: the gate moved to `process.env` with no
default, the enumeration doc's citations carry their statements, and the
close-out is written.

## Residual

- **Task 4, the 48-hour window**, is automated: `staged-verification.yml` runs
  daily at 06:00 UTC and reports one of five states. No carry-forward.
- **The instrument still cannot name an external writer.** It proves the write is
  not ours. Naming one needs Cloudflare's D1 audit or an origin column stamped at
  insert time, neither reachable from a route that writer does not call.
- **591 dash-scheme rows** predate the instrumentation and are unattributable.
- **`/d1/execute` is gated by a hardcoded string literal**, not an env binding, in
  a public repo. Recorded in the CC-CMD deliberately rather than as a public
  issue. The fix has an order: source first, then retire
  `bootstrap-relay-secret.yml`, then rotate.
