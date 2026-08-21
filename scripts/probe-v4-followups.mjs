#!/usr/bin/env node
// Three checks against CC-CMD-2026-08-20-brief-data-quality rev 4. Read-only.
//
// Rev 4 is accurate about what shipped, but it carries numbers from earlier
// probe runs, and two of them move. Reading a rev-4 figure as current would be
// exactly the inherited-claim failure (Rule 72) this CC-CMD has already had to
// correct three times.
//
// 1. IS THE gNN GUARD ACTUALLY HOLDING? Rev 4 says 535 ordinal ids; today's
//    census says 539. Four more rows. That difference is either harmless
//    (pre-fix writes measured at different moments) or it means ask 4a's 400 is
//    not stopping writes -- which would be a shipped guard that does not guard.
//    The discriminator is WHEN the newest gNN row was written, relative to the
//    4a deploy. Nothing else settles it.
//
// 2. EPL OPENS 2026-08-22. Rev 4 says FIELD is not carrying the fixtures and
//    /context/date/2026-08-22 is all MLS. That claim is a day old and its
//    deadline is tomorrow, so it is re-checked rather than trusted.
//
// 3. ASK 3's ROW COUNT. Rev 4's ask-3 evidence says 25 rows (football 21 + mlb
//    4) while its own rev-4 note says ~601. Both cannot be current.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': 'field-relay-cron-2026', 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}

const m = { probed_at: new Date().toISOString(), query_ok: false,
    gnn_total: null, gnn_recent: null, gnn_by_day: [],
    epl_context: null, epl_archive: null,
    nonconforming_total: null, error: null };

try {
    m.gnn_total = (await d1(
        `SELECT COUNT(*) AS n FROM briefs WHERE game_id GLOB 'g[0-9]*'`))[0]?.n ?? null;

    // The whole question: is anything STILL arriving? Newest rows, with source,
    // so a post-deploy write is visible as such rather than inferred from a
    // total that also moves for other reasons.
    m.gnn_recent = await d1(
        `SELECT id, source, brief_type, created_at FROM briefs
         WHERE game_id GLOB 'g[0-9]*' ORDER BY created_at DESC LIMIT 8`);

    m.gnn_by_day = await d1(
        `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM briefs
         WHERE game_id GLOB 'g[0-9]*' GROUP BY day ORDER BY day DESC LIMIT 10`);

    // Ask 3 sizing: the doc's two figures disagree, so recount both ways.
    m.nonconforming_total = await d1(
        `SELECT COUNT(*) AS rows_, COUNT(DISTINCT sport) AS variants FROM briefs b
         WHERE NOT EXISTS (SELECT 1 FROM regular_season_games g WHERE g.sport = b.sport)
           AND NOT EXISTS (SELECT 1 FROM postseason_games p WHERE p.sport = b.sport)`);
    m.query_ok = true;
} catch (e) { m.error = String(e.message || e); }

// EPL opens tomorrow. Checked against the relay's own served view, which is what
// the client actually renders -- not against ESPN, which would answer a
// different question (does the fixture exist) than the one that matters (is
// FIELD carrying it).
for (const [key, url] of [
    ['epl_context', `${RELAY}/context/date/2026-08-22`],
    ['epl_archive', `${RELAY}/archive/query?date=2026-08-22&limit=50`],
]) {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        const j = await r.json();
        if (key === 'epl_context') {
            const g = j?.games?.regular || [];
            const bySport = {};
            for (const x of g) bySport[x.sport] = (bySport[x.sport] || 0) + 1;
            m.epl_context = { http: r.status, total: g.length, by_sport: bySport,
                has_epl: Object.keys(bySport).some(s => /premier|epl/i.test(s)) };
        } else {
            const rows = j?.results || [];
            const bySport = {};
            for (const x of rows) bySport[x.sport] = (bySport[x.sport] || 0) + 1;
            m.epl_archive = { http: r.status, count: j?.count ?? rows.length, by_sport: bySport };
        }
    } catch (e) { m[key] = { error: String(e.message || e) }; }
}

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/v4-followup-manifest-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.query_ok) { console.error('D1 QUERIES FAILED — says nothing about the data.'); process.exit(1); }
process.exit(0);
