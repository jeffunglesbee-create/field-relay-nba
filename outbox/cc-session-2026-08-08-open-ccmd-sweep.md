# cc-session-2026-08-08-open-ccmd-sweep

Sweep of un-executed CC-CMDs across both repos, per "Pull un-executed
cc-cmd's from client/relay files. Automate follow-ups. No fallbacks,
only fixes."

## Method, and a correction to my own first pass

My first sweep matched CC-CMD filenames against outbox filenames and
reported ~60 un-executed docs going back to June. That was wrong — the
naming does not correspond reliably. Re-done by checking each August
CC-CMD against both the outbox and `git log --grep`, which reduced it to
**9 genuinely un-executed**, one of which turned out to be already done
under a different name.

## Closed this session

| CC-CMD | Outcome |
|---|---|
| `2026-08-08-investigate-mlb-wnba-archive-gap` | DONE — candidate 2 confirmed, 1 and 3 refuted |
| `2026-08-08-confirm-duplicate-fixture-mechanism` | DONE — hypothesis refuted 55-0 |
| `2026-08-06-wire-efl-cup` (client) | Already satisfied 2026-08-08; closed against its own tasks |
| `2026-08-08-fa-cup-coverage` | Written this session; blocked on ESPN season rollover, unblock probe stated |

Three follow-on CC-CMDs written rather than carried forward (Rule 87):
`backfill-archive-gap-dates`, `diagnose-0805-pre-403-miss`,
`cleanup-stale-duplicate-rows`.

## Still open, with an honest size estimate

Not started. Each is a build task, not a loose end — listing them so the
count is visible rather than implied.

**field-relay-nba**
- `2026-08-08-espn-secondary-source-failover` — highest value of the
  remaining set, and today's archive-gap finding is direct evidence for
  it: a three-day ESPN outage silently cost three days of MLB/WNBA
  archival. Substantial: a new `adaptMlbStatsApi()` emitting the exact
  V2 shape, two-level failover, an observable `source` value, cache
  parity, plus a deliberate resolution of the STRUCTURAL 7 collision
  (statsapi.mlb.com carries no broadcasts, and STRUCTURAL 7 treats
  "real games, no streams" as a hard failure). Needs a forced-failure
  artifact, not a code-reading claim.
- `2026-08-08-cfl-archive-collection` — feature. Notes that the obvious
  `LEAGUES` entry is actively wrong because ESPN's `football/cfl` route
  serves stale 2022 data as a populated 200.
- `2026-08-06-relay-web-fetch-proxy` — new capability class, explicitly
  approved 2026-08-06.

**jubilant-bassoon**
- `2026-08-02-byte-ceiling-options` — the index.html byte ceiling was
  hit twice in one session.
- `2026-08-02-standards-redundancy-audit` — STANDARDS.md near 100 rules.
- `2026-08-03-review-field-identity-test` — visual identity direction
  tested in field-playground.

## Probe infrastructure added

`.github/workflows/archive-gap-probe.yml` now takes a `script` input, so
a new D1 probe needs a script rather than a near-duplicate workflow. The
input is passed via env and validated (bare `.mjs` filename, must exist)
rather than interpolated into the shell line — the job holds
`contents: write` and a dispatch input is attacker-controllable.

Scripts: `scripts/archive-gap-probe.mjs`,
`scripts/duplicate-fixture-probe.mjs`. Both read-only.
