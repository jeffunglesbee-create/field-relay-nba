// Who wrote this row? — provenance for D1 writes against the game archive.
//
// TASK 2 OF CC-CMD-2026-09-02-d1-write-provenance.
//
// WHAT THIS IS FOR. A live writer INSERTs dash-scheme MLS rows
// (`2026-08-30-mls-stl-dal`) into `regular_season_games` the day after the game
// they cover — measured twice, a month apart. Task 1 enumerated all 285
// `prepare()` sites in `src/` (87 of them writes) and found exactly one path
// that can INSERT into that table, plus one fully dynamic `INSERT INTO ${table}`
// that a grep could never see and that an allowlist of one entry excludes. So by
// reading, no path in this repository can create such a row.
//
// THIS INSTRUMENT DOES NOT NAME THE EXTERNAL WRITER, AND MUST NOT BE READ AS
// TRYING TO. It proves the write is not ours: if every one of our own writes to
// these two tables is recorded and none of them is dash-scheme, then either the
// row came from outside this worker, or one of our doors is unwatched and the
// enumeration is wrong. Naming an outside writer needs Cloudflare's own D1 audit
// or an origin column stamped at insert time; neither is reachable from a route
// that writer does not call.
//
// SCOPE, AND WHY IT IS 10 SITES AND NOT 87. The enumeration is the reason the
// scope could narrow. Of the 87 writes, 20 are schema statements (CREATE/ALTER
// at boot) and 57 target tables unrelated to the question (briefs, codex,
// wc_results, change_log, …). Instrumenting those adds no discriminating power
// for "who inserts a dash-scheme game row", and Task 1 answers the separation
// concern — "it came through a door nobody was watching" — permanently, by
// reading, at zero runtime cost. The 10 instrumented sites are every runtime
// write to `regular_season_games` and `postseason_games`.
//
// SECURITY (CC-CMD §"Security constraints", non-negotiable):
//   - No SQL text is passed in at all. `verb` and `table` are literals supplied
//     per site, so row data cannot reach this function even by accident. That is
//     stricter than the CC-CMD's "parse the verb out of the statement".
//   - No header is read except `user-agent`, truncated to 64 bytes. Never the
//     header bag, never anything matching /auth|secret|token|key/i.
//   - No IP. `cf.country` and `cf.asn` answer "which system" without
//     identifying a person or a machine. Cloudflare's own logs have the IP if an
//     operator ever needs it.

/** The literal every provenance row carries as its single Analytics Engine index. */
export const D1_WRITE_INDEX = 'd1-write';

/**
 * Header that marks a deliberate control write.
 *
 * The control exists because "no entries in 48 hours" and "the instrument never
 * worked" produce identical output, and the thing being watched fires about once
 * a day at an unpredictable time — so a silent instrument looks exactly like a
 * quiet system for as long as anyone is willing to wait.
 *
 * Not a credential and not treated as one: it changes a telemetry label and
 * nothing else. It is also NOT able to hide a real observation — see
 * `provenanceScheme`, where `dash` outranks it.
 */
export const CONTROL_HEADER = 'X-FIELD-Provenance-Control';

/**
 * The id scheme an archive game id belongs to.
 *
 *   dash        `2026-08-30-mls-stl-dal`      — the external writer's shape
 *   underscore  `MLS_2026-08-29_dcunited_lafc`, `MLB_2099-03-01_e999000111` — ours
 *   other       neither
 *   none        absent or empty
 *
 * The two named schemes are mutually exclusive BY CONSTRUCTION rather than by
 * ordering luck: `dash` requires a leading ISO date AND no underscore anywhere,
 * so no id can satisfy both tests. Every one of our own id builders emits a
 * `${SPORT}_` prefix, and no observed external id contains an underscore.
 */
export const idScheme = (id) => {
    const s = typeof id === 'string' ? id.trim() : '';
    if (!s) return 'none';
    if (s.includes('_')) return 'underscore';
    if (/^\d{4}-\d{2}-\d{2}-/.test(s)) return 'dash';
    return 'other';
};

/**
 * The value written to blob1 — the id scheme, or `control` for a control write.
 *
 * PRECEDENCE IS DELIBERATE AND `dash` WINS. If control simply overrode the
 * scheme, anyone sending the control header while inserting a dash-scheme row
 * would relabel the exact observation this instrument exists to catch, and the
 * verifier — which counts blob1='dash' — would report NOT OBSERVED forever with
 * the evidence sitting in the row next to it. So the header can only relabel a
 * write that was not the thing being looked for.
 */
export const provenanceScheme = (id, isControl) => {
    const scheme = idScheme(id);
    return (isControl && scheme !== 'dash') ? 'control' : scheme;
};

/** `user-agent`, or `none`; never any other header. */
const uaOf = (request) => {
    try { return (request?.headers?.get('user-agent') || 'none').slice(0, 64); }
    catch (_) { return 'none'; }
};

/**
 * Record one write to the game archive. Fire-and-forget, and it swallows.
 *
 * RULE 5: an archive or telemetry failure must never break journalism, score
 * fan-out or MCP. `writeDataPoint` is not awaited anywhere in this repo and is
 * not awaited here; the try/catch covers a missing binding and a throw from the
 * call itself.
 *
 * @param env      the worker env (may lack JQ_ANALYTICS — then this is a no-op)
 * @param request  the inbound Request, or null for a non-request path
 * @param site     which write site — `/archive/game:regular`, not just the route
 * @param verb     'INSERT' | 'UPDATE', a literal at the call site
 * @param table    'regular_season_games' | 'postseason_games', a literal
 * @param id       the row id being written
 */
export const recordD1Write = (env, request, { site, verb, table, id }) => {
    try {
        if (!env?.JQ_ANALYTICS) return;
        const isControl = (() => {
            try { return request?.headers?.get(CONTROL_HEADER) === '1'; }
            catch (_) { return false; }
        })();
        const cf = request?.cf || {};
        env.JQ_ANALYTICS.writeDataPoint({
            indexes: [D1_WRITE_INDEX],
            blobs: [
                provenanceScheme(id, isControl),
                site,
                verb,
                table,
                uaOf(request),
                String(cf.country ?? 'none'),
                String(cf.asn ?? 'none'),
            ],
            doubles: [1],
        });
    } catch (e) {
        console.error('[D1-PROVENANCE] write failed:', e?.message);
    }
};

/**
 * Every site this module is wired into, in source order.
 *
 * Exported so the verifier asserts against ONE list rather than a copy: a site
 * added to `src/index.js` without a line here, or a line here with no call in
 * `src/index.js`, fails the static check. The count is the CC-CMD's approved
 * scope — every runtime write to the two game tables, and nothing else.
 */
export const D1_WRITE_SITES = [
    'writeMLBSeriesResult:regular',
    '/admin/archive/backfill-went-to-ot:regular',
    '/archive/drama-by-id:regular',
    '/archive/drama-by-id:postseason',
    '/archive/score-by-id:regular-espn',
    '/archive/score-by-id:postseason-espn',
    '/archive/score-by-id:regular',
    '/archive/score-by-id:postseason',
    '/archive/game:postseason',
    '/archive/game:regular',
];
