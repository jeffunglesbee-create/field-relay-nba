# Claude Code Command — Stale Data Sentinel

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-stale-data-sentinel-2026-06-21.md.

## CONTEXT

FIELD has 10+ data sources feeding the journalism pipeline, odds
system, and bracket projections. Each source has a different refresh
cadence (hourly, daily, weekly, on-demand). When a source goes
stale — cron fails silently, GitHub Actions job disabled, R2 write
returns 200 but data is empty — nothing detects it. The Context
Assembler silently returns '' for that sport. The journalism prompt
loses context. Quality degrades gradually.

This happened in production: team_abs.json was in the GitHub outbox
but never written to R2. The Context Assembler read from R2 (empty)
for days. Nobody noticed because the journalism cron still succeeded
(just without sport context). The fix was a one-line source change,
but the detection gap was weeks.

The Stale Data Sentinel monitors every data source's freshness
and surfaces problems via a single probe endpoint.

## DATA SOURCE REGISTRY

Each source has:
- key: unique identifier
- location: where the data lives (R2, GitHub, D1, KV, external API)
- expected_refresh: how often it should update (hours)
- check: how to verify freshness (file modified time, JSON timestamp field, row count)

```
| Key                  | Location                          | Refresh | Check                           |
|---------------------|----------------------------------|---------|----------------------------------|
| mlb_team_abs        | GitHub outbox/mlb/team_abs.json  | 168h    | JSON .updated field              |
| mlb_pitch_arsenals  | GitHub outbox/mlb/pitch_arsenals | 168h    | JSON .updated field              |
| mlb_expected_stats  | GitHub outbox/mlb/expected_stats | 168h    | JSON .updated field              |
| nba_clutch_playoffs | R2 nba/2026/clutch_playoffs.json | 24h     | JSON .updated field              |
| nba_clutch_regular  | R2 nba/2026/clutch_regular.json  | 24h     | JSON .updated field              |
| nhl_series_stats    | R2 nhl/scf-2026/series-stats.json| 4h      | JSON .updated field              |
| soccer_fbref_epl    | R2 soccer/fbref/epl.json         | 72h     | JSON .updated or file existence  |
| soccer_fbref_wc     | R2 soccer/fbref/wc2026.json      | 72h     | JSON .updated or file existence  |
| soccer_fbref_mls    | R2 soccer/fbref/mls.json         | 72h     | JSON .updated or file existence  |
| wc_standings        | D1 wc_group_standings            | 1h      | MAX(updated_at) during WC window |
| wc_third_place      | D1 wc_third_place_standings      | 1h      | MAX(updated_at) during WC window |
| odds_daily          | KV odds:daily:YYYY-MM-DD         | 24h     | Key exists for today             |
| odds_monthly        | KV odds:credits:YYYY-MM          | 720h    | Key exists for this month        |
| journalism_brief    | KV journalism:YYYY-MM-DD         | 24h     | Key exists for today             |
```

## PRE-BUILD PROBE

```bash
# 1. Check which R2 keys exist in FIELD_DATA
# (R2 list not available via relay — probe individual keys)

# 2. Check GitHub outbox files
ls -la outbox/mlb/ 2>/dev/null

# 3. Check D1 table freshness
# SELECT MAX(updated_at) FROM wc_group_standings

# 4. Check KV keys
# journalism:{today}, odds:daily:{today}, odds:credits:{month}
```

## TASK 1: Create src/stale-data-sentinel.js

```javascript
// Source registry — each entry defines how to check freshness
const SOURCES = [
    {
        key: 'mlb_team_abs',
        label: 'MLB Team ABS Grades',
        maxAgeHours: 168,  // weekly
        check: async (env) => {
            // Fetch from GitHub outbox
            const r = await fetch(
                'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/mlb/team_abs.json',
                { cf: { cacheTtl: 300 } }
            );
            if (!r.ok) return { ok: false, reason: 'fetch failed', status: r.status };
            const d = await r.json();
            return {
                ok: true,
                updated: d.updated || null,
                entries: d.data ? Object.keys(d.data).length : 0,
            };
        },
    },
    {
        key: 'mlb_pitch_arsenals',
        label: 'MLB Pitch Arsenals',
        maxAgeHours: 168,
        check: async (env) => {
            const r = await fetch(
                'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/mlb/pitch_arsenals.json',
                { cf: { cacheTtl: 300 } }
            );
            if (!r.ok) return { ok: false, reason: 'fetch failed' };
            const d = await r.json();
            return {
                ok: true,
                updated: d.updated || null,
                entries: d.data ? Object.keys(d.data).length : 0,
            };
        },
    },
    // R2 sources: use env.FIELD_DATA.head(key) for metadata
    // D1 sources: use env.ARCHIVE_DB.prepare(...)
    // KV sources: use env.FIELD_JOURNALISM.get(key)
    // Pattern for each is the same — check, report age, flag stale
];

export async function checkAllSources(env) {
    const results = [];
    const now = Date.now();

    for (const source of SOURCES) {
        try {
            const data = await source.check(env);
            let ageHours = null;
            let stale = false;

            if (data.updated) {
                const updatedMs = new Date(data.updated).getTime();
                ageHours = Math.round((now - updatedMs) / 3600000);
                stale = ageHours > source.maxAgeHours;
            }

            results.push({
                key: source.key,
                label: source.label,
                ...data,
                ageHours,
                maxAgeHours: source.maxAgeHours,
                stale,
            });
        } catch (e) {
            results.push({
                key: source.key,
                label: source.label,
                ok: false,
                error: e.message,
                stale: true,
            });
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        total: results.length,
        stale: results.filter(r => r.stale).length,
        healthy: results.filter(r => !r.stale).length,
        sources: results,
    };
}
```

Implement ALL sources from the registry table above. For R2
sources, use `env.FIELD_DATA.head(key)` to get metadata (size,
uploaded timestamp) without downloading the full file. For D1,
use `MAX(updated_at)`. For KV, check if the key exists.

## TASK 2: Add GET /health/sources endpoint

```javascript
if (pathname === '/health/sources') {
    const { checkAllSources } = await import('./stale-data-sentinel.js');
    const result = await checkAllSources(env);
    return new Response(JSON.stringify(result, null, 2), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}
```

Response shape:
```json
{
    "checkedAt": "2026-06-22T01:00:00Z",
    "total": 14,
    "stale": 2,
    "healthy": 12,
    "sources": [
        {
            "key": "mlb_team_abs",
            "label": "MLB Team ABS Grades",
            "ok": true,
            "updated": "20260615T213716Z",
            "entries": 30,
            "ageHours": 147,
            "maxAgeHours": 168,
            "stale": false
        },
        {
            "key": "soccer_fbref_wc",
            "label": "Soccer FBref WC 2026",
            "ok": true,
            "updated": null,
            "entries": 0,
            "ageHours": null,
            "maxAgeHours": 72,
            "stale": true
        }
    ]
}
```

## TASK 3: Seasonal awareness

Some sources are only relevant during certain months:
- NHL series stats: Oct–Jun only
- NBA clutch: Oct–Jul only
- Soccer FBref WC: Jun–Jul 2026 only
- MLB: Mar–Oct only
- NFL: Sep–Feb only

Add a `season` field to each source config. When outside the
season window, the source is skipped (not flagged as stale).

## SCOPE BOUNDARY

DO:
- Create src/stale-data-sentinel.js
- Add /health/sources endpoint in src/index.js
- Cover all 14+ data sources in the registry
- Include seasonal awareness

DO NOT:
- Modify any existing adapter
- Send alerts (email/push) — probe-only for now
- Modify the journalism pipeline
- Change R2 or D1 schemas

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. Pre-build probes — check which R2 keys actually exist.
3. node --check all files.
4. Single commit: "feat: stale data sentinel — /health/sources
   monitors all data source freshness"
5. Deploy via wrangler deploy.
6. After deploy, hit /health/sources and verify output.
7. Write manifest to outbox.
