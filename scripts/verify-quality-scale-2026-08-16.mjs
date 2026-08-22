#!/usr/bin/env node
// Runs the DONE CONDITION that outbox/cc-session-2026-08-16-quality-bar-scale.md
// wrote for itself and then could not execute.
//
// That session shipped the derived quality scale (SCALE / NOMINAL_TOTAL /
// REACHABLE_CEILING / FOUR_FIFTHS_REACHABLE) and the cleared_196 column, wrote an
// explicit Rule 90 artifact for verifying them live, and marked the result
// UNVERIFIED because its sandbox 403s *.workers.dev. It has sat unrun for six
// days. `rule-gha-for-sandbox-egress-blocks` is explicit that sandbox egress is
// not an acceptable stopping point when a runner has unrestricted egress, so
// this runs the session's own assertions from CI rather than restating them.
//
// The assertions are taken verbatim from that doc, not re-derived:
//   quality_scale.reachable_ceiling === 245
//   every summary row carries a numeric cleared_196
//
// SECOND PURPOSE, and the reason this is worth running today: the same response
// reports what briefs actually SCORE. Two relay enqueue sites still pass
// scoreThreshold: 110 (src/index.js:8855, the per-game brief path that writes
// every EPL game_live/game_recap, and :7337 wc-morning) against a documented
// standard of 240. Whether 110 is a deliberate choice for queue-generated briefs
// or a fossil predating the standard cannot be settled by reading the code —
// neither site carries a comment. The score distribution is the evidence.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const out = { probed_at: new Date().toISOString(), fetch_ok: false, error: null,
              assertions: [], quality_scale: null, summary: null };
const assert = (name, pass, detail) => out.assertions.push({ name, pass, detail });

try {
    const r = await fetch(`${RELAY}/quality/report?days=7`, { headers: { 'User-Agent': UA } });
    const body = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 300)}`);
    const d = JSON.parse(body);
    out.fetch_ok = true;
    out.quality_scale = d.quality_scale ?? null;

    // ── The Aug 16 session's own two assertions, verbatim ───────────────────
    assert('quality_scale present', !!d.quality_scale, d.quality_scale ? 'present' : 'MISSING — ask 1 did not deploy');
    assert('reachable_ceiling === 245', d.quality_scale?.reachable_ceiling === 245,
           `got ${JSON.stringify(d.quality_scale?.reachable_ceiling)}`);

    const rows = Array.isArray(d.summary) ? d.summary : [];
    assert('summary rows returned', rows.length > 0, `${rows.length} rows`);
    const missing196 = rows.filter(x => typeof x.cleared_196 !== 'number');
    assert('every row carries numeric cleared_196', rows.length > 0 && missing196.length === 0,
           missing196.length ? `${missing196.length} row(s) missing it` : `all ${rows.length} rows`);

    // ── The 110-vs-240 evidence ────────────────────────────────────────────
    // Reported, never asserted on: this probe cannot know what the bar SHOULD be.
    // It reports what briefs actually score so the question stops being a guess.
    out.summary = rows.map(x => ({
        brief_type: x.brief_type, sport: x.sport, n: x.n ?? x.count ?? null,
        avg: x.avg_score ?? x.avg ?? null,
        cleared_196: x.cleared_196, above_240: x.above_240, below_240: x.below_240,
    }));
    const tot = (k) => out.summary.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    const n = tot('n');
    out.score_reality = {
        rows: out.summary.length,
        briefs_counted: n,
        cleared_196: tot('cleared_196'),
        above_240: tot('above_240'),
        // The point of the comparison: if briefs cluster far below even 196, a
        // 110 threshold is not obviously wrong — it may be the only bar the
        // queue path can clear. If they cluster above it, 110 is doing nothing.
        note: 'Reported only. Whether scoreThreshold 110 at src/index.js:8855 is deliberate or a fossil is a judgement this probe informs, not one it makes.',
    };
} catch (e) { out.error = String(e.message || e); }

out.all_passed = out.fetch_ok && out.assertions.length > 0 && out.assertions.every(a => a.pass);

const stamp = out.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const path = `outbox/quality-scale-verify-${stamp}.json`;
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
console.log(`\nwrote ${path}\n── ASSERTIONS ──`);
for (const a of out.assertions) console.log(`  ${a.pass ? 'PASS' : 'FAIL'}  ${a.name}  (${a.detail})`);
if (out.error) { console.error(`\nFETCH FAILED — nothing above is established: ${out.error}`); process.exit(1); }
if (!out.all_passed) { console.error('\nThe 2026-08-16 done condition does NOT hold.'); process.exit(1); }
console.log('\nThe 2026-08-16 done condition holds.');
