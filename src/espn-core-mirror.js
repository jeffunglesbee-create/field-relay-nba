// ESPN core API mirror (docs/CC-CMD-2026-10-14-espn-host-flip.md, Task 3; the owner's order of
// 2026-11-19, "Move the 5 other relay routes to runners").
//
// sports.core.api.espn.com answers 403 to Cloudflare Worker egress and 200 to a GitHub runner
// (outbox/golf-core-reach-probe-2026-11-19T00-41-40-114Z.json; outbox/espn-core-runner-probe-*.json,
// 12 of 12 core reads 200 from a runner). So a runner reads the core API and writes each body into
// ARCHIVE_DB `espn_core_mirror`, one row per core URL, and the relay's five read sites read that
// row instead of fetching. The runner is scripts/espn-core-mirror.mjs, dispatched by the relay's
// */15 cron (GitHub's own schedule fires here a median 377 minutes apart, measured 2026-11-19).
//
// Pure, so the runner and scripts/check-espn-core-mirror.mjs share it with the Worker.

export const CORE_MIRROR_TABLE = 'espn_core_mirror';

// The relay names a core resource by its PATH under this base and never by its host: the relay does not
// contact the host (it reads the mirror), and scripts/build-route-provenance.mjs reads any host in a
// route as a source the route contacts. The runner, which does contact it, builds full URLs.
const CORE_SPORTS_BASE = 'https://sports.core.api.espn.com/v2/sports';
export function coreUrlOf(path) {
    return `${CORE_SPORTS_BASE}/${String(path || '').replace(/^\/+/, '')}`;
}

export const CORE_MIRROR_DDL =
    `CREATE TABLE IF NOT EXISTS ${CORE_MIRROR_TABLE} (` +
    'url TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, fetched_at TEXT NOT NULL, final INTEGER NOT NULL DEFAULT 0)';

// One key per core resource: https, no query string, no trailing slash. The relay builds
// `?limit=25` on the eventlog URL and ESPN's own $refs carry `?lang=en&region=us`; neither
// changes the resource, and the runner and the relay must agree on the key.
export function coreMirrorKey(url) {
    const s = String(url || '').trim().replace(/^http:\/\//i, 'https://');
    return s.split('?')[0].split('#')[0].replace(/\/+$/, '');
}

// What kind of read a core URL is. Null for any URL the mirror does not carry.
export function coreMirrorKind(url) {
    const k = coreMirrorKey(url);
    if (!/^https:\/\/sports\.core\.api\.espn\.com\/v2\/sports\//.test(k)) return null;
    if (/\/golf\/leagues\/pga\/events\/\d+\/competitions\/\d+\/competitors\/\d+\/statistics\/0$/.test(k)) return 'golf-competitor-stats';
    if (/\/golf\/leagues\/pga\/seasons\/\d+\/athletes\/\d+\/eventlog$/.test(k)) return 'golf-eventlog';
    if (/\/soccer\/leagues\/[a-z0-9._-]+\/events\/\d+\/competitions\/\d+\/competitors\/\d+\/statistics$/.test(k)) return 'soccer-team-stats';
    if (/\/soccer\/leagues\/[a-z0-9._-]+\/athletes\/\d+$/.test(k)) return 'soccer-athlete';
    return null;
}

const statsOnly = (stats) => (Array.isArray(stats) ? stats : [])
    .filter(s => s && typeof s.name === 'string')
    .map(s => ({ name: s.name, value: s.value ?? null, displayValue: s.displayValue ?? null }));

// The body kept for each kind: exactly the fields the relay's readers use, in ESPN's own shape,
// so the readers' parsing is unchanged. Statistics keep every stat's name, value and displayValue
// (the soccer team body is ~64 KB raw, mostly $refs and labels, measured 2026-11-19).
export function trimCoreBody(kind, body) {
    if (!body || typeof body !== 'object') return null;
    if (kind === 'golf-competitor-stats' || kind === 'soccer-team-stats') {
        const out = { splits: { categories: (body.splits?.categories || []).map(c => ({ name: c?.name ?? null, stats: statsOnly(c?.stats) })) } };
        if (Array.isArray(body.stats)) out.stats = statsOnly(body.stats);
        return out;
    }
    if (kind === 'golf-eventlog') {
        const items = Array.isArray(body?.events?.items) ? body.events.items : Array.isArray(body?.items) ? body.items : [];
        const ref = r => (r && typeof r.$ref === 'string' ? { $ref: r.$ref } : null);
        return { events: { items: items.map(i => ({ event: ref(i?.event), competition: ref(i?.competition), competitor: ref(i?.competitor), statistics: ref(i?.statistics), played: i?.played ?? null })) } };
    }
    if (kind === 'soccer-athlete') {
        return { id: body.id ?? null, position: { abbreviation: body.position?.abbreviation ?? null, name: body.position?.name ?? null } };
    }
    return null;
}

// The relay's read, by core path (coreUrlOf): the trimmed body and when the runner fetched it, or why
// there is none. A missing row is said, never turned into an empty answer (host-flip Task 3: a 403
// read as "no defensive sub").
export async function readCoreMirror(env, path) {
    const url = coreUrlOf(path);
    if (!env?.ARCHIVE_DB) return { body: null, fetchedAt: null, error: 'ARCHIVE_DB not bound' };
    try {
        const row = await env.ARCHIVE_DB.prepare(`SELECT body, fetched_at FROM ${CORE_MIRROR_TABLE} WHERE url = ?`)
            .bind(coreMirrorKey(url)).first();
        if (!row) return { body: null, fetchedAt: null, error: 'not mirrored' };
        return { body: JSON.parse(row.body), fetchedAt: row.fetched_at, error: null };
    } catch (e) {
        return { body: null, fetchedAt: null, error: `mirror read failed: ${e.message}` };
    }
}
