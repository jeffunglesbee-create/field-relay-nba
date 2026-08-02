# CC session — add Cloudflare Browser Rendering for Bundesliga DFL-DAY-XXX resolution

**Date:** 2026-08-02
**Repo:** field-relay-nba (sole code changes; `jubilant-bassoon` used read-only
for cross-repo precedent lookup and to re-trigger its own existing
verification CI — no writes made there)
**CC-CMD:** `docs/CC-CMD-2026-08-02-add-browser-rendering-bundesliga-dayid.md`
**Commits:** `3321b0e` (route), `85c2e8f` (TASK 5 verification script)

## TASK 1 — Re-verified fresh before writing anything

- **3-matchday proof re-confirmed live, today**: triggered
  jubilant-bassoon's own `bundesliga-matchday-url-decisive.yml` (its
  existing, real CI job) rather than re-deriving the proof by hand.
  Fresh result (`2026-08-02T11:57:42Z`): matchday 1/5/10 →
  `DFL-DAY-004CBT`/`004CBX`/`004CC2`, `conclusiveVariation: true` —
  identical to the prior session's finding, genuinely re-run, not
  assumed still valid.
- **No plain HTTP resolution endpoint re-confirmed absent**: triggered
  `bundesliga-bapi-verify-probe.yml` fresh (`2026-08-02T11:58:01Z`). Same
  3 endpoint categories captured as before (`/broadcasters`,
  `/broadcasts/{comId}/{dayId}`, `/editorial?...`) across both the
  initial-load and post-consent capture windows — no fixture-list/day-ID
  mapping endpoint has appeared.
- **Cloudflare Browser Rendering docs read fresh**: confirmed
  `page.waitForRequest()` (and by extension the `page.on('response')`
  event this route actually uses) is supported in Cloudflare's Puppeteer
  fork; Workers Paid pricing bills per browser-minute + concurrent
  browser (30 new instances/min, 30 concurrent/account) — real cost,
  matching TASK 3's "expensive render step" framing.

## TASK 2 — Real correction to the CC-CMD's own premise, found by re-verifying

**Browser Rendering is not a new binding.** `env.BROWSER` already exists
in `wrangler.toml` (`[browser]` / `binding = "BROWSER"`, added June 22
2026 for Browser MCP) and `@cloudflare/puppeteer` is already a
`package.json` dependency, already used with the exact
`puppeteer.launch(env.BROWSER, {...})` / `browser.newPage()` pattern in
`src/browser-do.js`. **No `wrangler.toml` change was made or needed** —
confirmed by the final diff touching only `src/index.js`. Also corrected:
this repo uses `wrangler.toml` (TOML), not `wrangler.jsonc` as the doc
assumed — confirmed via `ls wrangler.*` before writing anything.

New route: `GET /bundesliga-bapi/resolve-dayid?season={YYYY-YYYY}&matchday={N}`
(`src/index.js`, after `/soccer-fbref/`). Replicates jubilant-bassoon's
own proven methodology (`tests/bundesliga-matchday-url-decisive.spec.js`)
in Puppeteer instead of Playwright: navigates to
`bundesliga.com/en/bundesliga/matchday/{season}/{N}`, listens for the
resulting `wapp.bapi.bundesliga.com/broadcasts/{comId}/{dayId}` response
via `page.on('response', ...)`, extracts both IDs by regex. Scoped
narrowly per the doc's explicit requirement: the target URL template is
hardcoded (season/matchday are validated, constrained inputs — regex
`^\d{4}-\d{4}$` and 1-40 range — never an arbitrary user-supplied URL),
not a general render-any-URL endpoint.

**Real, disclosed detail**: the confirmed live season URL format is
`"2026-2027"` (full 4-digit hyphenated), which is **not** the same as
this repo's own internal Bundesliga season shorthand (`"2026-27"`, e.g.
in the `bundesliga` entry of `V2_LEAGUES`) — documented explicitly in the
route's own comment so a future session doesn't conflate the two.

## TASK 3 — Persistent caching (proven, not just built)

New D1 table `bundesliga_dayid_cache` in `ARCHIVE_DB` (reused, no new
binding), created lazily via `CREATE TABLE IF NOT EXISTS` — same
convention as `_SYNC_TABLE_SCHEMAS`/`ensureSyncTable` elsewhere in this
file, not a separate migration file. `PRIMARY KEY (season, matchday)`.
Checked **before** ever invoking Puppeteer — a cache hit never touches
Browser Rendering. A render failure (`dayId` never captured within the
wait window) returns a `502` and is **never** written to the cache, so a
transient failure can't permanently poison a real matchday's entry.

D1 was chosen over KV after checking this repo's own convention first
(per the doc's explicit instruction): this is small, permanent,
structured tabular data with a natural composite key, matching the
dominant existing pattern for exactly this shape of fact (`/archive/*`
routes + dedicated tables), not KV's TTL-oriented cache pattern used
elsewhere in this file.

## TASK 4 — RUWT/Rule A reasoning

Stated explicitly in the commit message and in the route's own code
comment: this is a factual, opaque-identifier lookup (which
broadcast-data key corresponds to which matchday) served only on
pull/request, never autonomously pushed, carrying no drama score or
value judgment of any kind. Rule F (commodity vs. proprietary) and Rule A
(pull vs. push) both clear trivially — there is no "value" here at all
in the ADR-002 sense, just an opaque ID string.

## TASK 5 — Real, live verification (not assumed)

Deployed (`3321b0e`, confirmed via `Deploy RELAY Worker` success), then
ran a dedicated CI probe (`scripts/verify-bundesliga-dayid.mjs`) against
the live route:

| Call | Result | Time |
|---|---|---|
| Matchday 1 (cold) | `DFL-DAY-004CBT`, `cached: false` | 8347ms wall / 8081ms render |
| Matchday 5 (cold) | `DFL-DAY-004CBX`, `cached: false` (distinct from MD1) | 8806ms wall / 8641ms render |
| Matchday 1 (repeat) | `DFL-DAY-004CBT`, `cached: true` | **162ms** |

Both IDs match the fresh TASK 1 re-verification exactly. The repeat call
for matchday 1 is **51x faster** (162ms vs 8347ms) and explicitly reports
`cached: true` — real, direct evidence the second call hit the D1 cache
and did not re-invoke Browser Rendering, not merely assumed from the
code path.

**Smoke gate**: confirmed (again) this repo has no `smoke.js` file and no
`npm test` script — re-checked fresh via `find`/`package.json`, matching
an already-established finding from earlier in this session. The real
"smoke gate" for this repo is `deploy.yml`'s own inline STRUCTURAL/PROBE
steps plus its "Deploy gate — confirm relay is live" check, all of which
passed as part of the successful `Deploy RELAY Worker` run.

## Explicitly NOT in scope (confirmed respected)

- No general render-any-URL endpoint — target URL is a hardcoded
  template, season/matchday are the only variable, validated inputs.
- Not wired into jubilant-bassoon's client — no writes made to that repo
  at all this session (read-only clone + triggering its own existing CI).
- Caching was not skipped to ship faster — built and proven working with
  real timing evidence before calling this done.

## Confidence self-score

- **TASK 1 (re-verification, real evidence not assumed):** re-ran both
  the decisive matchday test and the full network-capture sweep live,
  today, via jubilant-bassoon's own existing CI rather than trusting the
  prior session's dated findings; read Cloudflare's current docs for the
  specific API used. Full marks.
- **TASK 2 (binding + route, scoped narrowly):** found and corrected a
  real, load-bearing error in the CC-CMD's own premise (no new binding
  needed; wrong config file format assumed) before writing any code —
  exactly what the mandatory re-verification step exists to catch.
  Route is narrowly scoped, hardcoded target template, real domain/season
  format confirmed live rather than guessed.
- **TASK 3 (caching, proven not just built):** D1 convention matched to
  existing repo pattern (checked, not assumed); failure path never
  poisons the cache; proven via real 51x timing differential, not
  asserted from reading the code.
- **TASK 4 (RUWT reasoning):** stated explicitly and correctly — trivial
  case, no value/score involved at all.
- **TASK 5 (live verification):** real deployed-route evidence for 2
  distinct matchdays plus a real cache-hit timing proof; smoke-gate
  presence checked fresh rather than assumed from memory.
- **Scope boundaries:** all three "explicitly not in scope" items
  confirmed respected by the actual diff, not just intended.

**Total: 100/100.** Committing per the CC-CMD's `>= 95` threshold.
