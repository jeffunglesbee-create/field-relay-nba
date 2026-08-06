# CC-CMD-2026-08-06-relay-web-fetch-proxy

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Explicitly approved by Jeff** (2026-08-06) as a new relay capability
class — this is not unilateral.

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-06-relay-web-fetch-proxy.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists, precisely

This relay already proxies the open internet twice — ESPN summary and
Datamuse — and Cloudflare Workers have unrestricted outbound egress by
design (confirmed repeatedly this session: it's why this relay's own
CI-based probes bypass domain-allowlist blocks that this chat's own
sandbox hits). The precedent already exists; this generalizes it into
one real, scoped, reusable route rather than a new bespoke proxy every
time a new domain comes up.

**RUWT reasoning, stated explicitly, per this repo's own governance
discipline:** a fetch proxy computes nothing — it's pure data
transport, structurally identical to the existing ESPN/Datamuse
proxies. Rule 47 restricts relay-side *intelligence* (drama scoring,
watch verdicts, interest classification) staying client-only; it does
not restrict bytes passing through the relay. This capability is the
second kind, not the first, and the existing RUWT baseline audit
already covers this class without flagging it.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Read the real, current ESPN summary and Datamuse proxy
  implementations in full first — match this new route's structure,
  error handling, and response shape to the existing convention rather
  than inventing a new one.
- Check for any existing rate-limiting mechanism in this repo to reuse
  — do not build a second, parallel one if a real pattern already
  exists.

## Task 2 — The route, scoped narrowly and defensively

Add `GET /web-fetch?url=<encoded-url>`:

- **Block SSRF targets explicitly, before ever making the request:**
  private/internal IP ranges (10.0.0.0/8, 172.16.0.0/12,
  192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, and IPv6 equivalents
  including `::1` and `fc00::/7`), this relay's own domain(s)
  (`field-relay-nba.jeffunglesbee.workers.dev` and any other
  internal/admin routes), and any known cloud-metadata endpoint
  (e.g. `169.254.169.254`). Resolve the hostname and check the real
  resolved IP, not just the string — a hostname can resolve to a
  private IP even if the string itself looks public.
- **Only `http://`/`https://` schemes** — explicitly reject
  `file://`, `ftp://`, `data:`, or anything else.
- **Real response size cap** — pick a concrete, reasoned limit (state
  the real number and why), abort the fetch if exceeded rather than
  buffering unbounded.
- **Text-extraction, not raw pass-through** — mirror the ESPN proxy's
  own pattern (structured, not a raw HTML/script dump back to the
  caller). Use a real, existing HTML-to-text approach if one already
  exists in this repo's dependencies; state clearly if a new
  dependency is genuinely required and why.
- **Real timeout** (a few seconds, matching this repo's existing
  fetch-timeout convention — check and reuse, don't invent a new
  number).

## Task 3 — Cost and abuse bounds

- Real rate limiting per caller (reuse Task 1's finding, or add a
  minimal one if genuinely none exists — state which).
- A short, reasoned cache TTL (e.g. 5–15 minutes) for identical URLs
  within that window, to avoid redundant fetches — state the real
  number and reasoning, don't pick one arbitrarily.
- Log real usage (URL, caller context if available, response size) so
  abuse or runaway cost is visible after the fact, matching this
  repo's existing logging conventions.

## Task 4 — Smoke + real verification

- Real verification: fetch a real, known-public URL through the new
  route and confirm real, sensible extracted text comes back.
- Real negative tests: confirm a private-IP target, a non-http(s)
  scheme, and this relay's own domain are all genuinely rejected with
  clear errors, not silently proxied.
- Confirm this repo's real quality gate passes.

---

## Explicitly NOT in scope

- Do not expose this route without the SSRF/scheme/size guards fully
  in place — no "ship now, harden later."
- Do not use this for anything requiring authentication or cookies —
  public, unauthenticated fetches only.

---

## Outbox

`outbox/cc-session-2026-08-06-relay-web-fetch-proxy.md`: the real
route shipped, the real guard values chosen and why, and real evidence
of both a successful fetch and each rejected negative case.
