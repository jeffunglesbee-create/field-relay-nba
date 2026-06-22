# Claude Code Command — Automated Quality Feedback Loop (3 of 3)

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-quality-auto-feedback-2026-06-22.md.

## CONTEXT

After prompts 1 and 2 ship:
- All briefs use v4 voice register (FIELD_VOICE_REGISTER)
- All briefs have quality_score in D1
- /quality/report surfaces degradation alerts
- Analytics cron writes quality_feedback to analytics_output

This prompt closes the loop: when quality degrades, the system
automatically identifies the pattern and updates the voice rules.

## TASK 1: GET /quality/diagnose endpoint

When /quality/report shows alerts, /quality/diagnose reads the
low-scoring briefs and identifies common failure patterns.

```javascript
if (pathname === '/quality/diagnose' && request.method === 'GET') {
    const days = parseInt(url.searchParams.get('days') || '3', 10);
    const since = new Date(Date.now() - days * 86400000)
        .toISOString().slice(0, 10);
    const threshold = parseInt(url.searchParams.get('threshold') || '170', 10);

    // 1. Get low-scoring briefs
    const lowBriefs = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, sport, brief_text, quality_score, date
        FROM briefs
        WHERE date >= ? AND quality_score IS NOT NULL
          AND quality_score < ?
        ORDER BY quality_score ASC
        LIMIT 20
    `).bind(since, threshold).all();

    if (!lowBriefs.results?.length) {
        return new Response(JSON.stringify({
            ok: true, diagnosis: 'no_degradation',
            message: 'No briefs below threshold in window',
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // 2. Get high-scoring briefs for comparison
    const highBriefs = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, sport, brief_text, quality_score, date
        FROM briefs
        WHERE date >= ? AND quality_score IS NOT NULL
          AND quality_score >= 200
        ORDER BY quality_score DESC
        LIMIT 10
    `).bind(since).all();

    // 3. Ask the LLM to diagnose the pattern
    const diagPrompt = `You are a journalism quality auditor for FIELD, a sports intelligence app.

FIELD's voice register: warm, wise, uplifting, cheeky, wry.
FIELD's anti-patterns: wire copy, cliché, generic leads, stat-dumping.

Below are LOW-SCORING briefs (quality < ${threshold}) and HIGH-SCORING
briefs (quality >= 200) from the last ${days} days.

LOW-SCORING BRIEFS:
${lowBriefs.results.map((b, i) =>
    `[${i+1}] (score: ${b.quality_score}, ${b.brief_type}, ${b.sport})\n${b.brief_text}`
).join('\n\n')}

HIGH-SCORING BRIEFS:
${(highBriefs.results || []).map((b, i) =>
    `[${i+1}] (score: ${b.quality_score}, ${b.brief_type}, ${b.sport})\n${b.brief_text}`
).join('\n\n')}

Diagnose the SPECIFIC failure patterns in the low-scoring briefs.
Return ONLY valid JSON with this structure:
{
  "patterns": [
    {
      "pattern": "short description of the failure",
      "frequency": number of low briefs exhibiting this,
      "example_phrase": "exact phrase from a low brief",
      "fix": "specific prompt rule to add or tighten"
    }
  ],
  "new_banned_phrases": ["phrases to add to BANNED_PHRASES"],
  "voice_drift": "description of how the voice has drifted from register",
  "recommended_actions": ["action 1", "action 2"]
}`;

    const diagResponse = await callProxy(diagPrompt);
    let diagnosis = null;
    try {
        const cleaned = diagResponse
            .replace(/```json/g, '').replace(/```/g, '').trim();
        diagnosis = JSON.parse(cleaned);
    } catch (_) {
        diagnosis = { raw: diagResponse, parse_error: true };
    }

    // 4. Store diagnosis in analytics_output for the Newspaper
    const today = new Date().toISOString().slice(0, 10);
    await env.ARCHIVE_DB.prepare(`
        INSERT INTO analytics_output (feature, date, value, brief_text)
        VALUES ('quality_diagnosis', ?, ?, ?)
        ON CONFLICT DO UPDATE SET value = excluded.value, brief_text = excluded.brief_text
    `).bind(
        today,
        JSON.stringify(diagnosis),
        diagnosis.voice_drift || 'No drift detected'
    ).run().catch(() => {});

    return new Response(JSON.stringify({
        ok: true,
        low_count: lowBriefs.results.length,
        high_count: (highBriefs.results || []).length,
        diagnosis,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

## TASK 2: POST /quality/update-rules endpoint

When /quality/diagnose identifies new banned phrases or rule
changes, /quality/update-rules applies them to the live config.

The BANNED_PHRASES array in journalism-quality.js is a static
export. We can't modify source at runtime. Instead, store
DYNAMIC rule additions in KV:

```javascript
if (pathname === '/quality/update-rules' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return new Response('invalid json', { status: 400 });

    // Read existing dynamic rules from KV
    const existing = await env.FIELD_JOURNALISM.get('quality:dynamic_rules')
        .then(v => v ? JSON.parse(v) : { banned: [], sparingly: [], notes: [] })
        .catch(() => ({ banned: [], sparingly: [], notes: [] }));

    // Merge new rules
    if (body.add_banned) {
        const newPhrases = body.add_banned.filter(p =>
            !existing.banned.includes(p.toLowerCase())
        );
        existing.banned.push(...newPhrases.map(p => p.toLowerCase()));
    }
    if (body.add_sparingly) {
        existing.sparingly.push(...body.add_sparingly.filter(p =>
            !existing.sparingly.includes(p.toLowerCase())
        ));
    }
    if (body.note) {
        existing.notes.push({
            note: body.note,
            added: new Date().toISOString(),
            source: 'quality-feedback-loop',
        });
    }

    // Store with 30-day TTL (rules should be reviewed and hardcoded periodically)
    await env.FIELD_JOURNALISM.put(
        'quality:dynamic_rules',
        JSON.stringify(existing),
        { expirationTtl: 30 * 86400 }
    );

    return new Response(JSON.stringify({
        ok: true,
        banned_count: existing.banned.length,
        sparingly_count: existing.sparingly.length,
        notes_count: existing.notes.length,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

## TASK 3: Load dynamic rules into quality chain

In journalism-quality.js, modify hasCliche() and countSparingly()
to also check dynamic rules from KV. Since these are pure functions,
they can't read KV directly.

Instead, add a `loadDynamicRules(env)` function that reads from KV
once per cron tick and caches in module scope:

```javascript
let _dynamicRules = null;
let _dynamicRulesTs = 0;

export async function loadDynamicRules(env) {
    // Cache for 5 minutes
    if (_dynamicRules && Date.now() - _dynamicRulesTs < 300000) {
        return _dynamicRules;
    }
    try {
        const raw = await env.FIELD_JOURNALISM.get('quality:dynamic_rules');
        _dynamicRules = raw ? JSON.parse(raw) : { banned: [], sparingly: [] };
    } catch (_) {
        _dynamicRules = { banned: [], sparingly: [] };
    }
    _dynamicRulesTs = Date.now();
    return _dynamicRules;
}

// Update hasCliche to accept dynamic additions
export function hasCliche(text, dynamicBanned = []) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const allBanned = [...BANNED_PHRASES, ...dynamicBanned];
    return allBanned.filter(p => lower.includes(p));
}
```

Then in index.js, at the start of each journalism cycle:
```javascript
const dynRules = await loadDynamicRules(env);
// Pass dynRules.banned to hasCliche calls via runQualityChain opts
```

Update runQualityChain to accept and pass through dynamic rules:
```javascript
export async function runQualityChain(prompt, initialText, callProxy, opts = {}) {
    // ...
    const dynamicBanned = opts.dynamicBanned || [];
    const cliches = hasCliche(text, dynamicBanned);
    // ...
}
```

## TASK 4: Wire /quality/diagnose into analytics cron

In the quality check phase added by prompt 2 of 3 (Task 4), when
degradation is detected, automatically call the diagnose logic:

```javascript
// After detecting quality degradation:
if (qualityRows.results?.length) {
    // Auto-diagnose
    try {
        const diagResult = await diagnoseBriefQuality(env, yesterday, 170);
        if (diagResult?.new_banned_phrases?.length) {
            // Auto-apply new banned phrases
            const dynRules = await loadDynamicRules(env);
            dynRules.banned.push(...diagResult.new_banned_phrases);
            await env.FIELD_JOURNALISM.put(
                'quality:dynamic_rules',
                JSON.stringify(dynRules),
                { expirationTtl: 30 * 86400 }
            );
        }
    } catch (_) {}
}
```

Extract the diagnose logic from the endpoint into a reusable
function `diagnoseBriefQuality(env, since, threshold)` that both
the endpoint and the cron can call.

## SCOPE BOUNDARY

DO:
- Add /quality/diagnose endpoint (LLM-powered pattern detection)
- Add /quality/update-rules endpoint (dynamic rule management)
- Add dynamic rules loading to quality chain
- Wire auto-diagnose into analytics cron
- Store diagnosis in analytics_output

DO NOT:
- Modify static BANNED_PHRASES array (dynamic rules layer on top)
- Modify FIELD_VOICE_REGISTER or FIELD_PROSE_STYLE
- Touch the client repo
- Auto-deploy source code changes (dynamic rules are KV-only)

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Add /quality/diagnose endpoint (Task 1).
4. Add /quality/update-rules endpoint (Task 2).
5. Add loadDynamicRules + wire into quality chain (Task 3).
6. Wire auto-diagnose into analytics cron (Task 4).
7. node --check src/index.js && node --check src/journalism-quality.js
8. Single commit: "feat: automated quality feedback loop —
   diagnose + dynamic rules + auto-update"
9. Deploy via wrangler deploy.
10. Verify:
    curl /quality/diagnose?days=3
    Expect diagnosis of existing low-quality backfill briefs.
11. Write manifest to outbox.

## RUN ORDER

This is prompt 3 of 3. Run AFTER:
1. CC-CMD-2026-06-22-v4-register-port.md (voice register)
2. CC-CMD-2026-06-22-quality-scoring-everywhere.md (scoring)
3. THIS PROMPT (feedback loop)

Each builds on the prior. 1 must deploy before 2. 2 must deploy
before 3. The feedback loop needs scored briefs to diagnose.
