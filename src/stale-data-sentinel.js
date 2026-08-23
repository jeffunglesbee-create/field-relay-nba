/**
 * stale-data-sentinel.js — freshness monitor for every data source FIELD reads.
 *
 * Each SOURCES entry declares: key, label, season window, max age, check fn.
 * checkAllSources() runs every check in parallel and reports stale entries.
 *
 * RELAY-IS-DUMB (Rule 47): no editorial decisions here. Pure arithmetic —
 * compare timestamps to thresholds, count rows, check key existence.
 *
 * CONTENT, not just presence (added 2026-08-23). The sentinel originally asked
 * two questions: does the key exist, and is it recent. It never asked whether
 * the file contained anything. On 2026-06-22 FBref started returning HTTP 403
 * to GitHub Actions runner IPs; the workflow parsed 0 squads, wrote
 * {"teams": {}} to R2, uploaded successfully and exited 0. /health/sources
 * reported `soccer_fbref_wc | ok | stale: False` for two weeks, because the
 * file existed and was recent. Meanwhile every soccer journalism prompt
 * assembled empty context.
 *
 * That session filed the fix as a carry-forward -- "add team/entry count > 0
 * check for FBref sources" -- and it was never built. The FBref sources
 * themselves were retired the next day, which removed the instance and left
 * the defect. Six sources still route through the same two questions today.
 *
 * `entries` was in fact already computed by checkGithubJson and read by
 * nothing: a count calculated and discarded, which is the same as no count.
 * A source now declares `minEntries` and `entriesFrom` (the container key its
 * OWN consumer reads -- `teams` for the R2 blobs, `data` for the GitHub JSON),
 * and falling below the floor marks the source stale, not healthy.
 *
 * Unreadable is a failure, not a pass. If a source declares minEntries and the
 * count cannot be determined, that is `empty: true`. A declared invariant that
 * cannot be evaluated has not been satisfied -- treating it as satisfied is how
 * the original two weeks happened.
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

// Count the entries in the container the source's OWN consumer reads. Objects
// are counted by key, arrays by length. `null` means "could not determine",
// which sourceVerdict treats as a failure rather than a pass.
export function countEntries(json, container) {
    if (!json || typeof json !== 'object' || !container) return null;
    const c = json[container];
    if (!c || typeof c !== 'object') return null;
    return Array.isArray(c) ? c.length : Object.keys(c).length;
}

async function checkGithubJson(path, container = 'data') {
    const r = await fetch(`${GH_RAW}/${path}`, { cf: { cacheTtl: 300 } });
    if (!r.ok) return { ok: false, reason: `github ${r.status}` };
    const d = await r.json();
    const updatedMs = parseCompactIso(d.updated);
    return {
        ok: true,
        updated: d.updated || null,
        updatedMs,
        entries: countEntries(d, container),
    };
}

// `container` opts into a body read. Without it this stays a HEAD -- size and
// upload time only, which is all the original did and all a non-JSON artifact
// can offer. /health/sources is pull-only with no cron caller (Rule 78: the
// extra R2 GET is per-request, not per-tick), so the read costs nothing on a
// schedule.
async function checkR2(env, key, container = null) {
    if (!env.FIELD_DATA) return { ok: false, reason: 'FIELD_DATA not bound' };
    const head = await env.FIELD_DATA.head(key);
    if (!head) return { ok: false, reason: 'r2 key missing', updatedMs: null };
    const base = {
        ok: true,
        size: head.size,
        uploaded: head.uploaded?.toISOString() || null,
        updatedMs: head.uploaded?.getTime() || null,
    };
    if (!container) return base;
    let entries = null;
    try {
        const obj = await env.FIELD_DATA.get(key);
        entries = countEntries(obj ? await obj.json() : null, container);
    } catch {
        entries = null;   // stays null on purpose -- see sourceVerdict
    }
    return { ...base, entries };
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
        maxAgeHours: 168, season: [3, 10], minEntries: 1,
        check: () => checkGithubJson('outbox/mlb/team_abs.json', 'data'),
    },
    {
        key: 'mlb_pitch_arsenals', label: 'MLB Pitch Arsenals',
        maxAgeHours: 168, season: [3, 10], minEntries: 1,
        check: () => checkGithubJson('outbox/mlb/pitch_arsenals.json', 'data'),
    },
    {
        key: 'mlb_expected_stats', label: 'MLB Expected Stats',
        maxAgeHours: 168, season: [3, 10], minEntries: 1,
        check: () => checkGithubJson('outbox/mlb/expected_stats.json', 'data'),
    },
    {
        key: 'nba_clutch_playoffs', label: 'NBA Clutch (Playoffs)',
        maxAgeHours: 24, season: [10, 7], minEntries: 1,
        check: (env) => checkR2(env, 'nba/2026/clutch_playoffs.json', 'teams'),
    },
    {
        key: 'nba_clutch_regular', label: 'NBA Clutch (Regular Season)',
        maxAgeHours: 24, season: [10, 7], minEntries: 1,
        check: (env) => checkR2(env, 'nba/2026/clutch_regular.json', 'teams'),
    },
    {
        key: 'nhl_series_stats', label: 'NHL Series Stats (SCF 2026)',
        maxAgeHours: 4, season: [10, 6], minEntries: 1,
        check: (env) => checkR2(env, 'nhl/scf-2026/series-stats.json', 'teams'),
    },
    // soccer_fbref_epl / _wc / _mls removed 2026-06-23:
    // FBref lost Opta licence Jan 2026; pipeline retired. ESPN Core API
    // xG now served live via /soccer/xg — no R2 artifact to check.
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

// Pure. Exported so scripts/sentinel-content-check.mjs can feed it synthetic
// rows and require it to go red -- a verdict never shown to fail proves nothing
// about the runs where it printed healthy.
export function sourceVerdict(source, data, now) {
    let ageHours = null;
    let stale = false;
    let reason = data.reason ?? null;

    if (data.updatedMs) {
        ageHours = Math.round((now - data.updatedMs) / 3600000);
        stale = source.maxAgeHours != null && ageHours > source.maxAgeHours;
        if (stale && !reason) reason = `age ${ageHours}h > maxAgeHours ${source.maxAgeHours}`;
    } else if (data.ok === false) {
        stale = true;
    }

    // The content floor. `empty` is its own field so the diagnosis survives,
    // but it also sets `stale` -- every consumer of this endpoint reads `stale`,
    // and a flag nothing reads is the defect this whole change is about.
    let empty = false;
    if (source.minEntries != null && data.ok !== false) {
        if (typeof data.entries !== 'number') {
            empty = true;
            reason = 'entry count unreadable';
        } else if (data.entries < source.minEntries) {
            empty = true;
            reason = `entries ${data.entries} < minEntries ${source.minEntries}`;
        }
        if (empty) stale = true;
    }

    return { ageHours, stale, empty, reason };
}

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
            const { ageHours, stale, empty, reason } = sourceVerdict(source, data, now);
            return {
                key: source.key, label: source.label,
                inSeason: true,
                ...data,
                ageHours,
                maxAgeHours: source.maxAgeHours,
                minEntries: source.minEntries ?? null,
                empty,
                reason,
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
        empty: checks.filter(r => r.empty).length,
        healthy: checks.filter(r => !r.stale && !r.skipped).length,
        skipped: checks.filter(r => r.skipped).length,
        sources: checks,
    };
}
