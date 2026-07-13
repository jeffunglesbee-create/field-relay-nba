# Add /mlb-stats to probe_relay_route's ALLOWED_PREFIX — 2026-07-13

## TASK 0 — Probe

**Confirmed real, current `ALLOWED_PREFIX` fresh** (`src/index.js:13740`,
inside the `probe_relay_route` MCP tool handler): exact match to the doc's
snapshot, 22 entries, no drift.

**Confirmed genuinely separate from `MLB_STATS_API_ALLOWED_PREFIXES`**
(the actual data-proxy allowlist at `src/index.js:281`, extended earlier
tonight in `hrd-relay-allowlist`) — two distinct arrays, distinct purposes:
`MLB_STATS_API_ALLOWED_PREFIXES` gates the real `/mlb-stats/*` →
`statsapi.mlb.com` proxy fetch; `ALLOWED_PREFIX` (this fix) gates only
whether the `probe_relay_route` MCP tool is willing to self-fetch a given
path on the worker's own origin at all — a self-contained, unrelated gate a
few thousand lines away in an entirely different part of the file (the MCP
JSON-RPC tool-call handler, not the main fetch-routing cascade).

Also read the surrounding context to confirm the full gate order:
`FORBIDDEN_PREFIX` (`/mcp`, `/oauth`, `/.well-known`, `/debug`, `/push`,
line 13649) is checked **first** and returns early — genuinely independent
of `ALLOWED_PREFIX`, confirming this fix cannot weaken it.

## TASK 1 — Add the entry

One line, exactly as specified, zero other changes:
```diff
-const ALLOWED_PREFIX = [..., '/circadian', '/wiki'];
+const ALLOWED_PREFIX = [..., '/circadian', '/wiki', '/mlb-stats'];
```
Shipped in commit `1abd9b5`.

## TASK 2 — Verify

**Real test, via `probe_relay_route` itself** (the tool this fix changes —
no separate verification workflow needed, deploy + a direct tool call was
sufficient):

- `probe_relay_route({route: "/mlb-stats/homeRunDerby/839032"})` → **HTTP
  200, real, full Home Run Derby bracket + player data** (Kyle Schwarber,
  Ben Rice, Junior Caminero, etc. — the same real gamePk confirmed in
  tonight's earlier `hrd-relay-allowlist` fix).
- **A genuine deploy-propagation false start, caught and re-verified, not
  rationalized (Rule 77)** — matching the exact same transient edge-lag
  pattern hit in tonight's `hrd-relay-allowlist` CC-CMD: the first retry
  immediately after the GitHub Actions deploy completed still returned
  "Route not in allow-list" for `/mlb-stats/homeRunDerby/839032`. Waited
  and retried rather than assuming the fix was wrong; the second retry
  succeeded with real data.
- `probe_relay_route({route: "/mcp"})` → correctly rejected:
  `"Route in forbidden-prefix list: /mcp, /oauth, /.well-known, /debug, /push"`.
- `probe_relay_route({route: "/debug/recent-requests"})` → correctly
  rejected via the same `FORBIDDEN_PREFIX` list.
- `probe_relay_route({route: "/some-totally-unlisted-path"})` → correctly
  rejected via `ALLOWED_PREFIX`/`ALLOWED_EXACT` miss. **The first attempt
  at this check hit the same transient edge-propagation lag** — the
  returned allow-list didn't yet include `/mlb-stats/*` even though the
  Derby call immediately above it had already succeeded (different edge
  PoPs updating at different times, same phenomenon as above). Retried:
  the allow-list now correctly ends `..., /circadian/*, /wiki/*,
  /mlb-stats/*` — confirming the new entry was appended (not inserted
  mid-list, not replacing anything) and every one of the other 22 entries
  is byte-for-byte unchanged.

**Lint/syntax**: `node --check src/index.js` clean.

## DONE CONDITION

`probe_relay_route` genuinely reaches `/mlb-stats/*` routes — confirmed
live with real MLB Stats API data. `FORBIDDEN_PREFIX` and every other
`ALLOWED_PREFIX`/`ALLOWED_EXACT` entry confirmed unaffected via direct
real calls, not code review alone.

## Confidence Score

```
+30  TASK 0: confirmed the real current array fresh, correctly
     distinguished it from MLB_STATS_API_ALLOWED_PREFIXES with real
     reasoning (different array, different purpose, different location in
     the file), confirmed FORBIDDEN_PREFIX's independent check order
+30  TASK 1: correct, minimal, exactly one entry, zero other changes
+40  TASK 2: real live verification via the tool itself -- the new route
     now works with real data, FORBIDDEN_PREFIX still correctly rejects
     (2 real forbidden paths tested), an unlisted path still correctly
     rejects with every other allow-list entry unchanged. A real
     deploy-propagation false start was hit twice (once for the new route,
     once for confirming the reject list) and both times investigated and
     re-verified rather than assumed -- consistent with this same
     session's Rule 77 handling of the identical issue in
     hrd-relay-allowlist a short time earlier.
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `1abd9b5` — the real fix: `/mlb-stats` added to `ALLOWED_PREFIX`
- (this commit) — this outbox, written after full live verification
