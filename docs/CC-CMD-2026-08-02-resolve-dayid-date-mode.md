# CC-CMD-2026-08-02-resolve-dayid-date-mode

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-resolve-dayid-date-mode.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

`docs/CC-CMD-2026-08-02-wire-bundesliga-broadcasts-into-client.md`
(jubilant-bassoon) shipped real Bundesliga game-card creation but
found `resolve-dayid` cannot be safely called per-game: ESPN's
Bundesliga scoreboard has no matchday/week field (jubilant-bassoon's
`outbox/probe-espn-bundesliga-matchday-field-result.json`, confirmed
against real 2025-26-season events), so there is no safe way for the
client to know which numeric `matchday` (1-40) a given ESPN-fetched
game belongs to. Guessing from date risks silently attaching the wrong
matchday's broadcast data on international-break/midweek-round weeks —
explicitly rejected rather than shipped.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-read `resolve-dayid`'s current implementation (`src/index.js`,
  search `/bundesliga-bapi/resolve-dayid`) fresh — confirm it still
  requires `season` + integer `matchday` (1-40) and still uses
  Cloudflare Browser Rendering to visit
  `bundesliga.com/en/bundesliga/matchday/{season}/{matchday}`.
- Confirm live, via the existing CI-as-proxy pattern (this sandbox
  cannot reach bundesliga.com), what
  `bundesliga.com/en/bundesliga/matchday` (no season/matchday suffix)
  currently returns for its default `/broadcasts/{comId}/{dayId}`
  request — earlier session evidence says this defaults to whatever
  the site currently considers "current" (returned `DFL-COM-000003`,
  the Supercup, during preseason). Real, fresh confirmation required,
  not reused from a prior session's diagnostic.

## Task 2 — Add a date-based resolution mode

- Extend `/bundesliga-bapi/resolve-dayid` to accept an optional `date`
  param (ISO `YYYY-MM-DD`) as an alternative to `matchday`. When
  `date` is given instead of `matchday`:
  - Navigate to `bundesliga.com/en/bundesliga/matchday/{season}` (no
    matchday suffix) and let the site's own default/"current" routing
    resolve it, OR navigate day-by-day/matchday-by-matchday to find
    the real matchday whose real fixture list contains a game on that
    date — pick whichever approach real Task 1 evidence supports; do
    not assume without checking what the unparametrized page actually
    shows across different real dates.
  - Cache the resolved `(date → dayId/comId)` mapping the same way the
    existing `(season, matchday)` cache works (`bundesliga_dayid_cache`
    table or a real, justified variant) — do not skip caching.
- Do not remove or change the existing `matchday`-based mode — this is
  additive. Do not touch anything outside this route.

## Task 3 — Smoke + real verification

- Real verification: call the extended route with a real `date` that
  falls within a real, currently-known matchday window (once the
  season starts Aug 28, or the Supercup context before then) and
  confirm it returns a real, correct `dayId`/`comId` — cross-check
  against what the equivalent `matchday`-based call returns for the
  same real fixture, where both are knowable.
- No `smoke.js` in this repo — confirm `deploy.yml` succeeds.

---

## Explicitly NOT in scope

- Do not change the existing `matchday`-based mode's behavior or
  response shape.
- Do not touch `/bundesliga-bapi/broadcasts` (the other route) unless
  Task 1's fresh evidence shows it's genuinely required.
- Do not wire this into the jubilant-bassoon client in this pass —
  that's a follow-up, paired CC-CMD once this route is real and live
  (Rule 70 atomic-change pairing).

---

## Outbox

`outbox/cc-session-2026-08-02-resolve-dayid-date-mode.md`: real Task 1
findings, the shipped date-mode route, and real live verification
against a genuinely known real date/matchday pairing.
