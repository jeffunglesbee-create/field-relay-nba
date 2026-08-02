# CC-CMD-2026-08-02-add-browser-rendering-bundesliga-dayid

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Explicitly approved by Jeff** (2026-08-02) as a new infra dependency
— this is not unilateral.

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-add-browser-rendering-bundesliga-dayid.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists, precisely

`wire-bundesliga-bapi-broadcasts-v2` (jubilant-bassoon) proved, with
real evidence across 3 matchdays, that Bundesliga's `DFL-DAY-XXX` id is
matchday-specific and resolvable — but only via the site's own
client-side URL router (`bundesliga.com/en/bundesliga/matchday/
{season}/{N}` → Angular app resolves internally → fires the real
`/broadcasts/{comId}/{dayId}` request). No plain HTTP endpoint doing
this resolution was found after a thorough search (initial load,
post-consent, post-switch, widened cross-domain sweep — all
documented). A Workers relay has no headless browser and cannot
natively replicate "load this URL and read what request it triggers."

Cloudflare Browser Rendering (the Workers Puppeteer/Playwright API) is
a real, existing Cloudflare product that closes this gap: the relay
itself can render the matchday URL server-side and capture the
resulting request.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-confirm the 3-matchday proof still holds fresh (`DFL-DAY-004CBT`/
  `004CBX`/`004CC2` for matchdays 1/5/10) — the site could have changed
  since this was last checked.
- Re-confirm no plain HTTP resolution endpoint has appeared since —
  re-run the same kind of full-network-capture sweep the prior session
  did before concluding Browser Rendering is still necessary.
- Read Cloudflare's current Browser Rendering docs fresh (pricing,
  binding syntax, rate limits) — do not build against remembered API
  shape from training data.

## Task 2 — Add the binding, scoped narrowly

- Add Browser Rendering as a new binding in `wrangler.jsonc`, scoped to
  this one use case. This is not a general "render any URL" feature —
  the binding should back a single, specific relay route (e.g.
  `/bundesliga-bapi/resolve-dayid?season=X&matchday=N`), not an
  open-ended rendering API.
- The route: render `bundesliga.com/en/bundesliga/matchday/{season}/{N}`
  server-side, capture the resulting `/broadcasts/{comId}/{dayId}`
  request URL, extract and return `dayId`.

## Task 3 — Persistent caching is not optional, it's the point

**A given (season, matchday) → DFL-DAY-XXX mapping never changes once
resolved.** The expensive render step must run at most once per
matchday, ever — not once per request. Cache the resolved mapping in
D1 (reuse the existing `field-archive` database, new table, e.g.
`bundesliga_dayid_cache(season, matchday, dfl_day_id, resolved_at)`)
or KV, whichever matches this repo's existing convention more closely
(check first, don't guess). The route checks the cache before ever
invoking Browser Rendering, and only renders on a genuine cache miss.

## Task 4 — RUWT/Rule A reasoning, stated explicitly in the commit

This is a factual ID lookup (which broadcast-data key corresponds to
which matchday), served only on pull/request — never autonomously
pushed, never a drama-score or value judgment. State this reasoning
explicitly in the commit message and outbox doc so it's checkable
later, matching this repo's existing ADR-002 discipline.

## Task 5 — Smoke + real verification

- Real verification: call the new route for at least 2 distinct
  matchdays, confirm each returns the correct, real `DFL-DAY-XXX`
  (cross-check against the 3 known values from Task 1's re-verification
  if the same matchdays are used). Confirm the second call for the
  same matchday hits cache, not a second render (check timing/cost, or
  a cache-hit log line — real evidence, not assumed).
- Confirm the smoke gate for this repo passes, if one exists (check
  first).

---

## Explicitly NOT in scope

- Do not build a general-purpose "render any URL" endpoint — this is
  one route, one use case.
- Do not wire this into jubilant-bassoon's client yet — that's a
  separate, later CC-CMD once this route is proven live. This CC-CMD
  ships the relay capability only.
- Do not skip the caching layer "to ship faster" — an uncached version
  would re-render on every request, which is both slow and a real,
  avoidable cost.

---

## Outbox

`outbox/cc-session-2026-08-02-add-browser-rendering-bundesliga-dayid.md`:
the real binding added, the real cache table/mechanism used, and real
verification that a second request for the same matchday hits cache
rather than re-rendering.
