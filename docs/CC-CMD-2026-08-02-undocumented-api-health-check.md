# CC-CMD-2026-08-02-undocumented-api-health-check

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-undocumented-api-health-check.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

Two real, undocumented, reverse-engineered API dependencies now exist:
`apim.laliga.com` (LaLiga standings, keyed, real fallback to FD if it
breaks) and `wapp.bapi.bundesliga.com` (Bundesliga broadcasts + day-ID
resolution, keyed, **zero real fallback** if it breaks). Neither is a
licensed, contracted relationship — both were found by watching real
site traffic, and today's LaLiga "key rotated" scare (which turned out
to be a misread, not a real rotation) shows these can produce false
alarms as easily as real breaks. Right now, the only way either gets
noticed failing is a user-facing feature breaking or a session
happening to probe it directly.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

Re-confirm the current, real, working request shape for both:
- `apim.laliga.com`'s `clasificacion` endpoint (key, headers)
- `wapp.bapi.bundesliga.com`'s `resolve-dayid` + `broadcasts` chain

Do not assume either shape from memory — re-read the actual, current
relay routes (`/laliga-apim/clasificacion`, `/bundesliga-bapi/*`) to
get the real, current request construction.

## Task 2 — Scheduled health-check workflow

Add a new scheduled workflow (check this repo's existing scheduled-
workflow cadence conventions and match one rather than picking
arbitrarily — daily is likely appropriate given neither endpoint is
live-game-critical) that:

- Calls both relay routes for real, current data (LaLiga: today's
  season; Bundesliga: resolve a real, current-window date via
  date-mode, matching how the client itself would call it).
- Confirms each returns a real 200 with the expected real shape, not
  just a non-error status.
- If either fails, or returns a shape that doesn't match what Task 1
  just confirmed, write a real, checkable record —
  `codex_write` with `category:"incident"` — including which
  endpoint, what was expected, what was actually returned.
- Explicitly note in the incident record whether a real fallback
  exists for the failing dependency (LaLiga: yes, FD; Bundesliga: no) —
  this asymmetry matters for how urgently it needs a response.

## Task 3 — Smoke + verify

- Confirm this repo's real smoke/deploy gate (established this
  session: no `smoke.js` here, `deploy.yml`'s inline checks are the
  real gate) passes.
- Trigger the new workflow manually once and confirm it runs cleanly
  against current healthy state — both endpoints genuinely still work
  as of this CC-CMD's execution, so this should report no incident.

---

## Explicitly NOT in scope

- Do not attempt automated remediation — detection and recording only.
- Do not add health checks for any other data source — scope is
  specifically these two undocumented, reverse-engineered dependencies.

---

## Outbox

`outbox/cc-session-2026-08-02-undocumented-api-health-check.md`: the
real workflow shipped, and confirmation it ran cleanly against current
healthy state for both endpoints.
