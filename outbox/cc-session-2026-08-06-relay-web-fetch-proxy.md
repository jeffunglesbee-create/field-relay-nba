# CC-CMD-2026-08-06-relay-web-fetch-proxy — Result

## Status: DONE. Route shipped, every guard proven, and it immediately settled an open question.

Commit `21ec1d1e`. Artifact: `outbox/web-fetch-verify-*.log`, produced by
`scripts/web-fetch-verify.mjs`.

## Task 1 — conventions read from HEAD

- Matched `/datamuse/words`: KV cache, CORS, 502 on upstream failure,
  `{ok, error}` shape, same `User-Agent`.
- **No rate-limiting mechanism exists anywhere in this repo.** Searched;
  the only matches are notes about *third-party* limits. So this adds a
  minimal one rather than duplicating a pattern that does not exist —
  stating which, as Task 3 required.
- `6000ms` is this file's dominant fetch-timeout convention (6 uses).

## Task 2 — the guards, with the reasoning for each real number

**Authenticated on `X-FIELD-Relay`, which the CC-CMD did not ask for.**
An unauthenticated fetch proxy on a public hostname is an open proxy:
anyone could launder traffic through this relay's IP and this account's
bandwidth. Same header `/d1/execute` uses, so no new secret, and the
motivating caller can supply it. This is stricter than specified, and
deliberately so.

- **Scheme allow-list** (http/https), so `file:`, `data:`, `ftp:` and
  anything else are rejected by omission rather than by an enumerable
  deny-list.
- **Real DNS resolution** via Cloudflare DoH, with the blocklist applied
  to every resolved address. **Fail-closed** — if the address cannot be
  checked, no fetch happens. Failing open would defeat the guard.
- Blocks 10/8, 127/8, 0/8, 172.16/12, 192.168/16, 169.254/16 (incl.
  169.254.169.254), 100.64/10, multicast, and IPv6 `::1`, `fc00::/7`,
  `fe80::/10`, with `::ffff:` re-checked as v4. Plus `workers.dev` and
  `localhost`, so it cannot reach this relay's own internal routes.
- **2 MB cap**, enforced by reading in chunks and aborting past it — not
  by trusting `content-length`, which an upstream can omit or lie about.
- **30 req/min, GLOBAL not per-caller** (the key carries no caller identity;
  auth is a single shared token, so there is one caller and the distinction
  is moot today — but a second credential would require adding one first).
  High enough not to throttle a real probe loop, low
  enough to bound runaway egress cost.
- **10 min cache TTL**: re-reading a page while working is free; a page
  that really changed is not masked for long.
- Usage logged (host, status, bytes, truncation).
- **Text extraction, no new dependency.** JSON passes through verbatim
  (already structured); HTML is reduced to text. This repo carries no
  HTML-to-text library, and `@cloudflare/puppeteer` is a browser —
  wildly disproportionate for reading page content.

## Task 4 — every case proven, not asserted

```
1. positive
   HTTP 200 upstream=200 bytes=559 ct=text/html
   text: "Example Domain Example Domain This domain is for use in
          documentation examples without needing permission..."
   PASS: extracted text contains real page content, not tags
   PASS: HTML tags were stripped, not passed through raw

2. negatives — all rejected, none silently proxied
   private IP 10/8    -> 400 "blocked address: 10.0.0.1"
   loopback           -> 400 "blocked address: 127.0.0.1"
   cloud metadata     -> 400 "blocked address: 169.254.169.254"
   IPv6 loopback      -> 400 "blocked address: ::1"
   file scheme        -> 400 "scheme not allowed: file:"
   data scheme        -> 400 "scheme not allowed: data:"
   this relay itself  -> 400 "self/internal host not allowed:
                              field-relay-nba.jeffunglesbee.workers.dev"

2b. the case the CC-CMD singled out
   localtest.me -> 400 "host resolves to a blocked address:
                        localtest.me -> 127.0.0.1"

3. auth gate
   unauthenticated -> 401 "unauthorized" — not an open proxy
```

`localtest.me` is the one that matters: a public hostname that resolves
to 127.0.0.1. A string-only guard passes it straight through. Only the
real DNS resolution catches it, which is why fail-closed DoH was worth
the extra request.

Repo quality gate: the deploy run's `deploy` job succeeded and the
soccer league label contract check passed.

## What it settled on its first real use

`CC-CMD-2026-08-09-wnba-secondary-source` stopped at ~70 confidence
because `cdn.wnba.com` served a GitHub runner but returned an HTML error
page to a Cloudflare Worker — and the Worker that saw the error page was
`html_probe`'s, not this relay's. This route makes the runner the
**client** while the outbound fetch still originates from this relay's
Worker egress, which is exactly the measurement that was missing.

**Answer: this relay's Worker egress IS blocked.**
```
cdn.wnba.com scoreboard  upstream=200 bytes=3839 parsedGames=null <- error page
cdn.wnba.com schedule    upstream=200 bytes=3839 parsedGames=null <- error page
stats.wnba.com sbv2      HTTP 502 (timeout from the Worker)
```
Byte-identical to what `html_probe` saw. Not headers, not a stale guess —
measured through the real relay.

Written up with the architectural consequence in
`docs/CC-CMD-2026-08-09-wnba-failover-via-kv.md`.
