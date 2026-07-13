# Claude Code Command — Add /mlb-stats to probe_relay_route's ALLOWED_PREFIX

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** one entry in ALLOWED_PREFIX, inside the probe_relay_route MCP tool handler. Separate from and unrelated to MLB_STATS_API_ALLOWED_PREFIXES (the data-proxy allowlist, already extended earlier tonight for the same underlying need).

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/probe-allowlist-fix-2026-07-13.md.

## CONTEXT — real, confirmed gap, hit live tonight

The FIELD Handoff MCP server IS the field-relay-nba Worker (same deployed process, confirmed this session). Its `probe_relay_route` tool (self-fetch on the worker's own origin, lets a sandboxed CC session verify a route without a CI bounce) has its own hardcoded `ALLOWED_PREFIX` array, separate from `MLB_STATS_API_ALLOWED_PREFIXES` (the data-proxy allowlist for the actual `/mlb-stats/*` → statsapi.mlb.com proxy, which already includes `/homeRunDerby/` as of tonight's earlier fix).

A live CC session hit this directly tonight: blocked from a real sandbox curl (403, connect_rejected — CC's sandbox has a more restricted egress policy than this repo's other tools), it correctly tried `probe_relay_route` as the documented fallback — and got rejected because `/mlb-stats` isn't in `ALLOWED_PREFIX` either. Confirmed directly in current source (`src/index.js`):

```js
const ALLOWED_PREFIX = ['/squiggle', '/context/game', '/context/date', '/analytics', '/changelog', '/freshness', '/identity', '/budget', '/integrity', '/deploy', '/backfill', '/quality', '/briefs', '/session', '/health', '/odds-story', '/soccer', '/espn-summary', '/journalism', '/bsd', '/fifa-rankings', '/circadian', '/wiki'];
```

`/mlb-stats` belongs here (prefix-matched, since real routes carry a dynamic segment — `/mlb-stats/homeRunDerby/{gamePk}`, `/mlb-stats/people/{id}/stats`, `/mlb-stats/game/{gamePk}/boxscore`), the same reasoning as the existing `/context/game`/`/context/date` entries.

**This is genuinely a hygiene fix, not urgent** — tonight's specific blocker was already unblocked another way (chat fetched the real response directly and committed it to `docs/hrd-api-response-reference-2026-07-13.json` for the waiting CC session to read). This CC-CMD prevents the same blocker recurring for any future MLB-Stats-related CC-CMD.

## TASK 0 — Probe

Confirm `ALLOWED_PREFIX`'s real current content and exact line fresh — don't trust this doc's snapshot. Confirm this array is genuinely separate from `MLB_STATS_API_ALLOWED_PREFIXES` (different array, different purpose — one gates the MCP self-probe tool, the other gates the actual data-proxy route) so this fix doesn't accidentally touch the wrong one.

## TASK 1 — Add the entry

One line: `'/mlb-stats'` added to `ALLOWED_PREFIX`. Zero other changes to that array or the surrounding tool handler.

## TASK 2 — Verify

Real test: call `probe_relay_route` (or the equivalent direct check available to this CC session) with `route: "/mlb-stats/homeRunDerby/839032"` and confirm it now returns real data instead of an allow-list rejection. Confirm a route NOT in either allowlist (e.g. something under `/mcp` or another genuinely forbidden prefix) still correctly rejects — this change must not weaken the FORBIDDEN_PREFIX check.

## DONE CONDITION

`probe_relay_route` can genuinely reach `/mlb-stats/*` routes. `FORBIDDEN_PREFIX` and all other `ALLOWED_PREFIX`/`ALLOWED_EXACT` entries unaffected.

**Confidence scoring:**
- TASK 0 confirms real current array content, correctly distinguishes it from MLB_STATS_API_ALLOWED_PREFIXES (30 pts)
- TASK 1 correct, minimal, one line (30 pts)
- TASK 2 real verification the new route works AND forbidden routes still correctly reject (40 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
