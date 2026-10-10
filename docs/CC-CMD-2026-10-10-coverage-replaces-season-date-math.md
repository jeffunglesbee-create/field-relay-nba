# Claude Code Command — a token-free vendor endpoint replaces season date arithmetic

**Date:** 2026-10-10
**Repo:** field-relay-nba, then jubilant-bassoon — one change, two repos, per Rule 70
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (correctness) — removes a guessed fact and replaces it with a stated one
**Status:** FILED, not started.

**Rule F:** "is this competition in season" is the most commodity fact in
sport. **Rule 47:** pure forward; the relay computes no season.

## Why this exists

`jubilant-bassoon/src/legacy/field.js:15043` carried, for eight competitions:

```js
epl: false, // off-season
eflchamp: false, eflone: false, efltwo: false,
laliga: false, seriea: false, bundesliga: false, ligue1: false,
```

above the comment "European leagues ended ≤2026-05-26 — set true next season."
Nobody set them true. **Eight competitions were dark from mid-August until
`92ec656`**, which replaced the literals with `_euSeasonActive()` — a date
calculation. That is better than a frozen boolean and it is still a guess about
a fact the vendor states for free.

## MEASUREMENT — the endpoint, called live 2026-10-10 at 21:47Z

`GET https://sports.bzzoiro.com/api/v2/coverage/`, **no token**, reachable even
from the authoring sandbox (which is 403 at the gateway for statsapi.mlb.com,
api.open-meteo.com and api.nuget.org — so this is a genuinely open endpoint, not
a proxy artifact):

| sport | status | events_next_7d | priced_next_7d | live_now |
|---|---|---|---|---|
| football | in_season | 574 | **350** | 0 |
| tennis | in_season | 280 | 17 | 1 |
| hockey | in_season | 205 | 56 | 5 |
| horseracing | in_season | 236 | 236 | 0 |
| basketball | in_season | 57 | 46 | 0 |
| darts | in_season | 51 | **0** | 3 |
| csgo | in_season | 6 | **0** | 4 |

Per-sport fields: `status` ∈ `in_season | between_events | off_season |
no_fixtures`, plus `events_next_7d`, `events_next_30d`, `events_last_7d`,
`priced_next_7d`, `live_now`, `next_event_at`, `last_event_at`, `docs_url`.
`?sport=<x>` narrows it. Seven sports, not football only.

**`priced_next_7d` is the field that matters most.** This repository has spent
real effort on "why does a sport get nothing?" — three separate mechanisms were
proposed and killed for MLS odds, and the actual defect turned out to be a
cache-stripped quota header collapsing to 0 (Rule 99 / DISTINGUISHABILITY-A).
`priced_next_7d` is the vendor stating availability directly. And darts and csgo
today read **in_season with 0 priced**, which is exactly the third state this
project keeps having to invent: "has fixtures" and "has prices" are different
claims and must not share a representation.

## Tasks

**Task 1 — the route.** `/bsd/coverage` → `/api/v2/coverage/`, pure forward.
Note that the BSD handler currently 404s unlisted paths ("Unknown BSD route"),
so this needs an explicit branch. **No token is required upstream** — do not
attach one, and do not make the route fail when `BSD_API_TOKEN` is absent, which
the current handler's 503 guard would do if the branch sits below it.

TTL: the payload describes a 7-day and 30-day horizon, so it does not need the
25s cache the live feed uses. Pick a TTL from what the data actually changes at
and say so in the comment; a season boundary moves once.

**Task 2 — three states, not two.** The response must let a caller distinguish
`off_season` (vendor says no), `in_season` with `priced_next_7d: 0` (fixtures
but no prices), and "the coverage call itself failed" (we do not know). The
third must never read as either of the first two. That is the whole defect class
this replaces.

**Task 3 — then the client (Rule 70).** Replace `_euSeasonActive()` with the
vendor's `status` for every BSD-covered soccer competition. Keep the date
calculation as the answer when the coverage call fails, clearly labelled as a
fallback-of-last-resort rather than the source of truth, and emit a distinct
state so a reader can tell which one answered.

**Coverage is football-wide, not per competition.** It says football is in
season; it does not say the EFL Two is. So this replaces the eight-boolean
*class* of defect only to the extent the vendor's granularity allows — Task 4
settles how far that is.

**Task 4 — measure the granularity before trusting it.** `?sport=football`
returns one row for all football. If per-league season state is needed,
`/api/v2/leagues/{id}/season/` and `/api/v2/leagues/{id}/seasons/` are declared
in the schema and unprobed. Probe one — EPL — and record whether it carries a
current-season flag or only a list. **Do not assume it does.** Report, and if it
does not, say plainly that per-competition season state has no vendor source and
the date calculation stays for that layer.

## Stop conditions

- If the coverage route needs the token, STOP and report — that contradicts the
  measurement above and means something changed upstream.
- Do not delete `_euSeasonActive()`. A removed fallback with a failing new
  source is an outage, and this document exists because eight leagues went dark.

## Done conditions

1. `/bsd/coverage` forwards the payload, works with no token, and is in the
   probe allow-list.
2. The three states of Task 2 are distinguishable in the response, with a check.
3. The client reads the vendor's season state, with the date calculation demoted
   and labelled, and which source answered is visible.
4. An artifact records whether per-league season state exists upstream.
