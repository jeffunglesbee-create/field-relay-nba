#!/usr/bin/env node
// Diagnostic for the two FAILs reported by scripts/verify-staged-2026-08-22.mjs
// on 2026-08-22:
//
//   closing_after_opening   FAIL — every pair is still non-sequenced
//   soccer_opening_coverage FAIL — coverage fell for La Liga (0/1)
//
// READ-ONLY. This answers "why", it does not change anything. A FAIL is a
// claim about the world; this establishes what the world actually contains
// before anyone writes a second fix on top of the first (Rule 77).
//
// The questions each section exists to answer are written above it, because a
// probe whose purpose is implicit gets misread later as evidence for whatever
// the reader already believed.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const T_ODDS_BACKFILL_FIX = '2026-08-21 22:40:09';  // 887c843
const T_ALIASES_COMPLETE  = '2026-08-21 23:24:27';  // bb04fc8

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

const out = { probed_at: new Date().toISOString(), query_ok: false, error: null, findings: {} };

try {
    // ── 1. WHAT do the failing rows actually look like? ─────────────────────
    // The check reported "every pair is still non-sequenced" without saying
    // whether closing lands BEFORE opening or EXACTLY EQUAL to it. Those are
    // different defects: before implies an ordering bug, equal implies one
    // snapshot written into two columns. Dump the raw timestamps and let the
    // data say which.
    const rows = await d1(
        `SELECT id, sport, date, opening_odds, closing_odds
         FROM regular_season_games
         WHERE opening_odds IS NOT NULL AND closing_odds IS NOT NULL
           AND date > date(?)
         ORDER BY date DESC LIMIT 60`, [T_ODDS_BACKFILL_FIX.slice(0, 10)]);

    const detail = [];
    for (const g of rows) {
        let o, c;
        try { o = JSON.parse(g.opening_odds); c = JSON.parse(g.closing_odds); } catch { continue; }
        if (!o?.captured_at || !c?.captured_at) continue;
        const openAfterFix = new Date(o.captured_at) > new Date(T_ODDS_BACKFILL_FIX + 'Z');
        const dt = new Date(c.captured_at) - new Date(o.captured_at);
        detail.push({
            id: g.id, sport: g.sport, date: g.date,
            open: o.captured_at, close: c.captured_at,
            delta_seconds: Math.round(dt / 1000),
            relation: dt > 0 ? 'closing_after_opening' : dt === 0 ? 'IDENTICAL_TIMESTAMP' : 'closing_BEFORE_opening',
            identical_moneyline: JSON.stringify(o.moneyline) === JSON.stringify(c.moneyline),
            identical_whole_blob: g.opening_odds === g.closing_odds,
            counted_by_check1: openAfterFix,
        });
    }
    const counted = detail.filter(d => d.counted_by_check1);
    out.findings.pair_shape = {
        rows_scanned: rows.length,
        with_both_timestamps: detail.length,
        counted_by_check1: counted.length,
        relation_tally: counted.reduce((a, d) => (a[d.relation] = (a[d.relation] || 0) + 1, a), {}),
        identical_whole_blob: counted.filter(d => d.identical_whole_blob).length,
        sample: counted.slice(0, 10),
    };

    // ── 2. WHICH writer produced those closing values? ──────────────────────
    // Three writers can set closing_odds: the nightly backfill
    // (.github/scripts/odds-backfill.js, change_log source 'odds_backfill'),
    // AmbientDO's pre->live hook (source 'closing_odds_capture'), and the
    // /archive/game route. Only the hook can ever produce a genuinely
    // sequenced pair. If the failing rows were all written by the backfill,
    // check 1 is measuring a population the fix was never meant to sequence.
    const bySource = await d1(
        `SELECT source, field, COUNT(*) AS n,
                MIN(ts) AS first_ts, MAX(ts) AS last_ts
         FROM change_log
         WHERE field IN ('opening_odds','closing_odds')
         GROUP BY source, field
         ORDER BY last_ts DESC`);
    out.findings.writers_all_time = bySource;

    const bySourceSinceFix = await d1(
        `SELECT source, field, COUNT(*) AS n, MAX(ts) AS last_ts
         FROM change_log
         WHERE field IN ('opening_odds','closing_odds') AND ts > ?
         GROUP BY source, field ORDER BY last_ts DESC`, [T_ODDS_BACKFILL_FIX]);
    out.findings.writers_since_fix = bySourceSinceFix;

    // THE POSITIVE CONTROL. If AmbientDO's hook has NEVER written a single
    // closing_odds row in all of history, then no sequenced pair can exist
    // anywhere, the fix has never actually been exercised, and check 1 is
    // failing on the absence of the hook rather than on a defect in the
    // backfill gate. "No new bad rows" is vacuous without knowing whether
    // the good writer ever ran -- the same trap the gNN guard fell into.
    const hookEver = bySource.find(r => r.source === 'closing_odds_capture' && r.field === 'closing_odds');
    out.findings.ambient_hook_has_ever_fired = hookEver ? { fired: true, ...hookEver } : { fired: false };

    // ── 3. Does a sequenced pair exist ANYWHERE, at any date? ───────────────
    // Scoped to the fix window, check 1 sees only recent rows. Ask the whole
    // table: has this system ever once recorded closing strictly after
    // opening? A global zero and a windowed zero mean very different things.
    const anySeq = await d1(
        `SELECT id, sport, date,
                json_extract(opening_odds,'$.captured_at') AS o_at,
                json_extract(closing_odds,'$.captured_at') AS c_at
         FROM regular_season_games
         WHERE opening_odds IS NOT NULL AND closing_odds IS NOT NULL
           AND json_extract(closing_odds,'$.captured_at') >
               json_extract(opening_odds,'$.captured_at')
         ORDER BY date DESC LIMIT 10`);
    out.findings.sequenced_pairs_anywhere = { count: anySeq.length, sample: anySeq };

    // ── 4. The La Liga row that failed check 2, by name ─────────────────────
    // Check 2 failed at n=1: one La Liga fixture, zero with an opening line.
    // A rate over a single row is not a coverage measurement, but the row
    // itself is still worth reading -- if its opening_odds is NULL, the
    // question is whether the alias resolved and the Odds API simply had no
    // event, or whether the join missed. Team names come back so the resolver
    // can be run against them offline.
    const soccer = await d1(
        `SELECT id, sport, date, home, away, finalized_at,
                opening_odds IS NOT NULL AS has_open,
                closing_odds IS NOT NULL AS has_close
         FROM regular_season_games
         WHERE sport IN ('EPL','La Liga','Ligue 1','Serie A','Bundesliga','MLS')
           AND date > date(?)
         ORDER BY date DESC, sport LIMIT 60`, [T_ALIASES_COMPLETE.slice(0, 10)]);
    out.findings.soccer_rows_since_aliases = {
        total: soccer.length,
        by_sport: soccer.reduce((a, r) => {
            const k = r.sport;
            a[k] = a[k] || { games: 0, finalized: 0, with_open: 0 };
            a[k].games++;
            if (r.finalized_at) a[k].finalized++;
            if (r.has_open) a[k].with_open++;
            return a;
        }, {}),
        rows: soccer,
    };

    // ── 5. Is La Liga covered at all, over a window with real sample size? ──
    // The 11.8% baseline was measured over history. Check 2's post-fix window
    // holds one row. Re-measure over the last 30 days so the comparison has a
    // denominator that can carry a rate -- without this, check 2 is reporting
    // noise as a regression.
    const laligaWindow = await d1(
        `SELECT sport, COUNT(*) AS games,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_open
         FROM regular_season_games
         WHERE sport IN ('EPL','La Liga')
           AND date >= date('now','-30 day') AND finalized_at IS NOT NULL
         GROUP BY sport`);
    out.findings.soccer_30day_window = laligaWindow.map(r => ({
        ...r, pct: r.games ? Math.round(1000 * r.with_open / r.games) / 10 : null,
    }));

    out.query_ok = true;
} catch (e) { out.error = String(e.message || e); }

const stamp = out.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const path = `outbox/diagnose-staged-fails-${stamp}.json`;
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
console.log(`\nwrote ${path}`);
if (!out.query_ok) { console.error('\nD1 QUERIES FAILED — nothing below is established.'); process.exit(1); }
