# Claude Code Command — TEMP fetch-proxy route to download GumTree without Gradle/Maven egress

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** one new, narrowly-scoped, auth-gated, explicitly temporary route. Not a general-purpose proxy — domain-allowlisted to GitHub only.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/temp-gumtree-proxy-2026-07-13.md.

## CONTEXT — the real blocker and why this specific approach

Neither chat's sandbox nor Claude Code's own sandbox can reach github release assets / Maven Central reliably for this purpose (egress differs by environment, do not assume this session's egress rules apply to a live Cloudflare Worker). A deployed Cloudflare Worker's `fetch()` runs on Cloudflare's own edge network, not in either sandbox — a genuinely separate execution context, already proven reachable and working for this repo's existing ESPN/MLB fetches. This route lets the *deployed worker* do the actual download; chat then pulls the bytes back through `field-relay-nba.jeffunglesbee.workers.dev`, which is already in chat's allowed domains.

The goal: fetch GumTree's v4.0.0-beta6 release ZIP (or the specific jar assets, whichever is smaller) from `github.com/GumTreeDiff/gumtree/releases`, proxied through this route, so chat can download it directly afterward without needing Gradle or Maven Central reachability at all — a pre-built distribution needs no build step.

## TASK 0 — Probe

```bash
grep -n "Authorization: Bearer" src/index.js | grep -i admin | head -3
grep -n "FIELD_MCP_SECRET" src/index.js | head -3
```

Confirm the exact existing `/admin/*` auth pattern before writing a new route — match it exactly, do not invent a new auth scheme.

## TASK 1 — Add the route

`GET /admin/fetch-proxy?url=<encoded-url>` — same `Authorization: Bearer ${env.FIELD_MCP_SECRET}` gate as other `/admin/*` routes.

Requirements:
- **Domain allowlist, hard-coded, not configurable via the request**: only `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, `codeload.github.com`. Reject (400) any other host before fetching — this is the SSRF guard, not optional.
- Streams the response body back with the origin's `Content-Type` and `Content-Length` preserved where present.
- Real error handling: upstream fetch failure returns a clear JSON error, not a silent empty body.
- Comment clearly marking this as **TEMPORARY** — `// TEMP-GUMTREE-PROXY-2026-07-13: remove after GumTree evaluation is complete, see docs/CC-CMD-2026-07-13-gumtree-proxy.md`.

## TASK 2 — Verify live, not just deployed

- Deploy.
- From within this CC session (or via a documented curl the outbox shows verbatim), call the route with a real GitHub release asset URL for GumTree v4.0.0-beta6 and confirm real bytes come back matching the expected file size (cross-check against the size shown on the GitHub releases page).
- Confirm the domain allowlist actually rejects a non-GitHub URL with 400, not a silent pass-through — a real forced test, not just code review.
- Confirm the route requires the auth header — a request with no/wrong `Authorization` gets 401, not the file.

## DONE CONDITION

Route live, auth-gated, domain-allowlisted, verified via real forced tests (success case + rejected-domain case + missing-auth case), clearly marked temporary in both code comment and outbox. Real GumTree release bytes successfully proxied end-to-end at least once, confirmed by size match against the real GitHub release.

**Confidence scoring:**
- TASK 0 confirms the real existing auth pattern, matches it exactly (15 pts)
- TASK 1 correct route, domain allowlist is a hard reject not a soft warning, clearly marked temporary (40 pts)
- TASK 2 all three forced tests real and passing (success, rejected-domain, missing-auth) (45 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
