# CC-CMD: Circadian KV read endpoint (REVISED — real consumer confirmed)

**Date:** 2026-07-04 (revised same day — see REVISION NOTE)
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** Add a read path for the two orphaned circadian KV keys. Endpoint design unchanged from the original version of this CC-CMD — only the stated purpose/consumer has been corrected.

## REVISION NOTE (read this first)
This CC-CMD was originally written believing the consumer would be a
client-side Circadian Layout UI system. That was wrong — the real,
authoritative Circadian System spec (per-game, June 20-21 2026) doesn't
need KV at all; it reads `game.state` directly. That original version was
retracted.

The endpoint design itself was always sound. It now has a real, verified
consumer: **dynamic OG share-card meta tags** (CC-CMD-2026-07-04-og-share-meta.md,
jubilant-bassoon repo). Confirmed 2026-07-04: FIELD has zero Open Graph
meta tags anywhere, and a June 13 2026 session already flagged this as
"the #1 organic growth mechanism for a sports app" — still unbuilt. Social
crawlers (Twitterbot, Slackbot, etc.) need fast, low-latency text with no
session — exactly what a KV-first read (vs. the newspaper's multi-query D1
bundle) is good for. This is the CC-CMD that actually closes the original
"KV editorial keys not consulted by anything" incident.

**Why:** `field:circadian:preview:{date}` and `field:circadian:late:{date}`
are written on every analytics cron run (analytics-engine.js) but have
zero readers anywhere — confirmed by grepping every `FIELD_JOURNALISM.get`
call site in the relay. This route gives them a real reader.
**Target time:** ~30 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress
- api.github.com is reachable from CC bash
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail
- node --check src/index.js before any commit

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK (run before any edits)
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/health" | grep -q ok && echo "relay reachable"
grep -n "CIRCADIAN_KV_TTL_SECS" src/analytics-engine.js
grep -n "'/circadian" src/index.js || echo "no existing route — clear to add"
```
If the last command finds an existing route, STOP and report.

## TASK 1 — Add GET /circadian/:phase/:date route

```javascript
// GET /circadian/:phase/:date — fast KV-first read. Real consumer:
// jubilant-bassoon's OG share-meta Worker script (CC-CMD-2026-07-04-
// og-share-meta.md), which needs low-latency text for crawler requests
// with no session. Falls back to D1 analytics_output if KV TTL expired.
if (pathname.startsWith('/circadian/')) {
    const parts = pathname.split('/').filter(Boolean);
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
Place before any generic catch-all matching `/circadian/*`.

## DONE CONDITIONS
- [ ] Probes pass before any edit
- [ ] `node --check src/index.js` clean
- [ ] Deploy green, `/deploy/verify` shows deploy_match:true
- [ ] `GET /circadian/preview/{today}` → 200, ok:true, source stated
- [ ] `GET /circadian/late/{today}` → same check
- [ ] `GET /circadian/bogus/{date}` → 400
- [ ] `GET /circadian/preview/not-a-date` → 400
- [ ] `/health` still OK
- [ ] Outbox manifest written

## COMPLIANCE
- Rule 5: try/catch, ok:false not throw
- Rule 7: single-concern commit
- Rule 47/ADR-002: prose text only, RUWT-clean
- Rule 68: probe block first
- Rule 87: self-completing

## CONFIDENCE SCORING TABLE
+30  Route deployed, deploy_match:true
+30  Both phase reads return ok:true with real text for today
+20  Both validation cases return 400
+20  D1-fallback path verified or reasoned through via TTL value

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-circadian-kv-read-endpoint-REVISED.md.
Add the /circadian/:phase/:date route exactly as specified. Do not commit
unless confidence ≥ 95. If score < 95 report verbatim and stop.
