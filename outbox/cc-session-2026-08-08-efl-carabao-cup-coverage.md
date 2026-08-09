# CC-CMD-2026-08-08-efl-carabao-cup-coverage — Result

## Status: DONE. Relay + client both shipped and verified live.

## Task 1 — gate + re-probe

Blocking P0 cleared first: `/v2/games?sport=epl` returned **200** (was
502 `ESPN upstream 403`). Slug re-probed at execution time rather than
trusted from the doc — unchanged: `eng.league_cup`, id `3920`,
`English Carabao Cup`, abbreviation `Carabao Cup`.

**Cup-specific behaviour worth recording:** ESPN does not publish round
N+1 ties until round N resolves. The Aug 26–Sep 2 window returned
`events: []` while Round 1 was still being played. An empty result for a
future round is therefore *correct*, not a fault — anything treating
empty as an error will misfire on this competition.

## Task 2 — relay (`0b779d7`, deployed first per Rule 70)

Three coupled edits, all sharing one label string:
- `SOCCER_LEAGUE_LABELS.eflcup = 'EFL Cup'` — read by
  `adaptESPNWCSoccer` via `SOCCER_LEAGUE_LABELS[sportKey]`
- `V2_LEAGUES.eflcup` → `espnLeague: 'eng.league_cup'`, `bsdLeagueId: null`
- `LEAGUES` (journalism cron) → `{soccer, eng.league_cup, 'EFL Cup'}`

**Label is deliberately sponsor-neutral.** ESPN says "Carabao Cup", but
this competition has been the Milk/Rumbelows/Coca-Cola/Worthington/
Carling/Capital One Cup. The label persists into the archive `sport`
column *and* leads the archive id, so a sponsor rename would fragment
ids exactly as `CC-CMD-2026-07-15-wc-label-fragmentation` had to clean up
for WC26. `'EFL Cup'` also matches the existing EFL family.

`bsdLeagueId: null` because no BSD id was verified — inventing one would
be a Rule 2 violation.

Pre-commit checks I ran locally: both label strings byte-identical (a
mismatch would split one competition across two id namespaces), and
`'EFL Cup'` is not swallowed by `canonicalizeWC26Sport`.

## Task 3 — client (jubilant-bassoon `228284e1`)

`SOCCER_LEAGUES` entry added — this is the **card-creation** mechanism;
its own comment records that V2/FD only overlay scores onto cards that
already exist, so without an entry the competition renders zero cards no
matter what the relay serves.

- `bundle: 'EFL'` **reused, not invented** — `BUNDLES.EFL` is already
  `["paramount","fubo","hulu"]`, matching the real probed broadcasts
  (Paramount+ on QPR v Millwall, Burnley v Notts County, Derby v
  Lincoln). Most ties carry no US broadcast, which is correct.
- **Break gate:** verified by *executing* `isDomesticLeagueInBreak`
  against four dates spanning the competition (all `false`) with
  Bundesliga as a positive control (`true`) — rather than reasoning about
  the substring match.
- smoke: **965 passed, 0 failed**.

## Task 4 — live verification

**Relay** — `/v2/games?sport=eflcup&date=2026-08-08` → HTTP 200:
```
"league":"EFL Cup"          <- chosen label, not the raw key, not WC
Cambridge United 2-1 Barnet (final), full matchEvents
"streams":[{"label":"Paramount+","market":"National"}]
"round":"Carabao Cup, First Round"
```

**Client** — `live-deploy-verify-probe.yml` run
[`31278050296`](https://github.com/jeffunglesbee-create/jubilant-bassoon/actions/runs/31278050296),
HTTP 200, 1,943,602 bytes:
```
--- EFL Cup SOCCER_LEAGUES entry (eng.league_cup) ---
eng.league_cup
```
That string exists nowhere but the new entry, so it is decisive proof
the change reached the deployed bundle.

**Disclosed flaw in my own assertion:** the companion
`section: 'EFL Cup'` grep returned NOT FOUND. That is my assertion being
wrong, not the feature — the pipeline runs esbuild + strip-comments, so
that exact unminified spacing cannot survive minification. The
`eng.league_cup` check is the one that carries the proof.

## Two real defects found and fixed en route

1. **The soccer label contract check was passing vacuously.** Its two
   regexes used `\s ` (whitespace class *plus* a literal space) against
   source written with a single space, so `labels={}` and
   `routed_keys=[]` — it had never asserted anything. Fixed to `\s*`
   (`7bb0148`): labels 0→17, routed 0→17, `uncovered=[]`. Strictly more
   assertive; verified statically before pushing that no pre-existing
   league newly fails. Same class as STRUCTURAL 7's blindness.
2. **My own break of that check** (`96d41ea`): I wrote the archive id
   format as a template literal in a comment inside
   `SOCCER_LEAGUE_LABELS`, and the brace characters truncated the
   parser's `[^{}]*` body match. Self-inflicted by `0b779d7`. Fixed, with
   an in-place warning — and caught a *second* brace inside that warning
   locally, before it reached CI.

## Adjacent findings, deliberately not acted on

- **Client deploy drift** (`outbox/incident-deploy-drift-2026-08-08…`):
  root cause identified as the `SW-Bump` bot committing with the default
  `GITHUB_TOKEN`, which by design does not trigger `push` workflows. My
  own push *did* trigger deploy-gate normally, and carried
  `SW_VERSION 2026-08-08b`, which supersedes the stuck bump.
- **SW_VERSION source-of-truth drift:** `field.js` was at `2026-08-06a`
  while `index.html`/`sw.js` were at `2026-08-08a` — the bot edited
  `index.html` directly and never touched `field.js`. Syncing without
  bumping the source would have dragged `index.html` *backward* and
  broken the match. Bumped at source; both now `2026-08-08b`.
- **`deploy-gate.yml`'s final step only echoes** "Deployed $SHA" — it
  asserts nothing against the live site. A green gate there is
  structural, not evidence. Worth a CC-CMD.
- `eng.trophy` (EFL Trophy, id 18481, 52 fixtures/60d) and `eng.fa`
  (FA Cup, id 3918) resolve and are unwired — each needs its own CC-CMD.

## Outbox
This file.

## Confidence gate

**97.** Both halves shipped and verified live end to end: relay returning `"league":"EFL Cup"` with real match data, and `eng.league_cup` present in the deployed client bundle. Held below 98 by one disclosed flaw of my own -- the companion `section: 'EFL Cup'` assertion was written against unminified spacing and reported NOT FOUND for a feature that had shipped correctly.

*(Backfilled 2026-08-09. The score was stated in session at execution time but never written into this doc. Chat is ephemeral; this file is the record, and a gate that exists only in scrollback is not a gate.)*
