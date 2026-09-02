# CC-CMD-2026-09-01-archive-game-numeric-espn-upsert-key

**Filed from:** field-laboratory, after a 30-day credential-free sweep.
**Ask to:** field-relay-nba, `POST /archive/game`, the id composition at
`src/index.js:11641`.
**Settles:** field-relay-nba#1, both of its Rule 39 open items.
**Status:** **CLOSED 2026-09-02 — deployed and both done conditions asserted
against the live worker.** Commit `ce32eaa` (contains `d253209`), deploy run 888
/ `33655153163`, assertion run `33655821329`.

```
A. one numeric source_id, two spellings
   MLB_2099-03-01_e999000111 twice  ->  1 row
   PASS  A1: exactly ONE row       PASS  A2: its id ends _e<digits>
B. golf_999999999, two spellings
   MLB_2099-03-02_testalpha_dream + MLB_2099-03-02_testalphafc_atlantadream
   PASS  B1: still TWO rows        PASS  B2: neither id ends _e<digits>
ALL ASSERTIONS PASSED
```

Held from 2026-09-01 to 2026-09-02 because the exposure probe read
`quiet-window`; released when it read `clear` (116 forward rows, 0 exposed).
Manifest: `outbox/cc-session-2026-09-02-numeric-espn-upsert-key-deploy.md`.
Residual disclosed there: 197 rows (18.2%) keep the team-name key.

## What #1 asked for, and why that exact shape must not ship

Issue #1 proposes: *"when `espn_event_id` is present, build the id from it."*

Swept 30 days of public `GET /context/date`. **1085 rows, 13 collision groups.**
Ten are the same fixture under two spellings — the bug #1 is about. **Three are
two genuinely different games sharing one id**, and all three are golf:

```
golf_401811960   R3 + R4, Rocket Classic
golf_401811962   R3 + R4, FedEx St. Jude Championship
golf_401811963   R1 + R2, BMW Championship
```

`golf_NNNNNNNNN` is a **per-tournament** synthetic key. Two rounds of one
tournament are two archive rows under it. Building the id from it would collapse
R3 into R4 and destroy a scored row — the precise hazard the series fix's
`(series_key, round, date)` check was run to exclude, arriving here as a
positive result instead of a negative one.

**This is not a defect awaiting a fix. It is this repo's own convention**, and
the Drive session doc for `CC-CMD-2026-08-25-golf-sport-label` states it: the
`[GOLF-BRIEF]` path builds its archive id as `` `golf_${eventId}_R${roundNum}` ``
while storing `espn_event_id = 'golf_401811963'`. Rounds are distinguished in the
`id`; the event id is deliberately the tournament. So the numeric filter is a
permanent boundary, not a workaround someone will later remove — and any future
individual-competitor league added under that path (Korn Ferry, Champions, LPGA,
DP World) inherits the same shape without needing this spec revisited.

That same 2026-08-25 doc removed a *different* golf duplicate — the generic ESPN
walker writing `PGA Tour_2026-08-20_src401811963` alongside the golf-aware row.
That one is fixed and is not what this sweep found. The pairs here are both from
the golf path and are both correct.

Every collision group that was safe carried a **bare numeric** ESPN event id.

## THE CORRECTION THAT ONLY A PROBE PRODUCES

**`espn_event_id` is not a field of this route's request body.**

The destructure at `src/index.js:11631` reads:

```js
let {
    sport, league, date, home, away, home_score, away_score,
    venue, streams, note, crew, series_key, series_record,
    game_number, round, importance, source_id, start_time, went_to_ot,
} = body || {};
```

No `espn_event_id`. The column is populated from `source_id`, at both bind
sites — `source_id ? String(source_id) : null`, `src/index.js:11761` and
`src/index.js:11788`.

So the change reads `source_id`. Code written against the issue's own wording
would read a property the route never receives, `undefined` on every call, and
the guard would silently never fire — a change that deploys green and does
nothing. Rule 87's probe block is what catches this, and nothing else does.

The precedent already exists two lines below the destructure: `idTail` has a
`src${shortify(source_id)}` branch, used today when `home`/`away` are absent.

## The change

At `src/index.js:11641`, one predicate and one branch.

```js
const shortify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A source_id that is a bare ESPN event id, and nothing else. Golf's
// `golf_401811962` is a per-TOURNAMENT synthetic key covering R1..R4 as
// separate rows: keying on it merges two real games. Measured 2026-09-01 over
// 30 days / 1085 rows — 3 collisions on different fixtures, all of that shape,
// zero among numeric ids. The filter IS the safety result.
const isEspnEventId = v => /^\d+$/.test(String(v ?? ''));

const homeShort = shortify(home);
const awayShort = shortify(away);
const idTail = (homeShort && awayShort)
    ? `${homeShort}_${awayShort}`
    : (source_id ? `src${shortify(source_id)}` : `g${Date.now()}`);
```

and at the `const id =` ternary (`src/index.js:11709`), one arm added ahead of
the name-based arm, leaving both existing arms byte-identical:

```js
const id = series_key
    ? `${sport}_${series_key}_${shortify(round) || 'r'}_${date}`
    : isEspnEventId(source_id)
        ? `${sport}_${date}_e${source_id}`
        : `${sport}_${date}_${idTail}`;
```

`e` prefixes the tail so a numeric-scheme id can never coincide with a
name-scheme one. The argument is structural, not a claim about team names: the
name tail is `` `${homeShort}_${awayShort}` `` and therefore **always contains an
underscore**, while `e401857186` contains none. No pair of team names can produce
it, whatever they are called.

**This is a third tail scheme, and that is deliberate.** `src${shortify(source_id)}`
already exists one line above and fires only when `home`/`away` are absent — a
different condition on a different input (it shortifies, so `golf_401811963`
becomes `srcgolf401811963`). Reusing `src` would merge two conditions whose
scopes differ, and the generic ESPN walker's rows already occupy it
(`PGA Tour_2026-08-20_src401811963`, per `CC-CMD-2026-08-10-archive-gap-real-write-path`).
A separate prefix keeps each condition's rows identifiable in the table.

**Ordering is load-bearing.** `series_key` stays first. A postseason leg that
also carries a numeric `source_id` must keep the series scheme, or the 2026-07-15
fix is silently reverted for exactly the rows it was written for.

### Scope boundary (Rule 69)

Touch the id composition and nothing else. Do not backfill existing rows' ids —
`/archive/score-by-id` and `briefs.game_id` join `games.id`, and the 2026-07-15
CC-CMD's refusal to rename applies here unchanged and for the same reason. Do
not modify either INSERT, either bind list, or the route's response.

## What this does NOT fix, stated as a number

```
any espn_event_id : 908 / 1085  (83.7%)
NUMERIC (in scope): 888 / 1085  (81.8%)
cannot address    : 197         (18.2%)
    MLS   177
    golf   20
```

197 rows keep the name-derived id **and the duplicate bug they have today**.
This is a partial fix by construction. MLS rows that carry a numeric id (e.g.
`761769`, `761703`) are covered; the 177 that carry none are not, and MLS is one
of the three fixtures that opened #1 — so #1 does not fully close on this change.

The 2026-08-08 CC-CMD's 55 stale MLS duplicate groups are also untouched: those
are already-written rows, and this changes only what future writes key on.

## Done condition (Rule 87 #2, Rule 89)

Not "deploy succeeded". Two artifacts, both externally checkable:

1. **The guard fires.** After deploy, `POST /archive/game` twice to the same
   fixture with a numeric `source_id` and two different spellings of the team
   names, then read it back:

   ```
   curl -s "$RELAY/context/date/$DATE" | node -e '…'
   ```

   Assert **exactly one row** carries that `source_id`, and that its `id`
   matches `/_e\d+$/`. Two rows, or an id without the `e`-tail, is a FAIL.

2. **The name scheme is untouched.** The same two POSTs with a NON-numeric
   `source_id` (`golf_999999999`) must still produce **two** rows under the two
   name spellings — the pre-change behaviour. One row here means the filter
   leaked and a golf round was merged.

**`/archive/game` requires no auth** — verified 2026-08-11 by 33 POSTs returning
HTTP 200 (`CC-CMD-2026-08-10-archive-gap-real-write-path`, run log in that
session's outbox). The method allow-list at `src/index.js:11798` would 405 it,
but the route is handled well before that gate is reached. So both assertions are
executable from a runner with no credential.

Both assertions run in this session against the deployed worker, not described
for a later one (Rule 87 #3). Use a synthetic future `date` so no real slate is
written to, and delete nothing afterwards: leave the probe rows in place rather
than issue a DELETE against the archive.

## Tasks

1. Probe: re-read `src/index.js:11631` and `:11709` at HEAD and confirm the
   destructure and ternary still read as quoted above. If they do not, stop and
   report — this spec resolved against `e1b7ed1`.
2. Apply the change. `git diff --staged` must show **one file, one hunk, ≤ 8
   lines added, 0 removed** beyond the ternary's reindent.
3. Commit to `main`. No `[skip ci]` — this touches `src/**` and must deploy.
4. Run both done-condition assertions against the deployed worker. Paste both
   outputs verbatim into the outbox manifest.
5. Outbox manifest last: commit hash, deploy run id, both assertion outputs, and
   the 197-row remainder restated as the residual.

## Evidence

field-laboratory `outbox/espn-id-collisions-2026-09-01T02-09-31-408Z.txt`,
committed by run `33461469548`. Every collision group is listed with both rows
and its same-or-different classification, so the three golf pairs are checkable
rather than asserted. The sweep is credential-free by construction —
`/context/date` is a public read that already carries the field.
