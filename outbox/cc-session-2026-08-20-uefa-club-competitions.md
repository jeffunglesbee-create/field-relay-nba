# CC Session — 2026-08-20 — execute CC-CMD-2026-08-20-uefa-club-competitions

**Filed from:** field-laboratory (`docs/CC-CMD-2026-08-20-uefa-club-competitions.md`)
**Executed in:** field-relay-nba
**HEAD:** `8a6d05e` → `8289762` (feat) → `07b987e` (ci)

## The ask, and why it was not what shipped

The CC-CMD asked for two things: (1) add UEFA Champions/Europa/Conference to
`V2_LEAGUES`, and (2) declare the `sport`/`league` label each will carry.

**Probing HEAD first (Rule 87) showed both were already done.**

- `V2_LEAGUES` has carried `ucl` / `europa` / `conference` since the June 26
  2026 ESPN+BSD migration, with exactly the slugs and BSD lids the CC-CMD
  requested (`uefa.champions`/7, `uefa.europa`/8, `uefa.europa.conf`/8) — plus
  three qualifying variants added by CC-CMD-2026-07-15.
- `SOCCER_LEAGUE_LABELS` already declares all six labels.

So ask 1 was complete and ask 2 was already answered. **The answer to ask 2 is
below** — and it is not what the CC-CMD suggested.

## Root cause: a third table, unguarded

`/context/date` reads **only** `ARCHIVE_DB` (`regular_season_games` /
`postseason_games`). It never touches `V2_LEAGUES` or live ESPN. The archive is
written by the journalism cron, which iterates a **`LEAGUES` table** inside
`handleJournalismCycle` — and no UEFA competition had a row there.

That is the whole bug. Config was correct, labels were correct, and
`/v2/games?sport=ucl` worked on demand — while nothing was ever persisted.
Hence `/context/date/2026-08-19` listing 49 games with no Champions League among
them, against config that reads as complete.

The existing CI check ("Soccer league label contract check", deploy.yml) verifies
`V2_LEAGUES` ↔ `SOCCER_LEAGUE_LABELS` through live `/v2/games`. An on-demand
fetch is healthy whether or not a `LEAGUES` row exists, so that check passed
happily for months across the gap.

## Declared labels (ask 2 — the laboratory's answer)

Verbatim from `SOCCER_LEAGUE_LABELS`, now also in `LEAGUES`:

| competition | label (`sport` AND `league` in the payload) |
|---|---|
| Champions League | `UEFA Champions League` |
| Europa League | `UEFA Europa League` |
| Conference League | `UEFA Europa Conference League` |
| Champions League qualifying | `UEFA Champions League Qualifying` |
| Europa League qualifying | `UEFA Europa League Qualifying` |
| Conference League qualifying | `UEFA Europa Conference League Qualifying` |

There is **no separate `league` field value** — the archive-write sites send
`sport: gm.league, league: gm.league`, so both carry the same string.

**The CC-CMD's suggested labels would have been wrong.** It proposed
`"Champions League"` / `"Europa League"` / `"Conference League"` (no `UEFA`
prefix). Those strings appear nowhere in the relay. Worse, the label is
persisted into the archive `sport` column *and* forms the archive id prefix, so
adopting them would have split each competition across two id namespaces — the
same failure `CC-CMD-2026-07-15-wc-label-fragmentation` had to clean up for WC26.

## Why the qualifying slugs are included

Not scope creep — the three-entry ask does not work without them. Probed
2026-08-20 via CF-Worker egress against `site.web.api.espn.com`:

```
uefa.champions?dates=20260819       -> events: []   (season still 2025-26, type "Final")
uefa.champions_qual?dates=20260819  -> real fixtures (LASK Linz at Celtic, FT, Playoff Round)
uefa.europa_qual?dates=20260820     -> Anderlecht at Kairat Almaty, 15:00Z, Playoff Round 1st Leg
uefa.europa.conf_qual?dates=20260820-> F.C. København at FC Inter Turku, 16:00Z, Playoff Round 1st Leg
```

**2026-08-19 is the CC-CMD's own cited observation date**, and its fixtures are
under the *qualifying* slug. Implementing the literal three-entry ask would have
satisfied the request as written and still rendered zero Champions League games
on the exact date that motivated it. Likewise the CC-CMD's Thursday observation
("MLS and Leagues Cup only"): today's Europa and Conference fixtures are both
`_qual`. UEFA's Jul–Aug qualifying and Aug–May main draw are one competition to
a viewer and two slugs to ESPN.

## What shipped

**`8289762`** — six rows added to the cron `LEAGUES` table (3 main + 3
qualifying), labels copied verbatim from `SOCCER_LEAGUE_LABELS`.

**`07b987e`** — `scripts/check-leagues-label-contract.mjs` + a blocking
pre-deploy step in `deploy.yml`. Two static assertions:

- **A. Label contract** — every soccer `LEAGUES` label is a declared
  `SOCCER_LEAGUE_LABELS` value.
- **B. Archive coverage** — every `espnLeague`-routed soccer `V2_LEAGUES` key has
  a `LEAGUES` row, except an explicit allowlist (`eflchamp`, `eflone`, `efltwo`,
  which are genuinely uncovered today). A *new* config-without-coverage entry
  now fails the deploy instead of silently repeating this outcome.

Negative-tested, both fail by name:
```
removing the ucl LEAGUES row -> FAIL: V2_LEAGUES key 'ucl' (uefa.champions) has no LEAGUES row…
label drifted to 'Europa League' -> FAIL: LEAGUES row 'uefa.europa' has label 'Europa League', which is not a declared…
```
(The A test uses precisely the label the CC-CMD suggested. The guard rejects it.)

## Done condition (Rule 90 artifact) — CORRECTED

**A correction to my own first draft of this doc.** I originally specified
`/archive/query?sport=UEFA%20Europa%20League%20Qualifying` as the done-condition
probe. That route reads the **briefs** table, not `regular_season_games` (see its
handler comment at `src/index.js:11617`). It returns journalism prose. A `count: 0`
there proves no brief was written — it says nothing about whether a game row exists.

**The CC-CMD's evidence has the same flaw.** Its `/archive/query?sport=Champions%20League`
/ `…=UEFA%20Champions%20League` / `…=Europa%20League` → `count: 0` findings do not
demonstrate missing game rows. Its `/context/date` measurements do, and those are
sound — which is why the root cause and the fix are unaffected.

The correct probe reads the games table:

```
curl -s "$RELAY/context/date/2026-08-20" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const u=d.games.regular.filter(g=>String(g.sport).startsWith("UEFA"));
  console.assert(u.length>0,"no UEFA rows");
  console.log("PASS",u.length,[...new Set(u.map(g=>g.sport))]);'
```
Must list at least one row whose `sport` starts with `UEFA` — expected today:
Anderlecht at Kairat Almaty, F.C. København at FC Inter Turku. Note the route
sets `Cache-Control: public,max-age=300`, so allow for a stale read.

**Status: VERIFIED.** Closed by a CI-as-proxy probe
(`.github/workflows/uefa-archive-probe.yml` + `scripts/probe-uefa-archive.mjs`,
commit `d5a1002`), because a GitHub runner can POST `/d1/execute` and count the
rows directly — the route binds `env.ARCHIVE_DB` and `regular_season_games` is in
its `ALLOWED_TABLES`. Committed manifest
`outbox/uefa-archive-probe-manifest-20260820T131905Z.json`:

```
query_ok: true      landed: true
uefa_rows_total: 43   uefa_rows_today: 36   (date_probed 2026-08-20)
UEFA Europa Conference League Qualifying  24
UEFA Europa League Qualifying             12
UEFA Champions League Qualifying           4
```
Real fixtures, e.g. `UEFA Europa Conference League Qualifying_2026-08-20_shamrock_kupskuopio`
(Shamrock v KuPS Kuopio, Tallaght Stadium, 19:00Z), Getafe v FK Partizan, Braga v
Vienna. The earlier `count: 0` readings were the briefs-table trap described above,
not an absent write path.

`query_ok` is deliberately separate from `landed` so a broken probe can never be
misread as "the archive has none" — verified by running it from the sandbox,
where the egress block yields `query_ok:false`, null counts, exit 1, and an
explicit disclaimer.

## New finding from the probe's first run — a seventh label variant

The probe caught something a pass/fail boolean would have hidden:

```
labels_present includes  "UEFA Conference League"  -> 1 row
labels_missing:          ["UEFA Europa Conference League"]
```

`UEFA Conference League` is **not** one of the six declared strings. It cannot
have come from this fix — the three main-draw slugs return `events: []` today, and
the LEAGUES row declares `UEFA Europa Conference League`. Each main-draw label
holds exactly 1 row, so these predate the change and were written by some other
path (client-supplied `/archive/game`, most likely).

This is the **WC26 label-fragmentation class** (`CC-CMD-2026-07-15`, which found 12
variants under `briefs.sport`). It matters because the archive `sport` string is
also the leading segment of the archive id, so each variant is a separate id
namespace for what is one competition.

**The static guard cannot catch this** — `check-leagues-label-contract.mjs`
compares source tables, and these rows are already in D1. `0ed29fb` extended the
probe with `nonconforming_rows` / `nonconforming_count`, and the second run
(`outbox/uefa-archive-probe-manifest-20260820T132044Z.json`) identified it
exactly — **one row, and it is benign**:

```
id:         2026-05-27-conference-crystalpalace-rayovallecano
sport:      UEFA Conference League
date:       2026-05-27   (Crystal Palace v Rayo Vallecano)
created_at: 2026-07-05
```

Its id uses the lowercase-slug form `{date}-{comp}-{home}-{away}`, not the cron
seed's `{sport}_{date}_{home}_{away}`. That is the same shape as the MLS rows in
`/context/date` (`2026-08-20-mls-van-hou`, `created_at 2026-07-06`), so this came
from the early-July hand-seeded schedule import, not from any live writer. **No
writer is emitting this label today** — `nonconforming_count` is 1 and static,
and the fix's own 36 rows all carry declared labels.

Remediation, NOT done here and deliberately so: a single
`UPDATE regular_season_games SET sport = 'UEFA Europa Conference League' WHERE id =
'2026-05-27-conference-crystalpalace-rayovallecano'`. It is a mutation of live D1
data for a match played in May, outside this CC-CMD's scope, and the probe now
makes the row permanently visible rather than silently fragmenting. Worth a
one-line CC-CMD; not worth an unrequested write.

## For the laboratory

`sportOfString` should key on the six exact strings in the table above. The
CC-CMD's plan to observe the label via the drift-sentinel before modelling still
holds and is still the right order — this doc just supplies the labels the
sentinel will see, so the modelling can be written against a declared contract
rather than a guess.

Register the follow-up probe against **`/context/date/<date>`** filtered on
`sport` starting with `UEFA` — NOT against `/archive/query?sport=…`, which reads
the briefs table and would report `landed: false` forever even once games are
archived. The CC-CMD proposed the archive-query form; that is the one thing in it
to change.

Key the probe on a **qualifying** label (`UEFA Europa League Qualifying` has
fixtures today), not on `Champions League` — the main-draw slugs stay empty until
the league phase opens 2026-09-16 per ESPN's own calendar, so a `landed`
predicate keyed on them reads as failed for a month.

## Not touched (Rule 69)

Two other `LEAGUES`-shaped tables exist — a `LEAGUES_LOCAL` mirror (~L12233) and
a debug-probe list (~L14214). Both are already incomplete subsets predating this
work, and neither drives archive writes. Left alone; noted here rather than
silently "fixed".
