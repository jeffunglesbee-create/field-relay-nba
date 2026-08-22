#!/usr/bin/env node
// Combined verification for the three staged items from 2026-08-21/22.
// Read-only. Dispatch this on any matchday; it answers all three at once.
//
// WHY ONE PROBE: three separate fixes shipped with three separate "verify on the
// next fixture" notes. Three ad-hoc queries later is how staged items rot into
// orphans (Rule 74). This makes verifying them a single run.
//
// THE DESIGN RULE THAT MATTERS: every check reports PASS, FAIL or **PENDING**,
// and PENDING is never PASS. A check with no qualifying data yet has proved
// nothing. This session already caught one vacuous test — the gNN guard looked
// green only because no client writes had happened since the fix — and the fix
// was to demand a positive control. Same discipline here: each check states how
// many qualifying rows it found, and returns PENDING at zero.
//
// Baselines are the deploy commit times, so a row that predates the fix can
// never be counted as evidence for it.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Deploy baselines (git commit times, UTC).
const T_ODDS_BACKFILL_FIX = '2026-08-21 22:40:09';  // 887c843 closing_odds date gate
const T_ALIASES_COMPLETE  = '2026-08-21 23:24:27';  // bb04fc8 last alias commit
const T_FPL_EVENTS        = '2026-08-22 00:20:10';  // eb02ac7 fpl_match_events corrected

// Measured pre-fix baselines, so "improved" is a comparison and not a vibe.
const BASELINE = { EPL: 23.1, 'La Liga': 11.8 };

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

const m = { probed_at: new Date().toISOString(), query_ok: false, checks: [], error: null };
const add = (c) => m.checks.push(c);

try {
    // ── 1. Does closing now come AFTER opening? ─────────────────────────────
    // The defect was one snapshot written to both columns, so closing's
    // captured_at landed at or BEFORE opening's. Only games whose odds were
    // written after the date gate shipped can testify.
    // CORRECTED after the first run. The filter was `date >= date(fix)`, which
    // is the GAME's date, not when its odds were written. Games dated
    // 2026-08-21 were priced at 10:00 that morning -- twelve hours BEFORE the
    // 22:40 deploy -- so eighteen pre-fix rows qualified and the check reported
    // FAIL for a defect that had already been fixed. The fix cannot be judged by
    // rows it never touched.
    //
    // Two gates now: the game is dated strictly after the fix date, AND its
    // opening capture timestamp is genuinely after the deploy. The second is
    // the real test; the first just keeps the scan small.
    //
    // SPORT FILTER REMOVED 2026-08-22, and this was a real gap. The first
    // version restricted to ('MLB','WNBA','NBA','NHL') because those were the
    // sports I expected the fix to unblock. The live desk then showed today's
    // EPL fixtures rendering "open/close NOT SEQUENCED" -- the exact defect --
    // while this check reported PENDING, because soccer was excluded from the
    // query. A check that cannot see the failing case is worse than no check:
    // it reports calm. The fix applies to every sport, so the query now does
    // too.
    const seq = await d1(
        `SELECT id, sport, date, opening_odds, closing_odds
         FROM regular_season_games
         WHERE opening_odds IS NOT NULL AND closing_odds IS NOT NULL
           AND date > date(?)
         ORDER BY date DESC LIMIT 40`, [T_ODDS_BACKFILL_FIX.slice(0, 10)]);

    const seqRows = [];
    for (const g of seq) {
        let o, c;
        try { o = JSON.parse(g.opening_odds); c = JSON.parse(g.closing_odds); } catch { continue; }
        if (!o?.captured_at || !c?.captured_at) continue;
        // The decisive gate: odds written before the deploy cannot testify
        // about it, whatever the game's date says.
        if (new Date(o.captured_at) <= new Date(T_ODDS_BACKFILL_FIX + 'Z')) continue;
        const sequenced = new Date(c.captured_at) > new Date(o.captured_at);
        seqRows.push({
            id: g.id, sport: g.sport,
            open: o.captured_at, close: c.captured_at,
            sequenced,
            // Identical values are the other half of the old defect: one
            // snapshot in two columns. A real pair may legitimately be equal if
            // the market never moved, so this is reported, not failed on.
            identical_moneyline: JSON.stringify(o.moneyline) === JSON.stringify(c.moneyline),
        });
    }
    const sequencedCount = seqRows.filter(r => r.sequenced).length;
    add({
        id: 'closing_after_opening',
        what: 'closing_odds.captured_at > opening_odds.captured_at on games priced after the date gate',
        qualifying_rows: seqRows.length,
        status: seqRows.length === 0 ? 'PENDING — no game has been priced since the fix'
              : sequencedCount === seqRows.length ? 'PASS'
              : sequencedCount === 0 ? 'FAIL — every pair is still non-sequenced'
              : `PARTIAL — ${sequencedCount}/${seqRows.length} sequenced`,
        sequenced: sequencedCount,
        sample: seqRows.slice(0, 6),
    });

    // ── 2. Has soccer opening-odds coverage risen? ──────────────────────────
    // Compared against the measured pre-fix rate, and only over games dated
    // after the aliases landed. A rate computed over all history would be
    // dominated by the months the aliases were missing.
    // CORRECTED after the first run, and this is the SECOND time today the same
    // mistake has been made: the denominator included FUTURE fixtures. MLS is
    // pre-seeded months ahead, so 326 unplayed rows with legitimately no
    // opening line reported as 0% coverage. Only games that have actually been
    // played can carry an opening line, so only those count.
    //
    // Also `date >` rather than `>=`, for the same reason as check 1: a fixture
    // dated the day the aliases landed was priced that morning, before them.
    //
    // CORRECTED AGAIN 2026-08-22: `date < date('now')` excluded TODAY's games,
    // and today is the only day with fixtures since the aliases landed -- so the
    // check reported PENDING while a full EPL matchday sat in the table. Played
    // is a property of the game, not of the calendar: gate on finalized_at.
    const cov = await d1(
        `SELECT sport, COUNT(*) AS games,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_open
         FROM regular_season_games
         WHERE sport IN ('EPL','La Liga','Ligue 1','MLS')
           AND date > date(?) AND finalized_at IS NOT NULL
         GROUP BY sport`, [T_ALIASES_COMPLETE.slice(0, 10)]);
    const covRows = cov.map(r => ({
        sport: r.sport, games: r.games, with_open: r.with_open,
        pct: r.games ? Math.round(1000 * r.with_open / r.games) / 10 : null,
        baseline_pct: BASELINE[r.sport] ?? null,
    }));
    const measurable = covRows.filter(r => r.games > 0);
    const improved = measurable.filter(r => r.baseline_pct != null && r.pct > r.baseline_pct);
    const regressed = measurable.filter(r => r.baseline_pct != null && r.pct < r.baseline_pct);
    add({
        id: 'soccer_opening_coverage',
        what: 'EPL / La Liga opening-odds coverage above the pre-fix baseline (23.1% / 11.8%)',
        qualifying_rows: measurable.reduce((s, r) => s + r.games, 0),
        status: !measurable.length ? 'PENDING — no soccer fixture since the aliases landed'
              : regressed.length ? `FAIL — coverage fell for ${regressed.map(r => r.sport).join(', ')}`
              : improved.length ? `PASS — improved for ${improved.map(r => r.sport).join(', ')}`
              : 'PENDING — fixtures exist but none carry a baseline sport yet',
        per_sport: covRows,
    });

    // ── 3. Does an EPL brief actually name a player? ────────────────────────
    // The ask's own artifact. Weakened deliberately from "a player who appears
    // in that fixture's stats" to a two-stage report: first, do EPL briefs
    // exist since the deploy at all; second, do they contain the block's
    // fingerprint. A join against FPL stats needs the fixture payload, which
    // this D1-only probe cannot reach — so what cannot be proved here is
    // reported as UNPROVEN rather than quietly claimed.
    const briefs = await d1(
        `SELECT id, brief_type, created_at, LENGTH(brief_text) AS len,
                CASE WHEN brief_text LIKE '%through 0 matches%'
                       OR brief_text LIKE '%0 points through%' THEN 1 ELSE 0 END AS season_template,
                substr(brief_text, 1, 220) AS excerpt
         FROM briefs
         WHERE sport = 'EPL' AND created_at > ?
         ORDER BY created_at DESC LIMIT 10`, [T_FPL_EVENTS]);
    add({
        id: 'epl_brief_event_grounded',
        what: 'an EPL brief written since fpl_match_events deployed, no longer a season-stat template',
        qualifying_rows: briefs.length,
        status: briefs.length === 0 ? 'PENDING — no EPL brief written since the deploy'
              : briefs.every(b => b.season_template) ? 'FAIL — every new EPL brief is still the season template'
              : 'PASS — at least one new EPL brief is not the season template',
        note: 'Player-name-against-fixture-stats is NOT asserted here: that join needs the FPL payload, which this D1-only probe does not fetch. Read the excerpts.',
        sample: briefs.map(b => ({ id: b.id, created_at: b.created_at, len: b.len,
            season_template: !!b.season_template, excerpt: b.excerpt })),
    });

    m.query_ok = true;
} catch (e) { m.error = String(e.message || e); }

m.summary = m.checks.map(c => `${c.id}: ${c.status}`);
m.all_passed = m.query_ok && m.checks.length === 3 && m.checks.every(c => String(c.status).startsWith('PASS'));
m.any_failed = m.checks.some(c => String(c.status).startsWith('FAIL'));

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/staged-verification-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
console.log('\n── SUMMARY ──');
for (const line of m.summary) console.log('  ' + line);

if (!m.query_ok) { console.error('\nD1 QUERIES FAILED — this says nothing about any of the three.'); process.exit(1); }
// A real regression fails the run. PENDING does not: nothing has been proved
// wrong, only not yet proved right, and failing on that would train the habit
// of ignoring this probe's exit code.
if (m.any_failed) { console.error('\nA staged item REGRESSED — see the FAIL above.'); process.exit(1); }
process.exit(0);
