/**
 * stale-data-sentinel.js — freshness monitor for every data source FIELD reads.
 *
 * Each SOURCES entry declares: key, label, season window, max age, check fn.
 * checkAllSources() runs every check in parallel and reports stale entries.
 *
 * RELAY-IS-DUMB (Rule 47): no editorial decisions here. Pure arithmetic —
 * compare timestamps to thresholds, count rows, check key existence.
 */

const GH_RAW = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main';

// Parse compact ISO 8601 (20260622T154627Z) → ms.
function parseCompactIso(s) {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
}

// Month-of-year (1-12 UTC) inside an inclusive range; supports wrap (e.g. NFL Sep–Feb).
function inSeason(monthRange, now = new Date()) {
    if (!monthRange) return true;
    const [start, end] = monthRange;
    const m = now.getUTCMonth() + 1;
    return start <= end ? (m >= start && m <= end) : (m >= start || m <= end);
}

async function checkGithubJson(path) {
    const r = await fetch(`${GH_RAW}/${path}`, { cf: { cacheTtl: 300 } });
    if (!r.ok) return { ok: false, reason: `github ${r.status}` };
    const d = await r.json();
    const updatedMs = parseCompactIso(d.updated);
    return {
        ok: true,
        updated: d.updated || null,
        updatedMs,
        entries: d.data ? Object.keys(d.data).length : 0,
    };
}

async function checkR2(env, key) {
    if (!env.FIELD_DATA) return { ok: false, reason: 'FIELD_DATA not bound' };
    const head = await env.FIELD_DATA.head(key);
    if (!head) return { ok: false, reason: 'r2 key missing', updatedMs: null };
    return {
        ok: true,
        size: head.size,
        uploaded: head.uploaded?.toISOString() || null,
        updatedMs: head.uploaded?.getTime() || null,
    };
}

async function checkKvExists(env, binding, key) {
    if (!env[binding]) return { ok: false, reason: `${binding} not bound` };
    const v = await env[binding].get(key);
    return {
        ok: v != null,
        exists: v != null,
        bytes: v ? v.length : 0,
        updatedMs: v != null ? Date.now() : null,
    };
}

function ymdUtc(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function ymUtc(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

const SOURCES = [
    {
        key: 'mlb_team_abs', label: 'MLB Team ABS Grades',
        maxAgeHours: 168, season: [3, 10],
        check: () => checkGithubJson('outbox/mlb/team_abs.json'),
    },
    {
        key: 'mlb_pitch_arsenals', label: 'MLB Pitch Arsenals',
        maxAgeHours: 168, season: [3, 10],
        check: () => checkGithubJson('outbox/mlb/pitch_arsenals.json'),
    },
    {
        key: 'mlb_expected_stats', label: 'MLB Expected Stats',
        maxAgeHours: 168, season: [3, 10],
        check: () => checkGithubJson('outbox/mlb/expected_stats.json'),
    },
    {
        key: 'nba_clutch_playoffs', label: 'NBA Clutch (Playoffs)',
        maxAgeHours: 24, season: [10, 7],
        check: (env) => checkR2(env, 'nba/2026/clutch_playoffs.json'),
    },
    {
        key: 'nba_clutch_regular', label: 'NBA Clutch (Regular Season)',
        maxAgeHours: 24, season: [10, 7],
        check: (env) => checkR2(env, 'nba/2026/clutch_regular.json'),
    },
    {
        key: 'nhl_series_stats', label: 'NHL Series Stats (SCF 2026)',
        maxAgeHours: 4, season: [10, 6],
        check: (env) => checkR2(env, 'nhl/scf-2026/series-stats.json'),
    },
    {
        key: 'soccer_fbref_epl', label: 'Soccer FBref EPL',
        maxAgeHours: 72, season: [8, 5],
        check: (env) => checkR2(env, 'soccer/fbref/epl.json'),
    },
    {
        key: 'soccer_fbref_wc', label: 'Soccer FBref WC 2026',
        maxAgeHours: 72, season: [6, 7],
        check: (env) => checkR2(env, 'soccer/fbref/wc2026.json'),
    },
    {
        key: 'soccer_fbref_mls', label: 'Soccer FBref MLS',
        maxAgeHours: 72, season: [2, 11],
        check: (env) => checkR2(env, 'soccer/fbref/mls.json'),
    },
    {
        // wc_third_place_standings view does not exist; wc_group is the
        // source of truth and has no updated_at — freshness collapses to
        // "table has rows during the WC window".
        key: 'wc_group', label: 'WC Group Standings (D1)',
        maxAgeHours: null, season: [6, 7],
        check: async (env) => {
            if (!env.WC2026_DB) return { ok: false, reason: 'WC2026_DB not bound' };
            const r = await env.WC2026_DB.prepare('SELECT COUNT(*) AS n FROM wc_group').first();
            const n = r?.n || 0;
            return { ok: n > 0, rows: n, updatedMs: null };
        },
    },
    {
        key: 'odds_daily', label: 'Odds — Daily Counter',
        maxAgeHours: 24,
        check: (env) => checkKvExists(env, 'FIELD_JOURNALISM', `odds:daily:${ymdUtc()}`),
    },
    {
        key: 'odds_monthly', label: 'Odds — Monthly Credit Counter',
        maxAgeHours: 720,
        check: (env) => checkKvExists(env, 'FIELD_JOURNALISM', `odds:credits:${ymUtc()}`),
    },
    {
        key: 'journalism_brief', label: 'Journalism Brief (today)',
        maxAgeHours: 24,
        check: (env) => checkKvExists(env, 'FIELD_JOURNALISM', `journalism:${ymdUtc()}`),
    },
];

export async function checkAllSources(env) {
    const now = Date.now();
    const checks = await Promise.all(SOURCES.map(async (source) => {
        if (!inSeason(source.season)) {
            return {
                key: source.key, label: source.label,
                inSeason: false, skipped: true, stale: false,
                maxAgeHours: source.maxAgeHours,
            };
        }
        try {
            const data = await source.check(env);
            let ageHours = null;
            let stale = false;
            if (data.updatedMs) {
                ageHours = Math.round((now - data.updatedMs) / 3600000);
                stale = source.maxAgeHours != null && ageHours > source.maxAgeHours;
            } else if (data.ok === false) {
                stale = true;
            }
            return {
                key: source.key, label: source.label,
                inSeason: true,
                ...data,
                ageHours,
                maxAgeHours: source.maxAgeHours,
                stale,
            };
        } catch (e) {
            return {
                key: source.key, label: source.label,
                inSeason: true, ok: false,
                error: e.message, stale: true,
                maxAgeHours: source.maxAgeHours,
            };
        }
    }));

    return {
        checkedAt: new Date().toISOString(),
        total: checks.length,
        stale: checks.filter(r => r.stale).length,
        healthy: checks.filter(r => !r.stale && !r.skipped).length,
        skipped: checks.filter(r => r.skipped).length,
        sources: checks,
    };
}
