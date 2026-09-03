# CC-CMD-2026-09-02-d1-write-provenance

**Filed from:** field-laboratory.
**Ask to:** field-relay-nba — the D1 write paths.
**Relationship:** `CC-CMD-2026-09-01-mls-dual-writer-duplicate` Task 2, split out
per Rule 87 (4). That CC-CMD's Task 1 is DONE and eliminated explanation (2);
this one answers what Task 1 could not reach from outside.
**Status:** OPEN — Tasks 1 and 2 DONE, Task 3 (deploy + control) in flight.
**Task 1 DONE 2026-09-02 — and it narrows what Task 2 can claim.** `scripts/d1-write-sites.mjs` enumerates 285 `prepare()` sites, 87 of
them writes, 0 unreadable. Exactly one path INSERTs into `regular_season_games`
(`src/index.js:11801`, `/archive/game`); `src/index.js:17557` is a fully dynamic
`INSERT OR IGNORE INTO ${table}` that no grep could find, and it is excluded by
`_SYNC_TABLE_SCHEMAS`, whose allowlist holds only `pitcher_expected_stats`.

So no code path here can INSERT a dash-scheme row, and instrumenting all 87
sites will produce the control entry and never a `dash` entry — the NOT OBSERVED
row of the decision table below, permanently. **The instrumentation proves the
write is not ours; it cannot name an external writer.** Naming one needs a
different instrument. See `outbox/2026-09-02-d1-write-enumeration.md`.

The verifier for this document's staged claim shipped 2026-09-02 (`ce32eaa`):
`d1_write_provenance` in `staged-verdicts.mjs`, check 6 in
`verify-staged-items.mjs`, running daily at 06:00 UTC.

## What Task 1 established, and what it could not

A live writer INSERTs dash-scheme MLS rows (`2026-08-30-mls-stl-dal`) **the day
after the game they cover** — measured twice, a month apart, most recently
2026-08-31. `created_at` moving means an INSERT, not an update of a seeded row.

`grep` across `src/`, `.github/scripts/` and `scripts/` finds **no code that
constructs a dash-separated id**, so the writer is external to this repo by
elimination. Which door it comes through is not observable from outside, and
Task 1 deliberately refused to infer it from the id shape.

## Probe block (Rule 87 §1) — read from HEAD, not memory

| fact | HEAD |
|---|---|
| the analytics binding | `JQ_ANALYTICS` → dataset `field_jq_analytics`, `wrangler.toml:138-140` |
| the established call shape | `env.JQ_ANALYTICS.writeDataPoint({` — `src/index.js:8665`, inside `try { if (env.JQ_ANALYTICS) … }` |
| the arbitrary-SQL route | `if (pathname === '/d1/execute' && request.method === 'POST') {` — `src/index.js:14075` |
| its method-gate exemption | `&& !(pathname === '/d1/execute' && request.method === 'POST')` — `src/index.js:12547` |

`/d1/execute` was at `14023` when the sibling CC-CMD was written, `14061` when
this document was, and `14075` after Task 2's instrumentation landed. The route
did not move; the file above it grew, three times, in nine days. **Re-read every
line number before editing** — this table is a measurement with a date on it, not
a fact, which is why each row now carries the text to search for instead.

## The central requirement: a positive control, first

"No log entries in 48 hours" and "the logging never worked" produce **identical
output**. That is the defect this project keeps finding, and a provenance probe
is the easiest possible place to commit it: the thing being watched fires about
once a day, at an unpredictable time, so a silent instrument looks exactly like
a quiet system for as long as anyone is willing to wait.

**So the control comes first and gates everything after it.** A write issued
deliberately through each instrumented path must produce exactly one entry
naming that path. Until that passes, no observation window has started and a
null result means nothing.

## Scope: 10 sites, and Task 1 is why it could narrow

**This section replaces "Instrument every non-SELECT path, not only
`/d1/execute`", which was right when it was written and has been answered.** Its
argument was that watching only the suspected door makes a null result unable to
separate "nothing wrote" from "it came through a door nobody was watching". That
separation is real, and Task 1 makes it **by reading, permanently, at zero
runtime cost** — enumerating all 285 `prepare()` sites and finding the one door a
grep could never see (`src/index.js:17571`,
`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
excluded by an allowlist holding one table). Instrumenting the other 77 writes
adds no discriminating power for the question this document asks.

Of the 87 writes: 20 are schema statements (`CREATE`/`ALTER`, boot-time) and 57
target tables the question does not concern (`briefs` 20, `codex` 8,
`wc_results` 8, `change_log` 4, and a long tail). The instrumented set is every
**runtime** write to the two game tables:

| site | verb | table |
|---|---|---|
| `writeMLBSeriesResult:regular` | UPDATE | regular_season_games |
| `/admin/archive/backfill-went-to-ot:regular` | UPDATE | regular_season_games |
| `/archive/drama-by-id:regular` | UPDATE | regular_season_games |
| `/archive/drama-by-id:postseason` | UPDATE | postseason_games |
| `/archive/score-by-id:regular-espn` | UPDATE | regular_season_games |
| `/archive/score-by-id:postseason-espn` | UPDATE | postseason_games |
| `/archive/score-by-id:regular` | UPDATE | regular_season_games |
| `/archive/score-by-id:postseason` | UPDATE | postseason_games |
| `/archive/game:postseason` | INSERT | postseason_games |
| `/archive/game:regular` | INSERT | regular_season_games |

The name identifies the **write site**, not the route: `/archive/score-by-id`
runs the regular UPDATE and, when it matches nothing, the postseason one — two
doors behind one path. Naming them alike would make the control's "exactly one
entry per site" satisfiable by a route that fired twice, which is the shape of
collapse this project keeps finding.

`D1_WRITE_SITES` in `src/d1-provenance.js` is the list, and
`scripts/d1-provenance-check.mjs` (a deploy guard) fails if a call exists without
a declaration, a declaration without a call, a duplicate name, or a site naming a
route that does not exist at HEAD. That last check exists because the first draft
of the list said `/archive/drama-peak` — written from the field name rather than
probed. The route is `/archive/drama-by-id`.

## Security constraints — non-negotiable

1. **Never log the credential.** `/d1/execute` is gated by a value carried in the
   request. Do not log that header, any header whose name matches
   `/auth|secret|token|key/i`, or the raw header bag.
2. **Never log statement text.** Log the leading verb and the target table,
   parsed out — never the SQL, which can carry row data.
3. **Never log a full IP.** `cf-connecting-ip` identifies a person or a machine;
   the ASN and country answer "which system" without that. If an operator later
   needs the IP, they have Cloudflare's own logs.
4. **Do not open a public issue** naming the auth weakness on `/d1/execute`. This
   repo is public. The finding belongs in this document and in the outbox.

## The change

At each write path, one guarded call following the `8660` convention:

```js
try {
  if (env.JQ_ANALYTICS) {
    env.JQ_ANALYTICS.writeDataPoint({
      indexes: ['d1-write'],
      blobs: [route, verb, table, ua.slice(0, 64), country, String(asn)],
      doubles: [1],
    });
  }
} catch (_) { /* Rule 5: telemetry must never break a primary function */ }
```

Wrapped and swallowing, because an archive or telemetry failure must never break
journalism, score fan-out or MCP.

### Scope boundary (Rule 69)

Add the call and the helper that derives `verb`/`table` from a statement. Change
no route's behaviour, no response shape, no binding in `wrangler.toml`, and no
existing `writeDataPoint` call.

## Done condition (Rule 87 §2, Rule 89) — three states, not two

**Gate — the control.** POST one harmless statement through each instrumented
path and assert **exactly one** entry per path, carrying that route's name.
Artifact: the query output, pasted verbatim. If any path is silent, **STOP**:
the instrument is broken and nothing downstream means anything.

**Then, one of three outcomes, and the middle one is not a pass:**

| outcome | reading |
|---|---|
| an entry for a dash-scheme INSERT, with UA/ASN | Task 2 answered — the caller is named |
| control passes, no dash entry in 48h spanning ≥1 day-after-game window | **NOT OBSERVED.** Neither a pass nor a failure. Extend the window or widen the enumeration; do not close. |
| control fails | the instrument is broken. Fix it; the window has not started. |

"48 hours" is chosen because the two observed writes landed the day after a
game, and the window must contain at least one such day. A window with no game
in it proves nothing and must not be counted.

## Reading the data is automated, and the sentence that said otherwise was wrong

This section previously read "Reading the data needs a credential this session
does not hold" and stated the blocker as "an account-scoped AE read, which no
session credential covers". That was written from reading rather than from
trying, and it is false. `ae-read-scope-probe.yml` asked Analytics Engine for a
count on 2026-09-02 with this repo's existing `CLOUDFLARE_API_TOKEN` and got
**HTTP 200**. The token already deploys the worker and also carries Account
Analytics Read.

The consequence is that this claim has an executor rather than an operator, and
`deploy.yml`'s `staged-verifier-check` was right to refuse the commit while it
did not:

- **STAGED** (verifier: d1_write_provenance @ relay/staged-verification.yml)
- **What:** the caller's identity for dash-scheme INSERTs.
- **Blocked by:** 48 hours of data the instrumentation has not produced yet. The
  dataset held **zero** `d1-write` entries when this was written.
- **Unblocked when:** the instrumentation deploys and a window elapses that
  contains at least one day-after-game.
- **Verify:** `staged-verification.yml` runs daily at 06:00 UTC and reports one
  of five states — never wrote, went silent, no game day in window, not
  observed, or named.

### The blob contract, set here because the instrumentation does not exist yet

The verifier reads `index1 = 'd1-write'` and splits on `blob1`, which carries the
id scheme observed: `control` for the deliberate control write, `dash` for a
dash-scheme INSERT. The verifier and the instrumentation were written in the
wrong order out of necessity, so the contract was stated rather than left to be
discovered by a run that reports zero of everything.

**Task 2 wrote to match, and added one rule the contract did not have: `dash`
outranks `control`.** The control is marked by a request header
(`X-FIELD-Provenance-Control: 1`), and if that header simply overrode the scheme,
anyone sending it while inserting a dash-scheme row would relabel the exact
observation this instrument exists to catch — and the verifier, which counts
`blob1 = 'dash'`, would report NOT OBSERVED forever with the evidence sitting in
the row beside it. So the header can only relabel a write that was not the thing
being looked for. `provenanceScheme` in `src/d1-provenance.js` is four lines and
this is what they are for.

Full blob layout, all literals supplied at the call site — **no SQL text is
passed to the recorder at all**, which is stricter than this document's original
"parse the verb out of the statement":

| blob | value |
|---|---|
| 1 | scheme — `control` / `dash` / `underscore` / `other` / `none` |
| 2 | site — one of the ten names above |
| 3 | verb — `INSERT` / `UPDATE` |
| 4 | table |
| 5 | `user-agent`, 64 bytes, and no other header |
| 6 | `cf.country` |
| 7 | `cf.asn` |

Everything the session can do — the instrumentation, the control write, the
control assertion — happens inside the session (Rule 87 §3). Nothing here is a
carry-forward disguised as a dependency.

## Tasks

1. **Enumerate** every path that can issue a non-SELECT against `ARCHIVE_DB` or
   any D1 binding. Multi-line template literals defeat a single-line grep;
   confirm the count by reading, and record it. This is a task because 191
   `prepare` calls is not an enumeration.
2. **DONE.** Add the provenance call — to the 10 runtime writes against the two
   game tables, under the security constraints, at the scope and for the reason
   in "Scope: 10 sites" above. `src/d1-provenance.js` plus ten one-line call
   sites in `src/index.js`; 20/20 in `scripts/d1-provenance-check.mjs`, proven by
   mutation (removing one call site takes it to 8/10; a stale route name to
   17/20).
3. Deploy, then run the control against each site and paste the query output.
   `.github/workflows/d1-write-provenance-verify.yml`, dispatch-only. Phase A is
   a census that runs `idScheme` over every id in both tables — a falsification
   attempt, because a predicate asserted only against strings that already pass
   is not asserted at all. Phase B is the control.
4. **Only if the control passes**, open the 48-hour window and report one of the
   three outcomes above. Do not report a null result without the control output
   beside it.
5. Outbox manifest last: commit hash, deploy run id, control output verbatim,
   window outcome, and the enumeration from Task 1.

## What this does NOT do

It does not fix the duplicates. The 51 MLS pairs remain, and the numeric-id key
(`d253209`) does not merge them because one row of each pair carries no
`source_id`. A single upsert key both writers can agree on is the sibling
CC-CMD's Task 3, and it cannot be designed until the second writer has a name.
