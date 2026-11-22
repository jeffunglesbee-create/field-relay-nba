# CC-CMD-2026-11-22-kali-shut-down

**Status: OPEN.** Filed 2026-11-22 by the AFLW source read (field-laboratory `docs/CC-CMD-2026-11-11-live-scores-other-sports.md`, Task 3 item 1). Repo: field-relay-nba, `src/cache-helpers.js` and one new check script. Rule 87: self-completing. Rule 69: nothing outside the files named below.

**BUILD-ON-A, searched 2026-11-22.** `grep -rli kali docs outbox` in field-relay-nba and field-laboratory lists eleven relay CC-CMDs that mention Kali (2026-06-26 to 2026-08-08, among them `kali-relay`, `afl-kali-kv-cache`, `afl-kali-relayfetch-fix`, `afl-wp-kali-integration`) and field-laboratory session notes. `grep -rn -i -E "back in 2027|torn down|offline"` against `docs/`, `outbox/`, `CLAUDE.md` and `HANDOFF.md` of both repos finds nothing about Kali being down. No CC-CMD records the shutdown, so this is a new one. It undoes none of those CC-CMDs: the KV cache (`2026-07-08-afl-kali-kv-cache`) and the `relayFetch` extraction stay as they are.

## What happened (Rule 73: read 2026-11-22, by the method named)

| claim | evidence | method |
|---|---|---|
| The Kali author shut the service down on 2026-09-23 | README banner: "This project is paused. The hosted API and site are offline — back in 2027." and "As of 23 September 2026 ... the public REST API at `/api/afl/v1/*` and the MCP server no longer exist. The GCP infrastructure (Cloud Run, Cloud SQL, load balancer, scheduled scrapes) has been torn down. **Existing API keys no longer work.**" | Exa fetch of github.com/MFergie121/kali-afl-stats README, default branch; commit `b50577b` ("docs: mark the project paused until 2027", 2026-09-22T14:20:42Z) says the GCP project was deleted |
| The three URL classes the relay calls answer HTTP 200 with an HTML page, not an error | `GET https://kaliaflstats.com/api/afl/v1/predictions?year=2026`, `/teams` and `/fixture` each: `RESULT: HTTP 200, 5818 bytes`, body starts `<!doctype html>` ... `<title>kali-afl — back in 2027</title>` | GitHub-hosted runner, `probe-url.yml` run 45084086791 (field-laboratory), 2026-11-22T23:35Z |
| Kali's data has no AFLW | `git grep -n -i -E "aflw|women|womens|ladies|female|gender"` over all 352 tracked files at `b50577b` (lockfile excluded) returns 0 hits, with the control `footywire` matching 22 files; `schema.ts` has no competition, league or gender column; match ids are Footywire ids and fixtures come from Squiggle. The README says AFL data "from 2000 onwards"; no file says "men's". | skeptic re-read of the repo through raw.githubusercontent.com, 2026-11-22 (evidence file, topic `kali-aflw`, claim k6); the fitzRoy package documents that Footywire has no AFLW data (third-party text) |

## Where the relay calls Kali (HEAD `345715d`, read with `grep -a`, 2026-11-22)

| site | what it does with a Kali answer | what it does when Kali fails |
|---|---|---|
| `src/index.js:4410` `buildAFLJournalismContext` → `relayFetchKV(KALI_BASE/predictions?year=&round=, ..., env.KALI_CACHE)` (no timeout argument; `relayFetchKV`'s `timeoutMs` defaults to `null`, `cache-helpers.js:143`) | parses JSON, fills `journalism.kali` | `kali` stays `null`; a parse failure is caught at `:4442` and logged; the caller at `:4648` is in a try/catch |
| `src/wp-resolver.js:438` `resolveWinProbability` AFL branch → `relayFetchKV(..., 5000)` | `r.json()` | any failure (non-ok, or `r.json()` throwing inside the try at `:439-:459`) falls to Squiggle Aggregate; both failing returns `null` (`:479-:481`) |
| `src/index.js:17324-17342` route `/kali/*` → `relayFetch` (the Cache API helper shared with other call sites, `cache-helpers.js:31-60`) | passes the upstream body through labelled `application/json` | non-2xx: the upstream status; a 2xx is forwarded and cached whatever the body is |

`relayFetchKV` has exactly two callers (`grep -a -n relayFetchKV src/*.js`: `index.js:4410`, `wp-resolver.js:438`), both Kali. So a change inside it reaches nothing else.

## The defect, stated from the code and the probe together

`relayFetchKV` treats any `upstream.ok` as a good answer: `const bodyText = await upstream.text(); await kv.put(cacheKey, bodyText, { expirationTtl: ttl })` (`cache-helpers.js:164-165`), and every later hit is served as `Content-Type: application/json` (`:147-150`). Kali's holding page is a 2xx HTML body. So the first AFL call after the season returns would store 5818 bytes of HTML under the Kali URL for `ttl` seconds (3600 at `wp-resolver.js:441`) and replay it as JSON. Both callers then fail to parse it and fall back, so nothing breaks loudly: the cost is a wasted upstream call per cache window, a KV write of a page that is not data, and the `/kali/*` route handing a client HTML labelled JSON. The relay also sends `Authorization: Bearer <KALI_AFL_TOKEN>` (`index.js:4411`, `wp-resolver.js:440`, `index.js:17338`) to that host on every miss; the README says issued keys no longer work.

Nothing calls it today: the AFL offseason has no AFL games (`buildAFLJournalismContext` returns `{}` for an empty slate, `:4382`) and no AFL pick to resolve. Not read: whether `KALI_CACHE` already holds an HTML entry from an earlier call (the Cloudflare MCP lists KV namespaces but this session has no key read).

## Premises to refute first (Rule 100)

1. "The holding host answers the relay's URLs with an error, so nothing is cached." REFUTED 2026-11-22 by the probe above (HTTP 200, HTML).
2. "A Kali outage breaks AFL journalism or win probability." Not what the code says: both callers fall back (table above). The harm is the cache write and the mislabelled replay, not a failure. Do not describe it as an outage fix.
3. "The Playwright spec `AVV-AFL-002` goes red on its own." REFUTED: in jubilant-bassoon `.github/workflows/adapter-visible-value.yml` the push trigger is commented out and only `workflow_dispatch` is live (read 2026-11-22 at jubilant-bassoon `63e6eb8`). `tests/adapter-visible-value.spec.js:291-297` returns early when there are no AFL games and otherwise expects `gamesWithKali > 0`, so it would fail only if someone dispatches it in the 2027 season while Kali is still offline. Not touched here (Rule 69); recorded so the next person who dispatches it is not surprised.

## Tasks

**Task 0. Probe block, first.** `git log --oneline -5`; `grep -a -n relayFetchKV src/*.js` (expect exactly the two callers above plus the definition and an import); `sed -n 141,190p src/cache-helpers.js`; re-run the probe: dispatch `probe-url.yml` in field-laboratory with `urls` set to the three Kali URLs above and read the run's log. If any of them now returns JSON, Kali is back and Task 1 still stands (the guard is correct for any host); say so in the outbox.

**Task 1. Do not store a body that is not JSON.** In `relayFetchKV` (`src/cache-helpers.js`), after the `upstream.ok` check and before `kv.put`, parse `bodyText`; if it does not parse, return `new Response(`${source} returned a non-JSON body`, { status: 502, headers: { 'X-RELAY-Error': `${source}-not-json`, ...CORS } })` and do not call `kv.put`. Impact analysis (Rule 13), from the table above: `index.js:4410` reads `kaliResp.value.ok` and gets `false`, which leaves `kali` as `null`, the same outcome as today's caught parse failure; `wp-resolver.js:438` gets `r.ok === false` and falls to Squiggle, the same outcome as today. No other caller. Do not change `relayFetch` (it has other call sites; the `/kali/*` route question is O1).

**Task 2. A check that fails on purpose (Rule 90).** New `scripts/check-kali-nonjson-not-cached.mjs`, in the style of `scripts/check-v2-games-nba-board.mjs` (read it first, copy its `--mutate` convention): import `relayFetchKV`, stub `fetch` and a KV with a `put` counter, and assert these cases, printing `checked N of N cases`: (a) upstream 200 with the 5818-byte holding page text returns a non-2xx and `put` is never called; (b) upstream 200 with `{"ok":true}` returns 200 and calls `put` once; (c) upstream 503 returns 503 and does not call `put`; (d) a cache hit returns the stored body without calling `fetch`. `--mutate` removes the guard from a temporary copy and the script must exit non-zero (case a fails), and must assert its anchor was found exactly once before reporting (Rule 90: a mutation that applied nothing is NOT CAUGHT, which is worse than no test). Wire the script where the other `check-*.mjs` guards run (grep `check-v2-games-nba-board` in `.github/workflows/deploy.yml` and `package.json` and add it beside it, no other workflow change).

**Task 3. Execute and record (Rule 87.3).** Run the script and its `--mutate`; commit single-concern (`fix: relayFetchKV does not store a non-JSON body`); push to `main`; wait for `deploy.yml`; record the run id.

**Task 4. Outbox manifest, last.** `outbox/cc-session-2026-11-22-kali-shut-down.md` (Rule 67): commit hash, deploy run id, the script's printed `checked 4 of 4` and mutation result, the probe output from Task 0. Do not write the literal CI-skip token in any commit message.

## Done condition (a probe output, Rule 89)

`node scripts/check-kali-nonjson-not-cached.mjs` prints `checked 4 of 4 cases, 4 passed` and `node scripts/check-kali-nonjson-not-cached.mjs --mutate` prints `mutation applied (1 anchor) ... CAUGHT` with a non-zero exit, both committed in the outbox manifest; `deploy.yml` green on the commit.

## Owner questions (a ruling is needed; neither blocks Tasks 0 to 4)

- **O1. The `/kali/*` route and the Kali branches in `buildAFLJournalismContext` and `resolveWinProbability`.** Kali's author says it is "back in 2027" and gives no reason or date. Recommendation: leave all three in place (they degrade to `null` / Squiggle), because removing them is a larger change on a stated pause and CLAUDE.md forbids removing routes; revisit if Kali is still offline when the 2027 AFL round 1 is served. The alternative is removing Kali from the AFL context and the resolver now, which needs its own CC-CMD with a CONTRACTS.md edit for `journalism.kali`.
- **O2. A replacement for what Kali supplied** (win probability and factors for AFL pre-match context). Squiggle Aggregate is already the resolver's second source. A new source is a separate decision.

## Staged (Rule 74)

End to end in a real AFL slate is not testable: no AFL game is scheduled until the 2027 season (date not read). Blocked by: the offseason. Unblocked when: the first AFL round of 2027 is on the slate. Verify then: `mcp__FIELD_Handoff__probe_relay_route` on `/v2/games?sport=afl&date=<that ET day>` and read `journalism.kali` per game (expected `null` while Kali is offline, populated if it is back); `curl`-equivalent of the outbox script's case (a) is the proof until then.
