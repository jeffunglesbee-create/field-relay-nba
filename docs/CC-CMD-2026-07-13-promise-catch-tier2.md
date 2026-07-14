# Claude Code Command — Repo-wide promise-chain catches, Tier 2: response-parse, direct-fetch, and misc sites

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** every genuinely-empty `.catch(callback)` site NOT touching `env.ARCHIVE_DB` or `env.FIELD_JOURNALISM` — response-body `.json()` parses, direct `fetch()` calls, and a small number of miscellaneous sites (a push-notification send, a projections computation). The D1/KV sites are Tier 1, a separate CC-CMD, higher risk — do not merge scope. If TASK 0 here finds a site that touches ARCHIVE_DB/FIELD_JOURNALISM, it belongs in Tier 1, not here — flag and skip it, do not fix it in this CC-CMD.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/promise-catch-tier2-2026-07-13.md. Commit the outbox manifest with `[skip ci]` in the message — it's a docs-only addition after the real fix commits are already in and deployed, same convention as this repo's other outbox writes; do not let it re-trigger CI.

## CONTEXT

See Tier 1's CC-CMD for the full background on why this category exists and how it was found (`scripts/audit-empty-catches.py`, committed tonight). This Tier is lower risk by pattern: `resp.json().catch(() => null)`-shaped sites are parsing an already-fetched response body, and a parse failure here typically degrades to "treat as no data" rather than triggering a duplicate write the way a dedup-check read failure does. That said — **do not assume every site in this Tier is automatically safe.** Read each one's surrounding code. A `request.json().catch(() => null)` on an incoming POST body, for example, could have very different consequences from a `resp.json().catch(() => null)` on an outbound fetch's response — one might silently accept a malformed request as if it were a valid empty one. Classify each site on its own merits, same discipline as Tier 1, just don't assume the answer going in.

Also in scope: 2 `env.FIELD_JOURNALISM.put(...).catch(...)` sites (a silent *write* failure, not a read — worth noting explicitly in the outbox whether losing that specific write silently has any real consequence, e.g. if nothing else ever re-attempts it), 2 direct `fetch()` calls for competitor statistics, and 3 misc sites (`sendWebPush(...).catch(() => null)`, and `runWCTournamentProjections(env).catch(() => {})` appearing twice).

## TASK 0 — Probe

```bash
pip install tree-sitter tree-sitter-javascript --break-system-packages -q
python3 scripts/audit-empty-catches.py src/index.js > /tmp/full_audit.txt
grep -A100 "promise chains:" /tmp/full_audit.txt | grep -v "ARCHIVE_DB\|FIELD_JOURNALISM.get\b"
```

Real, current, authoritative list — confirm fresh, do not reuse this doc's approximate counts. For each site, read the enclosing function before classifying. Note explicitly which of the two `FIELD_JOURNALISM.put()` sites (if still present) are genuinely fire-and-forget vs. whether anything downstream assumes the write succeeded.

## TASK 1 — Fix each site on its own merits

Expected default for most of this Tier: `console.error("[TAG] message:", e.message)` added, swallow behavior preserved, matching this file's established per-section tag convention. But if TASK 0's per-site read surfaces a real behavioral risk (a request-body parse failure being silently treated as valid-but-empty, a write failure that nothing ever retries, etc.), apply a real fix for that site the same way Tier 1's spec describes — do not force every site into the telemetry-only bucket by default.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Live check: hit at least one real endpoint downstream of the fixed sites post-deploy, confirm real content, not just 200.
- Re-run `scripts/audit-empty-catches.py`: this Tier's sites must show 0 empty.

## DONE CONDITION

Every site in this Tier individually read and classified. Re-running the audit script shows 0 empty in this Tier. Any site given a real (non-telemetry-only) fix has that reasoning stated in the outbox. Live-verified post-deploy.

**Confidence scoring:**
- TASK 0 gets the real current site list, reads context per site (20 pts)
- TASK 1 correct classification per site, real fixes where actually warranted rather than uniform logging (40 pts)
- TASK 2 live check + re-run audit confirms 0 empty in this Tier (40 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
