# CC-CMD-2026-08-02-proxy-bundesliga-broadcasts

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-proxy-bundesliga-broadcasts.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The remaining gap

`/bundesliga-bapi/resolve-dayid` (shipped, live, verified) resolves a
matchday number to its real `DFL-DAY-XXX`/`DFL-COM-XXX` identifiers.
It does not return broadcast data itself — that's a separate real
endpoint, `wapp.bapi.bundesliga.com/broadcasts/{comId}/{dayId}`,
confirmed live earlier this session with a real, required auth header:
`x-api-key: 60ETUJ4j5YagIHdu-PROD` (may have changed since — re-verify,
don't assume it's still current).

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Confirm the `x-api-key` value still authenticates against the real
  endpoint fresh, via CI (this sandbox can't reach bundesliga.com
  directly — same pattern as every other probe this session).
- Confirm the real response shape for a genuinely current matchday
  (use `resolve-dayid` to get a real, current `comId`/`dayId` pair
  first, then check what `/broadcasts/{comId}/{dayId}` actually
  returns for it) — do not assume the shape from the earlier
  diagnostic without re-checking, since that was a different matchday.

## Task 2 — Relay route

- Add `GET /bundesliga-bapi/broadcasts?comId=X&dayId=Y` (or similar,
  matching this repo's existing route-naming convention — check first)
  proxying the real endpoint, key server-side (Rule 80), same
  discipline as any other credential in this repo.
- Real failure handling: if the key stops authenticating or the
  endpoint changes shape, return a clear `{available:false}` rather
  than a raw 5xx or malformed data — same pattern used for the LaLiga
  apim route.

## Task 3 — Smoke + verify

- Real verification: call the new route for a real, current
  `comId`/`dayId` pair (resolved via `resolve-dayid` first) and
  confirm real broadcast data comes back, not just a 200 with an empty
  shape.
- Confirm this repo's actual smoke/deploy gate (already established
  this session: no `smoke.js` here, `deploy.yml`'s own inline checks
  are the real gate) passes.

---

## Explicitly NOT in scope

- Do not touch `resolve-dayid` — it's already correct and live.
- Do not wire this into jubilant-bassoon's client — that's the
  separate, dependent CC-CMD (`wire-bundesliga-broadcasts-into-client`,
  jubilant-bassoon), which needs this route to exist first.

---

## Outbox

`outbox/cc-session-2026-08-02-proxy-bundesliga-broadcasts.md`: the
real route shipped, and real verification against a genuinely current
matchday's broadcast data.
