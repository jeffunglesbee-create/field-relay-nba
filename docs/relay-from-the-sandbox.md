# Looking at the relay from the sandbox

**Measured 2026-11-01** (Rule 73): `curl -sS -m 10 https://field-relay-nba.jeffunglesbee.workers.dev/health` from a cloud session's
sandbox exits with code 000 (no response). The agent proxy's own status
(`curl -sS "$HTTPS_PROXY/__agentproxy/status"`, field `recentRelayFailures`) records `connect_rejected: gateway answered 403 to CONNECT` for
`field-relay-nba.jeffunglesbee.workers.dev:443`, `statsapi.mlb.com:443` and `site.api.espn.com:443`. `api.github.com` and
`raw.githubusercontent.com` answer; `gh api` REST calls (workflow dispatch, runs, jobs) work, `gh workflow run` and `gh run view --log` do not
(GraphQL and a log redirect are refused). That is this environment's network policy, not a relay fault. It is why sessions kept writing
"STAGED: the sandbox cannot reach the relay".

## Which way, for what

| You want | Use | Cost | Limit |
|---|---|---|---|
| One of the routes `probe_relay_route` allows (FIELD_Handoff MCP) | `probe_relay_route` | seconds | allow-listed GET routes, body capped at 12 KB |
| A row or a count from the archive | Cloudflare MCP `d1_database_query`, database `cc49101c-0569-4d41-8e7a-be139cde4f26` (ARCHIVE_DB) | seconds | `SELECT` only, by convention |
| One of five routes (below), a body over 12 KB, or the response headers | **`scripts/relay-look.sh`** | about a minute, one workflow run | the five routes in `scripts/relay-read.mjs` |
| All of the above without the round trip, permanently | the owner adds the relay host under **Allowed domains** in the environment's network settings (cloud environment menu, Edit, Network access) | one change | then `curl` works and none of this is needed |

If you need a route that spends Odds API credits, none of these is the answer: ask the owner. If you need a game board, `probe_relay_route` carries its own list.

## `scripts/relay-look.sh`

```
scripts/relay-look.sh "/budget/odds?date=2026-11-01" "/health"
```

Run it from a checkout of field-relay-nba with `gh` authenticated. It dispatches `.github/workflows/relay-read.yml` over the REST API, finds its own run by title
(`relay-read <label>`), waits (up to six minutes), **fetches** the artifact the run committed (`outbox/relay-read-<label>-<stamp>.json`; it never pulls or rebases, so a dirty
tree or an unpushed commit is no obstacle) and prints each route's status and body (first 2000 characters; the file has all of it, up to 256 KB per route). Run it inside
any git checkout, the relay's by preference. At most 10 routes per dispatch; the rest are refused in the artifact, not dropped.

The artifact records, per route: `status`, `ok`, `ms`, the response headers that matter (`cf-cache-status`, `age`, `x-field-model`, ...), `bytes`, `truncated`,
`json`, `body`. A refused route carries `refused: true` and `why`. The run goes **red** if any route was refused or failed, so a look that did not look cannot read as one.

## What it will read, and what it will not

An allow-list of five routes, matched on the whole path (not a prefix, not a child, not another case, no trailing slash), and nothing else. There is **no override**:
the first version had an `allow_unlisted` dispatch input and a deny-list, and the independent review of 2026-11-01 reached spending and writing routes through it. A deny-list cannot be
made complete for a relay with several hundred routes. The five were read in `src/index.js` to the end, with every query parameter:

| Route | What it does | Caveat |
|---|---|---|
| `/health` | one KV read | |
| `/budget/odds` | D1 and KV reads; the ledger, `by_site`, `reconcile`, `monthly` | makes ONE edge-cached (60 s) call to the vendor's `/v4/sports`, which the vendor documents as free and the relay labels ODDS-FREE; measured `x-requests-last` 0 on one reading, so a belief rather than a guarantee. The drift, pairing and vendor watches read it every few hours. |
| `/analytics/status` | one KV read | |
| `/analytics/degraded` | a bound-parameter D1 read | |
| `/archive/query` | bound parameters only, no SQL or table name, limit capped at 50 | costs D1 rows read, not credits |

Routes that look harmless and are not (found in review, 2026-11-01; each is refused by the self-test): `/v2/games` (soccer: charges the Odds API for team lambdas through
`getWCPregameLambdas` and writes D1/R2/Durable Objects; NHL/NBA: enqueues an LLM brief for every final), `/wc/match-wp`, `/wc/projections` and `/wc/elimination-traps`
(each fetches `/wc/odds-probs` on the relay's own behalf), `/analytics/run` (an unauthenticated GET that runs the analytics engine), `/backfill/*`, `/integrity/briefs?repair=true`,
`/schedule/ai-fallback`, `/live/ambient`. And the routes that spend directly: `/cfl/odds-probs`, `/wc/odds-probs`, `/odds`, `/identity`, `/archive/odds-backfill`, `/archive/game`.

- **No credential is sent.** The relay's shared secret opens `/web-fetch` (a fetch of any URL), `/admin` and `_forcePrimaryFail`; the workflow does not receive it. A 401 from a
  route here means the route is not one this tool is meant to read.
- Redirects are not followed.
- The typed path must equal an allowed path, so the path that is sent is the path that was typed. The URL parser resolves dot segments, percent-encoded ones included
  (`/health/%2e%2e/cfl/odds-probs` is sent as `/cfl/odds-probs`); a policy that judged the string by prefix let that through in the first version. A 400,000-string fuzz
  of the first version's policy found no bypass of its deny-list, and the exact-match rule leaves nothing for a fuzz to find.

## Adding a route to the list

Read its handler to the end, every query parameter included, and look for: a call that reaches a vendor, a queue or an LLM; a write of any kind (D1, KV, R2, a Durable Object,
`waitUntil`); and a fetch of the relay's **own** routes (`grep` the handler for `${RELAY}`, `JOURNALISM_QUEUE`, `consumeOddsCredit`). Then edit `ALLOWED` and the pinned list in
the self-test (two places on purpose), add a mutant to `scripts/mutate-relay-read.mjs` for the new entry, and run `node scripts/mutate-relay-read.mjs` (every mutation must be CAUGHT).

## When it fails

| You see | It means | Do |
|---|---|---|
| `no run appeared` | the dispatch was accepted but the run did not start within two minutes | `gh api repos/jeffunglesbee-create/field-relay-nba/actions/workflows/relay-read.yml/runs?per_page=5` |
| the run is red, artifact has `refused` entries | the route is not on the list; `why` says so | use one of the five, or follow "Adding a route to the list" |
| the run is red, an entry has `error` | the runner could not reach the relay (timeout, DNS, connection) | rerun once; if it repeats, the relay is down, which is itself the finding |
| an entry has `status` 401/403/404 | the route exists but is not public, or does not exist | read its handler in `src/index.js` |
| `committed no artifact` | the run ended before it wrote one (the policy self-test went red, or the job timed out), or the commit step lost a push race and gave up | open the run URL it prints; if the run was green, `git fetch origin main` and look for `outbox/relay-read-<label>-*.json` |
| `the run is still going` | six minutes passed; ten routes at a 20 s timeout each is the job's worst case | the URL and label it prints; the run commits its artifact when it finishes |
| `dispatch attempt 1 of 3 failed: HTTP 422` | a workflow file pushed a moment ago is not yet dispatchable | the helper retries; wait a minute and rerun if all three fail |
