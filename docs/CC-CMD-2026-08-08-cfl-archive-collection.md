# CC-CMD-2026-08-08-cfl-archive-collection

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-cfl-archive-collection.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this isn't a LEAGUES entry — read before writing any code

CFL is absent from the `LEAGUES` list the archive writer polls, so CFL
games never enter `/context/date/`. The obvious fix — add
`{sport:'football', league:'cfl', label:'CFL'}` — is **actively wrong,
not just incomplete**: `LEAGUES` drives an ESPN scoreboard fetch, and
ESPN's `football/cfl` route returns stale 2022 season data as a real,
fully-populated HTTP 200. That row would archive four-year-old games as
current, which is worse than the current absence.

The relay already proxies a real, live CFL scoreboard source instead:
`cflscoreboard.cfl.ca` (relay route `/cfl/scoreboard/rounds`,
`src/index.js:11162`, already cache-guarded at 30s). This needs its own
collection path in the archive writer, not a `LEAGUES` row.

## Real, measured shape — re-verify, don't re-trust

Confirmed via a real CI probe (three runs; the first two each stopped
one level short — worth reading their own history before assuming the
shape below is obvious):

- **Root is a bare array of rounds** (27 measured), games nest under
  `rounds[].tournaments[]` (93 measured, full PRE/REG/POST season in one
  ~155KB call). Not a `games` or `fixtures` key.
- Real record shape:
  ```jsonc
  { "id": 13419665, "date": "2026-05-18T19:00:00+00:00", "status": "complete",
    "homeSquad": { "id": 112939, "name": "Calgary Stampeders", "shortName": "CGY", "score": 20 },
    "awaySquad": { "id": 106752, "name": "Saskatchewan Roughriders", "shortName": "SSK", "score": 15 },
    "winner": 112939, "activePeriod": null, "clock": null, "possession": "None",
    "timeouts": {"away": 2, "home": 2}, "cflId": 6582, "isHidden": false }
  ```
- `date`, `home`/`away` names, `home_score`/`away_score`, `start_time` are
  all directly present — no separate id→name lookup needed.
- **`venue` has no source anywhere in this payload** — confirmed via a
  full key search at every depth. This is a real, deliberate gap:
  either write it null explicitly, or find a second source. Do not
  invent a venue value.

## The real, measured trap — this is the part that matters most

`homeSquad.score` is non-null on 100% of records (93/93) — including
games that have **not been played**. Measured cross-tab:

```
status        n    0-0   null   points   winner-set
complete      46      0      0      46          46
scheduled     47     47      0       0           0
```

Unplayed fixtures carry `0`, never `null`. A writer that gates on "is
score present" archives 47 phantom 0–0 finals — a fully-populated
response that is wrong, structurally the same failure class as ESPN's
stale data, just disguised differently. **Gate on `status === 'complete'`
(or `winner != null` — both agree on every measured record, either is
correct, do not invent a third condition).**

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-probe `cflscoreboard.cfl.ca` fresh (`scripts/probe-cfl-scoreboard-shape.mjs`
  exists in field-playground if a reference implementation helps, but do
  not depend on that repo — write or re-derive the check independently
  here). Confirm the shape above still holds and the staleness test
  still comes back clean (all dates in the current year).
- Confirm the real, current `LEAGUES` list and archive-writer structure
  in `src/index.js` haven't changed shape since this doc was written.

## Task 2 — Build the collection path

- A new, CFL-specific function in the archive writer (not a `LEAGUES`
  entry) that fetches `/cfl/scoreboard/rounds`, flattens
  `rounds[].tournaments[]`, filters to `status === 'complete'`, and maps
  each to the real `/archive/game` payload shape (matching every other
  sport's existing writer as the pattern to follow, not reinvent).
- `venue`: write null explicitly, with a comment stating why (no source
  in this payload) — do not guess or hardcode a placeholder.
- `sport`/`league` label: use a real, chosen constant — check this
  project's existing label conventions (matching how EFL Cup/EFL Trophy
  chose sponsor-neutral, stable labels this same week) rather than
  inventing one ad hoc.

## Task 3 — Real verification

- `probe_relay_route /context/date/{a real date with completed CFL games,
  from the measured payload above}` returning real CFL rows, none of
  them phantom 0-0s from scheduled-but-unplayed fixtures.
- Confirm zero CFL rows exist for dates where every game is still
  `scheduled` (proving the trap is genuinely gated, not just described).
- Confirm this repo's real quality gate passes.

---

## Explicitly NOT in scope

- Do not add CFL to `LEAGUES` or route it through the ESPN scoreboard
  path — confirmed actively wrong above.
- Do not attempt live-score polling verification — the payload's live
  fields (`activePeriod`, `clock`) were null on every measured record
  because no CFL game was in progress during probing; this remains
  genuinely untested and should stay flagged as such, not assumed
  working.
- Do not invent a venue source.

---

## Outbox

`outbox/cc-session-2026-08-08-cfl-archive-collection.md`: the real
collection path shipped, the real gate condition used and why, and real
verification against both a completed-games date and a scheduled-only
date.
