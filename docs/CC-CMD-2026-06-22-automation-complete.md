# CC-CMD — Full Automation Loop

git pull. Read CLAUDE.md. Run `git log --oneline -3` first.
Write findings to outbox/cc-automation-complete-2026-06-22.md.

## WHAT

Four endpoints + one MCP tool + Codex seeding + two template files.
One commit. One deploy. Closes the supervision gap permanently.

After this ships:
  - Quality degradation surfaces on the Newspaper without anyone asking
  - Sessions start from machine-assembled live state, not stale HANDOFF.md
  - CC verifies prose quality before declaring done
  - Session state is recorded automatically at close
  - All 86 rules are in the Codex

## STATE CHECK (run first, before any code)

```bash
grep -n "'/quality/report'\|'/briefs/spot-check'\|'/session/record'" src/index.js
grep -n "session_health" src/index.js
grep -n "_SPORT_NORMALIZE\|FIELD_VOICE_REGISTER" src/index.js src/context-assembler.js src/journalism-quality.js
```

Report what already exists. Skip tasks for anything already present.

---

## TASK 1: GET /quality/report

File: src/index.js — near /integrity endpoints.

```javascript
if (pathname === '/quality/report' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10) || 7, 30);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, sport,
               COUNT(*) as total,
               COUNT(quality_score) as scored,
               ROUND(AVG(quality_score), 1) as avg_score,
               MIN(quality_score) as min_score,
               MAX(quality_score) as max_score,
               SUM(CASE WHEN quality_score < 150 THEN 1 ELSE 0 END) as below_150,
               SUM(CASE WHEN quality_score >= 200 THEN 1 ELSE 0 END) as above_200
        FROM briefs WHERE date >= ?
        GROUP BY brief_type, sport
        ORDER BY avg_score ASC NULLS LAST
    `).bind(since).all();
    const summary = rows.results || [];
    const alerts = summary
        .filter(r => r.scored >= 3)
        .filter(r => r.avg_score < 170 || (r.below_150 / r.scored) > 0.3)
        .map(r => ({
            brief_type: r.brief_type, sport: r.sport || 'all',
            alert: r.avg_score < 170 ? 'avg_below_170' : 'high_failure_rate',
            avg_score: r.avg_score,
            failure_pct: Math.round((r.below_150 / r.scored) * 100),
        }));
    const unscored = summary
        .filter(r => r.total > 5 && r.scored === 0)
        .map(r => ({ brief_type: r.brief_type, sport: r.sport, total: r.total }));
    return new Response(JSON.stringify({
        ok: true, days, since, summary, alerts,
        alert_count: alerts.length,
        unscored_types: unscored,
        unscored_count: unscored.length,
    }), { headers: { ...CORS, 'Content-Type': 'application/json',
                     'Cache-Control': 'public, max-age=300' } });
}
```

---

## TASK 2: GET /briefs/spot-check

File: src/index.js — near /backfill endpoint.

```javascript
if (pathname === '/briefs/spot-check' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    const n = Math.min(parseInt(url.searchParams.get('n') || '5', 10) || 5, 20);
    const source = url.searchParams.get('source') || null;
    const briefType = url.searchParams.get('type') || null;
    let query = `SELECT id, brief_type, sport, brief_text, quality_score, source, date
                 FROM briefs WHERE brief_text IS NOT NULL`;
    const params = [];
    if (source) { query += ' AND source = ?'; params.push(source); }
    if (briefType) { query += ' AND brief_type = ?'; params.push(briefType); }
    query += ' ORDER BY date DESC, rowid DESC LIMIT ?';
    params.push(n);
    const rows = await env.ARCHIVE_DB.prepare(query).bind(...params).all();
    const briefs = rows.results || [];
    if (!briefs.length) return new Response(
        JSON.stringify({ ok: true, verdict: 'no_briefs', checked: 0 }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    const BANNED = [
        'automated ball-strike', 'abs challenge', 'challenge system',
        'stunned', 'shocked', 'thriller', 'instant classic', 'for the ages',
        "didn't disappoint", 'lived up to the hype', 'gave fans',
        'left fans', 'in a statement', 'marquee matchup',
    ];
    const CROSS_SPORT = {
        'golf': ['ppg','rebounds','assists','points per game','three-pointer','hat trick','puck'],
        'wnba': ['pitcher','home run','strikeout','hat trick','puck'],
        'FIFA World Cup 2026': ['ppg','rebounds','home run','strikeout'],
        'MLB': ['ppg','hat trick','puck','xG','golden goal'],
    };
    const results = briefs.map(b => {
        const text = (b.brief_text || '').toLowerCase();
        const flagged = BANNED.filter(p => text.includes(p));
        const crossSport = (CROSS_SPORT[b.sport] || []).filter(t => text.includes(t));
        const words = (b.brief_text || '').split(/\s+/).length;
        const pass = flagged.length === 0 && crossSport.length === 0
                     && words >= 30 && words <= 120;
        return {
            id: b.id, brief_type: b.brief_type, sport: b.sport,
            date: b.date, source: b.source, quality_score: b.quality_score,
            word_count: words, pass,
            flagged_phrases: flagged, cross_sport: crossSport,
            preview: (b.brief_text || '').slice(0, 150),
        };
    });
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    return new Response(JSON.stringify({
        ok: true,
        verdict: failed === 0 ? 'PASS' : 'FAIL',
        checked: results.length, passed, failed, results,
    }), { headers: { ...CORS, 'Content-Type': 'application/json',
                     'Cache-Control': 'no-store' } });
}
```

---

## TASK 3: POST /session/record

File: src/index.js — near /archive endpoints.

```javascript
if (pathname === '/session/record' && request.method === 'POST') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    const body = await request.json().catch(() => null);
    if (!body) return new Response(
        JSON.stringify({ ok: false, error: 'invalid json' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    const {
        client_head, relay_head, smoke, sw_version,
        session_type = 'relay', summary,
        carry_forwards = [], drive_docs = [],
    } = body;
    if (!client_head || !relay_head || !summary) return new Response(
        JSON.stringify({ ok: false, error: 'client_head, relay_head, summary required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    const date = new Date().toISOString().slice(0, 10);
    const id = `session_${date}_${relay_head}`;
    await env.ARCHIVE_DB.prepare(`
        INSERT INTO codex (key, category, title, content, drive_refs, updated_at)
        VALUES (?, 'session', ?, ?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            content = excluded.content, drive_refs = excluded.drive_refs,
            updated_at = datetime('now')
    `).bind(
        id,
        `Session ${date} — ${summary.slice(0, 80)}`,
        JSON.stringify({
            client_head, relay_head, smoke, sw_version,
            session_type, summary, carry_forwards,
            recorded_at: new Date().toISOString(),
        }),
        drive_docs.length ? JSON.stringify(drive_docs) : null
    ).run();
    const channel = session_type === 'docs' ? 'chat' : 'CC';
    const anchor = `CLIENT HEAD ${client_head} · ${date} · via ${channel}. ` +
                   `RELAY HEAD ${relay_head} · ${date} · via ${channel}.`;
    for (const cf of carry_forwards.slice(0, 10)) {
        const slug = cf.slice(0, 40).replace(/\s+/g, '-').toLowerCase()
                      .replace(/[^a-z0-9-]/g, '');
        await env.ARCHIVE_DB.prepare(`
            INSERT INTO codex (key, category, title, content, updated_at)
            VALUES (?, 'incident', ?, ?, datetime('now'))
            ON CONFLICT(key) DO NOTHING
        `).bind(`cf/${date}/${slug}`, cf.slice(0, 120), cf).run().catch(() => {});
    }
    return new Response(JSON.stringify({
        ok: true, session_id: id, anchor,
        carry_forwards_written: Math.min(carry_forwards.length, 10),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

---

## TASK 4: session_health MCP tool

File: src/index.js

Add to the tools array (~line 9011):
```javascript
{
    name: 'session_health',
    description: 'Machine-generated session health: live HEADs, deploy match, ' +
        'smoke count, quality degradation, degraded analytics phases, ' +
        'open Codex incidents. Call at session start instead of read_handoff.',
    inputSchema: { type: 'object', properties: {}, required: [] },
},
```

Add handler alongside read_handoff handler (~line 9284).
Use the existing ghHeaders() helper (already defined in that block):

```javascript
if (toolName === 'session_health') {
    const ghToken = env.GITHUB_PAT;
    const gh = (path) => fetch(
        `https://api.github.com/repos/${path}`,
        { headers: { 'Authorization': `Bearer ${ghToken}`,
                     'Accept': 'application/vnd.github+json',
                     'User-Agent': 'FIELD-relay' },
          cf: { cacheTtl: 60 } }
    );
    const out = {};

    // Client + relay HEADs
    try {
        const r = await gh('jeffunglesbee-create/jubilant-bassoon/git/refs/heads/main');
        if (r.ok) out.client_head = ((await r.json()).object?.sha || '').slice(0, 7);
    } catch(_) { out.client_head = 'unavailable'; }
    try {
        const r = await gh('jeffunglesbee-create/field-relay-nba/git/refs/heads/main');
        if (r.ok) out.relay_head = ((await r.json()).object?.sha || '').slice(0, 7);
    } catch(_) { out.relay_head = 'unavailable'; }

    // Deploy match
    try {
        const r = await gh('jeffunglesbee-create/field-relay-nba' +
            '/actions/workflows/deploy.yml/runs?status=success&per_page=1');
        if (r.ok) {
            const run = (await r.json()).workflow_runs?.[0];
            if (run) {
                out.relay_deployed = run.head_sha.slice(0, 7);
                out.deploy_match = out.relay_deployed === out.relay_head;
                out.deployed_at = run.updated_at;
            }
        }
    } catch(_) { out.deploy_match = 'unavailable'; }

    if (env.ARCHIVE_DB) {
        // Quality degradation
        try {
            const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const q = await env.ARCHIVE_DB.prepare(`
                SELECT brief_type, COUNT(*) as total, COUNT(quality_score) as scored,
                       ROUND(AVG(quality_score), 1) as avg_score
                FROM briefs WHERE date >= ? GROUP BY brief_type
            `).bind(since).all();
            const types = q.results || [];
            out.quality = {
                degraded: types.filter(r => r.scored >= 3 && r.avg_score < 170)
                               .map(r => r.brief_type),
                unscored: types.filter(r => r.total > 5 && r.scored === 0)
                               .map(r => r.brief_type),
            };
        } catch(_) { out.quality = 'unavailable'; }

        // Analytics phase status
        try {
            const today = new Date().toISOString().slice(0, 10);
            const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const p = await env.ARCHIVE_DB.prepare(`
                SELECT feature, date, JSON_EXTRACT(value, '$.degraded') as degraded
                FROM analytics_output WHERE date IN (?, ?)
                ORDER BY date DESC
            `).bind(today, yest).all();
            const phases = {};
            for (const r of (p.results || []))
                if (!phases[r.feature])
                    phases[r.feature] = { date: r.date, degraded: !!r.degraded };
            out.analytics_phases = phases;
        } catch(_) { out.analytics_phases = 'unavailable'; }

        // Open incidents from Codex
        try {
            const cf = await env.ARCHIVE_DB.prepare(`
                SELECT key, title FROM codex
                WHERE category = 'incident'
                ORDER BY updated_at DESC LIMIT 15
            `).all();
            out.open_incidents = (cf.results || []).map(r => r.title);
        } catch(_) { out.open_incidents = 'unavailable'; }
    }

    out.checked_at = new Date().toISOString();
    return respond(jsonrpc2({ content: [{ type: 'text',
        text: JSON.stringify(out, null, 2) }] }));
}
```

---

## TASK 5: Analytics cron quality alert

File: src/analytics-engine.js

After Phase 8, add a quality alert phase that writes to analytics_output
when degradation is detected. This feeds the O(1) Newspaper automatically.

```javascript
// Phase: quality_alert — surfaces degradation in the Newspaper
try {
    const yesterday = date; // 'date' is already yesterday in the cron context
    const alertRows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type,
               COUNT(*) as total,
               COUNT(quality_score) as scored,
               ROUND(AVG(quality_score), 1) as avg_score
        FROM briefs
        WHERE date >= ? AND quality_score IS NOT NULL
        GROUP BY brief_type
        HAVING COUNT(quality_score) >= 3
          AND AVG(quality_score) < 170
    `).bind(yesterday).all();
    const unscoredRows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, COUNT(*) as total
        FROM briefs WHERE date >= ? AND quality_score IS NULL
        GROUP BY brief_type HAVING COUNT(*) > 5
    `).bind(yesterday).all();
    const alerts = alertRows.results || [];
    const unscored = unscoredRows.results || [];
    if (alerts.length > 0 || unscored.length > 0) {
        await writeAnalyticsOutput(env, {
            date,
            feature: 'quality_alert',
            sport: null,
            value: { alerts, unscored, checked_at: new Date().toISOString() },
            briefText: alerts.length > 0
                ? `Quality degraded on ${alerts.length} brief type(s).`
                : `${unscored.length} brief type(s) not being scored.`,
        });
    }
} catch (_) { /* never block cron */ }
```

Also add quality_alert to the newspaper bundle in src/index.js
(/analytics/newspaper handler, ~line 8044):
```javascript
quality_alert: recap.quality_alert ? {
    ...(recap.quality_alert.value || {}),
    brief: recap.quality_alert.brief_text || null,
} : null,
```

---

## TASK 6: Update ALLOWED_PREFIX (one edit, covers all new routes)

File: src/index.js, line ~9583.

Change:
```javascript
const ALLOWED_PREFIX = ['/squiggle', '/apisports', '/context/game', '/context/date', '/analytics', '/changelog', '/freshness', '/identity', '/budget', '/integrity', '/deploy', '/backfill'];
```

To:
```javascript
const ALLOWED_PREFIX = ['/squiggle', '/apisports', '/context/game', '/context/date', '/analytics', '/changelog', '/freshness', '/identity', '/budget', '/integrity', '/deploy', '/backfill', '/quality', '/briefs', '/session'];
```

---

## TASK 7: Write template files to docs/

File: docs/CC-CMD-TEMPLATE-session-end.md

```markdown
## SESSION END (mandatory — runs after every task, before closing)

### A. Output verification (if briefs generated or modified)
SPOT=$(curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/briefs/spot-check?n=5")
VERDICT=$(echo $SPOT | python3 -c "import json,sys; print(json.load(sys.stdin).get('verdict','ERR'))")
if [ "$VERDICT" != "PASS" ] && [ "$VERDICT" != "no_briefs" ]; then
  echo "QUALITY FAIL — document in outbox, do NOT call /session/record with ok status"
  echo $SPOT | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d.get('results',[]):
    if not r['pass']:
        print(f'  FAIL: {r[\"id\"]} — {r[\"flagged_phrases\"]} {r[\"cross_sport\"]}')
        print(f'  Preview: {r[\"preview\"]}')"
fi

### B. Record session
curl -s -X POST https://field-relay-nba.jeffunglesbee.workers.dev/session/record \
  -H "Content-Type: application/json" \
  -d "{
    \"client_head\": \"$(cd ~/jubilant-bassoon && git rev-parse --short HEAD 2>/dev/null || echo unknown)\",
    \"relay_head\":  \"$(cd ~/field-relay-nba  && git rev-parse --short HEAD 2>/dev/null || echo unknown)\",
    \"session_type\": \"relay\",
    \"summary\": \"[REPLACE: one sentence describing what shipped]\",
    \"carry_forwards\": [\"[REPLACE: any items not completed]\"],
    \"drive_docs\": []
  }"

### C. write_handoff via MCP
# Use the anchor string returned by /session/record above.

### D. codex_write for each feature touched (3-5 entries minimum)
```

---

## TASK 8: Seed Codex with all CLAUDE.md rules

After deploy, use the codex_write MCP tool to write all rules from CLAUDE.md.

Read CLAUDE.md fully. For every numbered rule, write one entry:
  key: "rule/{N}" (e.g. "rule/68")
  category: "decision"
  title: "Rule {N}: {rule name or first 80 chars}"
  content: {full rule text}

Write all rules in a single pass. Do not stop at 10.
This is ~86 entries. Take as many MCP calls as needed.

---

## SCOPE

DO:
- Tasks 1-8 above
- All relay-only (src/index.js, src/analytics-engine.js, docs/)
- ALLOWED_PREFIX updated once covering all new routes

DO NOT:
- Touch client repo
- Modify brief generation paths
- Modify runQualityChain or FIELD_PROSE_STYLE
- Add new D1 tables (reuse codex table for session records)

---

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md. STATE CHECK first.
3. Tasks 1-6 (code changes to src/).
4. Task 7 (template files to docs/).
5. node --check src/index.js && node --check src/analytics-engine.js
6. Single commit: "feat: automation loop — quality/report, spot-check,
   session/record, session_health, cron quality alert, SESSION-END template"
7. wrangler deploy
8. Verify all four endpoints:
   curl /quality/report?days=7         → unscored_count > 0
   curl /briefs/spot-check?n=5         → FAIL (existing bad briefs)
   POST /session/record {test payload} → { ok: true, anchor: "..." }
   session_health (MCP)                → all fields populated
9. Task 8: Codex seeding (86 rule entries via MCP).
10. Outbox manifest.
11. /session/record with this session's real data.
12. write_handoff via MCP with updated RELAY HEAD.
