# CC-CMD: Circadian KV read endpoint

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** Add a read path for the two orphaned circadian KV keys; no changes to existing write paths.
**Why:** `field:circadian:preview:{date}` and `field:circadian:late:{date}` are written on every analytics cron run (analytics-engine.js, runPhase10/runPhase10BLate) but have ZERO readers anywhere in the codebase — confirmed by grepping every `FIELD_JOURNALISM.get` call site. This was originally mis-filed as "KV not consulted by newspaper endpoint," but the newspaper endpoint was never supposed to read these — it already gets equivalent content from `analytics_output` (D1). The real, documented consumer is the client's Circadian Layout Rules (C1-C5, docs/VIEWPORT-V4-SPEC.md), which were explicitly deferred as "separate spec" in CC-CMD-2026-06-22-newspaper-client.md and never built. This CC-CMD builds the relay half of that missing link: a fast, purpose-built read path so a future client-side phase detector can fetch exactly the content for its current circadian phase without pulling the full newspaper bundle (4 D1 queries) just to read one field.
**Target time:** ~30 min (two small route additions, no new infra)

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress (CC cannot curl the live URL directly — use the CI-as-proxy pattern or ask chat to verify post-deploy)
- api.github.com is reachable from CC bash
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail
- node --check src/index.js before any commit

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## CONTEXT — WHAT ALREADY EXISTS (verified, not assumed)
- `analytics-engine.js` writes `field:circadian:preview:{date}` at 3 call sites (off-night fallback, budget-capped fallback, real AI-generated preview) and `field:circadian:late:{date}` at 1 call site (reuses morning_report prose, zero extra AI cost).
- Both keys use `CIRCADIAN_KV_TTL_SECS` as expiration — confirm this constant's value before writing the fallback logic below (if TTL is short, e.g. <24h, the D1 fallback path matters more).
- The exact same content is ALSO written to `analytics_output` (D1) under `feature='circadian_preview'` / `feature='circadian_late'` in the same functions — this is why the newspaper endpoint already works today. Do not touch this D1 write path.
- No relay route currently reads either KV key. Confirmed via `grep -n "FIELD_JOURNALISM.get" src/index.js` — zero hits mentioning circadian.

## PROBE BLOCK (run before any edits)
```bash
# P1 — confirm the KV keys are actually populated right now (today's date, ET)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/health" | grep -q ok && echo "relay reachable"

# P2 — confirm CIRCADIAN_KV_TTL_SECS value (grep, not assumed)
grep -n "CIRCADIAN_KV_TTL_SECS" src/analytics-engine.js

# P3 — confirm no existing /circadian route (avoid collision)
grep -n "'/circadian" src/index.js || echo "no existing route — clear to add"
```
If P3 finds an existing route, STOP and report — do not silently overwrite.

## TASK 1 — Add GET /circadian/:phase/:date route

Insert near the other simple KV-read routes in `src/index.js` (search for an existing single-key KV GET route as the insertion-pattern anchor, e.g. one of the `cacheKey` read sites found via the AVV proof doc's known pattern).

```javascript
// GET /circadian/:phase/:date — fast KV-first read for client circadian-phase
// rendering. :phase is 'preview' or 'late'. Falls back to D1 analytics_output
// if the KV key has expired (TTL) but the D1 row still exists, so the
// endpoint degrades gracefully rather than 404ing on a cache miss.
if (pathname.startsWith('/circadian/')) {
    const parts = pathname.split('/').filter(Boolean); // ['circadian', phase, date]
    const phase = parts[1];
    const date = parts[2];
    if (!['preview', 'late'].includes(phase)) {
        return new Response(JSON.stringify({ ok: false, error: "phase must be 'preview' or 'late'" }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid date — expected YYYY-MM-DD' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        const kvKey = `field:circadian:${phase}:${date}`;
        let text = env.FIELD_JOURNALISM ? await env.FIELD_JOURNALISM.get(kvKey) : null;
        let source = 'kv';
        if (!text && env.ARCHIVE_DB) {
            // KV expired or missing — fall back to the D1 row written by
            // the same analytics-engine.js function, same session.
            const row = await env.ARCHIVE_DB.prepare(
                `SELECT brief_text FROM analytics_output WHERE feature = ? AND date = ? LIMIT 1`
            ).bind(`circadian_${phase}`, date).first();
            text = row?.brief_text || null;
            source = text ? 'd1-fallback' : null;
        }
        return new Response(JSON.stringify({ ok: !!text, text: text || null, source, phase, date }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

Place this route BEFORE any generic catch-all that might otherwise match `/circadian/*` — verify via P3 above that no such collision exists; if the relay has a generic prefix router, confirm ordering explicitly.

## TASK 2 — Smoke/health note (no new client-facing smoke — relay has no smoke.js; verify via live probe only, per Phase 3 done conditions below)

## DONE CONDITIONS
- [ ] P1-P3 probes run and pass/reported before any edit
- [ ] `node --check src/index.js` clean
- [ ] Commit pushed, deploy.yml green, `/deploy/verify` shows deploy_match:true
- [ ] `GET /circadian/preview/{today's date}` → HTTP 200, `ok:true`, `source:"kv"` (or `"d1-fallback"` if TTL expired — both acceptable, report which)
- [ ] `GET /circadian/late/{today's date}` → same check
- [ ] `GET /circadian/bogus/{date}` → HTTP 400 (phase validation works)
- [ ] `GET /circadian/preview/not-a-date` → HTTP 400 (date validation works)
- [ ] `/health` still returns OK (no collateral breakage)
- [ ] Outbox manifest written to `docs/outbox/cc-circadian-kv-read-{date}.md`

## COMPLIANCE
- Rule 5: all KV/D1 operations in try/catch, errors return ok:false not throw
- Rule 7: single-concern commit — one route, one file
- Rule 47/ADR-002: returns prose text only, no drama scores, no computed interest values (this endpoint returns pre-written editorial prose, RUWT-clean by construction)
- Rule 68: probe block must run and pass before any edits
- Rule 87: self-completing — done conditions checkable in-session

## OUTBOX MANIFEST (checklist of every output item)
- [ ] Route added to src/index.js
- [ ] Live probe results (all 4 cases: preview-ok, late-ok, bad-phase-400, bad-date-400) pasted verbatim into outbox doc
- [ ] Deploy commit SHA recorded
- [ ] Explicit note: this closes the relay half of the "KV editorial keys not consulted" finding — client half is a SEPARATE CC-CMD (CC-CMD-2026-07-04-circadian-client-phase.md, jubilant-bassoon repo) and has a hard dependency on this route being deployed first

## CONFIDENCE SCORING TABLE
+30  Route deployed, /deploy/verify shows deploy_match:true
+30  Both phase reads (preview, late) return ok:true with real text for today's date
+20  Both validation cases (bad phase, bad date) return 400 as specified
+20  D1-fallback path verified to work (temporarily expire/skip KV read in a test call, or reason from TTL value found in P2 — state which method was used)

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-circadian-kv-read-endpoint.md. Add the /circadian/:phase/:date route exactly as specified. Do not commit unless confidence ≥ 95. If score < 95 report verbatim and stop — do not invent results.
