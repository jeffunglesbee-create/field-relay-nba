# CC-CMD AUTO-2: Machine-generated session health summary

git pull. Read CLAUDE.md. Run `git log --oneline -3` first.
Write findings to outbox/cc-auto-2-health-summary-2026-06-22.md.

## WHAT

read_handoff currently returns raw HANDOFF.md content — a human-written
document that goes stale. Add a companion MCP tool (session_health) that
returns machine-assembled current state from live sources: actual HEADs,
smoke count, deploy verify, quality degradation, analytics phase status,
pending carry-forwards from D1.

Sessions start by calling session_health, not reading a stale document.

## STATE CHECK

```bash
grep -n 'session_health\|sessionHealth' src/index.js
grep -n 'get_smoke_count\|smoke_count' src/index.js | head -5
grep -n 'get_deploy_status\|deployStatus' src/index.js | head -5
```

Report what already exists. Build only what's missing.

## TASK 1: session_health MCP tool

File: src/index.js — add to the MCP tools section alongside read_handoff.

Add to tools list (~line 9011):
```javascript
{
    name: 'session_health',
    description: 'Returns machine-generated session health summary: ' +
        'current HEADs, smoke count, deploy/verify match, ' +
        'quality degradation alerts, analytics phase status, ' +
        'pending carry-forwards from Codex. Call this at session start ' +
        'instead of reading a potentially stale HANDOFF.md.',
    inputSchema: { type: 'object', properties: {}, required: [] },
},
```

Add handler (~line 9284, alongside read_handoff handler):
```javascript
if (toolName === 'session_health') {
    const ghToken = env.GITHUB_PAT;
    const results = {};

    // 1. Client HEAD (jubilant-bassoon main)
    try {
        const r = await fetch(
            'https://api.github.com/repos/jeffunglesbee-create/jubilant-bassoon/git/refs/heads/main',
            { headers: ghHeaders(ghToken) }
        );
        if (r.ok) {
            const j = await r.json();
            results.client_head = (j.object?.sha || '').slice(0, 7);
        }
    } catch(_) { results.client_head = 'unavailable'; }

    // 2. Relay HEAD
    try {
        const r = await fetch(
            'https://api.github.com/repos/jeffunglesbee-create/field-relay-nba/git/refs/heads/main',
            { headers: ghHeaders(ghToken) }
        );
        if (r.ok) {
            const j = await r.json();
            results.relay_head = (j.object?.sha || '').slice(0, 7);
        }
    } catch(_) { results.relay_head = 'unavailable'; }

    // 3. Relay deployed SHA (from /deploy/verify logic)
    try {
        const runRes = await fetch(
            'https://api.github.com/repos/jeffunglesbee-create/field-relay-nba' +
            '/actions/workflows/deploy.yml/runs?status=success&per_page=1',
            { headers: ghHeaders(ghToken) }
        );
        if (runRes.ok) {
            const j = await runRes.json();
            const run = j.workflow_runs?.[0];
            if (run) {
                results.relay_deployed = (run.head_sha || '').slice(0, 7);
                results.deploy_match = results.relay_deployed === results.relay_head;
                results.deployed_at = run.updated_at;
            }
        }
    } catch(_) { results.deploy_match = 'unavailable'; }

    // 4. Smoke count (from jubilant-bassoon)
    try {
        const r = await fetch(
            'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/smoke.js',
            { cf: { cacheTtl: 300 } }
        );
        if (r.ok) {
            const txt = await r.text();
            const assertions = (txt.match(/^assert\(/gm) || []).length;
            results.smoke_assertions = assertions;
        }
    } catch(_) { results.smoke_assertions = 'unavailable'; }

    // 5. Quality degradation (from D1)
    if (env.ARCHIVE_DB) {
        try {
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const qRows = await env.ARCHIVE_DB.prepare(`
                SELECT brief_type, COUNT(*) as total, COUNT(quality_score) as scored,
                       ROUND(AVG(quality_score), 1) as avg_score
                FROM briefs WHERE date >= ? GROUP BY brief_type
            `).bind(yesterday).all();

            const types = qRows.results || [];
            const degraded = types.filter(r =>
                r.scored >= 3 && r.avg_score < 170
            );
            const unscored = types.filter(r =>
                r.total > 5 && r.scored === 0
            );
            results.quality = {
                brief_types: types.length,
                degraded_count: degraded.length,
                unscored_count: unscored.length,
                degraded: degraded.map(r => r.brief_type),
                unscored: unscored.map(r => r.brief_type),
            };
        } catch(_) { results.quality = 'unavailable'; }

        // 6. Analytics phase status (from analytics_output)
        try {
            const today = new Date().toISOString().slice(0, 10);
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const phases = await env.ARCHIVE_DB.prepare(`
                SELECT feature, date,
                       JSON_EXTRACT(value, '$.degraded') as degraded
                FROM analytics_output
                WHERE date IN (?, ?)
                ORDER BY date DESC
            `).bind(today, yesterday).all();

            const phaseMap = {};
            for (const row of (phases.results || [])) {
                if (!phaseMap[row.feature]) {
                    phaseMap[row.feature] = {
                        date: row.date,
                        degraded: !!row.degraded,
                    };
                }
            }
            results.analytics_phases = phaseMap;
        } catch(_) { results.analytics_phases = 'unavailable'; }

        // 7. Open carry-forwards from Codex
        try {
            const cf = await env.ARCHIVE_DB.prepare(`
                SELECT key, title, substr(content, 1, 200) as preview
                FROM codex
                WHERE category = 'incident'
                ORDER BY updated_at DESC
                LIMIT 10
            `).all();
            results.open_incidents = (cf.results || []).map(r => ({
                key: r.key, title: r.title,
            }));
        } catch(_) { results.open_incidents = 'unavailable'; }
    }

    results.checked_at = new Date().toISOString();

    return respond(jsonrpc2({ content: [{ type: 'text',
        text: JSON.stringify(results, null, 2) }] }));
}
```

Note: `ghHeaders(ghToken)` helper is already defined near the top of the
MCP handler block. Use the existing pattern from read_handoff.

## TASK 2: Add to probe_relay_route allowlist

'/health' is already in the allowlist implicitly (it's in ALLOWED_EXACT
or the path is short enough). The session_health tool is MCP-only (not HTTP).
No allowlist change needed.

## SESSION END

1. node --check src/index.js
2. Single commit: "feat: session_health MCP tool — machine-generated start state"
3. wrangler deploy
4. After deploy: call session_health via MCP and verify all fields populate.
   Confirm relay_head matches git log --oneline -1 output.
   Confirm quality.unscored_count > 0 (proving the gap is visible).
5. Write outbox manifest
6. write_handoff via MCP with updated RELAY HEAD
7. codex_write: key="mcp/session-health", category="decision",
   title="session_health MCP tool — replaces stale HANDOFF reads at session start"
