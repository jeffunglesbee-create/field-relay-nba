#!/usr/bin/env node
// Premise probe for CC-CMD-2026-08-20-brief-data-quality ask 5.
//
// THE CLAIM UNDER TEST (Rule 72):
// The positioning note `outbox/cc-differentiating-on-trust-2026-08-20.md`
// asserts "Every row carries espn_event_id", and ask 5 (ground recaps in
// keyEvents/incidents) is scoped on that being true — the whole build is
// "join on espn_event_id and generate from the event feed."
//
// Counter-evidence that prompted this probe: every MLS row in
// /context/date/2026-08-20 carried "espn_event_id": null. But those were the
// early-July hand-seeded schedule import, so they do not settle whether
// CRON-seeded MLS rows carry the id. A GROUP BY over regular_season_games
// does. That needs POST /d1/execute, hence CI-as-proxy.
//
// This is read-only. It writes no rows and changes nothing.
//
// Why it matters for scoping: if MLS rows lack espn_event_id, ask 5 is not
// "change the generator" — it is "populate a missing id across the sport that
// produced most of the defective recaps," a different and much larger build.
// That distinction should be settled before ask 5 is costed, not after.
//
// Also answers ask 4's artifact in passing (do brief game_ids resolve to game
// rows?), since it is the same trip and the same join.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: {
            'X-FIELD-Relay': 'field-relay-cron-2026',
            'Content-Type': 'application/json',
            'User-Agent': UA,   // bare/default UA is 403'd at the CF edge
        },
        body: JSON.stringify({ sql, params }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`non-JSON: ${text.slice(0, 300)}`); }
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}

const m = {
    probed_at: new Date().toISOString(),
    // query_ok separate from every finding, so a broken probe can never be
    // misread as "the id is missing". Same split as the UEFA probe.
    query_ok: false,
    premise_holds: null,          // "every row carries espn_event_id"
    premise_holds_for_mls: null,  // the sport ask 5 actually depends on
    coverage_by_sport: [],
    mls_by_month: [],
    brief_game_id_shapes: [],
    game_recap_join_rate: null,
    unjoinable_sample: [],
    error: null,
};

try {
    // 1. espn_event_id coverage per sport, all time.
    const cov = await d1(
        `SELECT sport,
                COUNT(*) AS rows_total,
                SUM(CASE WHEN espn_event_id IS NOT NULL AND espn_event_id <> '' THEN 1 ELSE 0 END) AS rows_with_id
         FROM regular_season_games
         GROUP BY sport ORDER BY rows_total DESC`);
    m.coverage_by_sport = cov.map(r => ({
        sport: r.sport,
        rows_total: r.rows_total,
        rows_with_id: r.rows_with_id,
        pct: r.rows_total ? Math.round((r.rows_with_id / r.rows_total) * 100) : null,
    }));

    // 2. MLS over time — separates the July hand-seeded import from later
    // cron-seeded rows. If coverage is 0% in every month, the id was never
    // populated for MLS by any writer.
    m.mls_by_month = await d1(
        `SELECT substr(date,1,7) AS month,
                COUNT(*) AS rows_total,
                SUM(CASE WHEN espn_event_id IS NOT NULL AND espn_event_id <> '' THEN 1 ELSE 0 END) AS rows_with_id
         FROM regular_season_games
         WHERE sport = 'MLS'
         GROUP BY month ORDER BY month DESC LIMIT 12`);

    // 3. Shapes of game_id in briefs (ask 4's three key-spaces).
    m.brief_game_id_shapes = await d1(
        `SELECT CASE
                  WHEN game_id GLOB 'g[0-9]*'      THEN 'ordinal gNN'
                  WHEN length(game_id) >= 9        THEN '9-digit espn-like'
                  WHEN game_id GLOB '[0-9]*'       THEN '6-digit numeric'
                  ELSE 'other'
                END AS shape,
                COUNT(*) AS n
         FROM briefs WHERE game_id IS NOT NULL
         GROUP BY shape ORDER BY n DESC`);

    // 4. Do game_recap briefs actually resolve to a game row? (ask 4 artifact)
    const join = await d1(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN g.espn_event_id IS NOT NULL THEN 1 ELSE 0 END) AS joined
         FROM briefs b
         LEFT JOIN regular_season_games g ON g.espn_event_id = b.game_id
         WHERE b.brief_type = 'game_recap'`);
    const t = join[0]?.total ?? 0, j = join[0]?.joined ?? 0;
    m.game_recap_join_rate = { total: t, joined: j, pct: t ? Math.round((j / t) * 100) : null };

    m.unjoinable_sample = await d1(
        `SELECT b.id, b.sport, b.game_id, b.date
         FROM briefs b
         LEFT JOIN regular_season_games g ON g.espn_event_id = b.game_id
         WHERE b.brief_type = 'game_recap' AND g.espn_event_id IS NULL
         ORDER BY b.date DESC LIMIT 8`);

    const mlsRow = m.coverage_by_sport.find(r => r.sport === 'MLS');
    m.premise_holds_for_mls = mlsRow ? mlsRow.rows_with_id > 0 : null;
    m.premise_holds = m.coverage_by_sport.every(r => r.rows_total === r.rows_with_id);
    m.query_ok = true;
} catch (e) {
    m.error = String(e.message || e);
}

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/brief-join-premise-manifest-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);

if (!m.query_ok) {
    console.error('PROBE FAILED — the query did not run. This says NOTHING about the data.');
    process.exit(1);
}
console.log(`\npremise "every row carries espn_event_id": ${m.premise_holds}`);
console.log(`premise holds for MLS (ask 5's dependency): ${m.premise_holds_for_mls}`);
console.log(`game_recap join rate: ${m.game_recap_join_rate.pct}% (${m.game_recap_join_rate.joined}/${m.game_recap_join_rate.total})`);
process.exit(0);
