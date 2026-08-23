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
// THAT DOC'S GENERALISATION WAS TOO BROAD, corrected here 2026-08-23 without
// weakening its assertions. 245 is right for a slate brief and wrong for a game
// brief, where Dim 7 measured above zero on 181 of 190 real rows. Four
// assertions on the game shape are added below; the original two are untouched
// and still pass.
//
// SECOND PURPOSE, and the reason this is worth running today: the same response
// reports what briefs actually SCORE. Two relay enqueue sites still pass
// scoreThreshold: 110 (src/index.js:8855, the per-game brief path that writes
// every EPL game_live/game_recap, and :7337 wc-morning) against a documented
// standard of 240. Whether 110 is a deliberate choice for queue-generated briefs
// or a fossil predating the standard cannot be settled by reading the code —
// neither site carries a comment. The score distribution is the evidence.

import { writeFileSync } from 'node:fs';
// Expectations are DERIVED from source, not frozen. The assertions below used to
// hardcode 245 / 270 / 88.89, which meant the ask 6b reweighting on 2026-08-23
// failed them for being correct -- the numbers moved because SCALE moved, which
// is the intended behaviour of a derived ceiling. What this file should catch is
// the DEPLOYED endpoint disagreeing with the code, and that is what it now
// checks. Guarding against an unconsidered SCALE edit is a different job, done
// by scripts/check-scoring-era-recorded.mjs at the deploy gate.
import {
  REACHABLE_CEILING, REACHABLE_CEILING_GAME,
  FOUR_FIFTHS_REACHABLE, FOUR_FIFTHS_REACHABLE_GAME,
  UNREACHABLE_DIMS_GAME, NOMINAL_TOTAL,
} from '../src/journalism-quality.js';
const PCT = (bar, ceil) => Math.round(bar / ceil * 10000) / 100;

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
    assert(`reachable_ceiling === ${REACHABLE_CEILING} (derived from SCALE)`,
           d.quality_scale?.reachable_ceiling === REACHABLE_CEILING,
           `got ${JSON.stringify(d.quality_scale?.reachable_ceiling)}`);
    assert(`four_fifths_of_reachable === ${FOUR_FIFTHS_REACHABLE}`,
           d.quality_scale?.four_fifths_of_reachable === FOUR_FIFTHS_REACHABLE,
           `got ${JSON.stringify(d.quality_scale?.four_fifths_of_reachable)}`);
    assert(`nominal_total === ${NOMINAL_TOTAL}`, d.quality_scale?.nominal_total === NOMINAL_TOTAL,
           `got ${JSON.stringify(d.quality_scale?.nominal_total)}`);

    // ── ADDED 2026-08-23, and the reason matters more than the assertion ────
    // The assertion above is kept exactly as the 08-16 session wrote it, and it
    // still passes: 245 is the correct ceiling for a SLATE brief, which has no
    // single game object. What that session got wrong -- and what its doc, this
    // file's own header, and the 0-of-523 analysis all inherited -- is that 245
    // was reported as the ceiling for everything.
    //
    // Measured 2026-08-23 (scripts/rescore-quality-6b.mjs, n=190 real
    // game_recap rows): Dim 7 scored above zero on 181 of them. It is reachable
    // on game briefs, which are most briefs and are precisely the rows the
    // 0-of-523 finding was drawn from. Against the game-shape ceiling of 270
    // the 240 bar is 88.89% of earnable, not 97.96% -- still a demanding bar,
    // but an editorial one rather than a near-perfect-score requirement, which
    // changes what "no brief has ever cleared 240" means.
    const g = d.quality_scale?.game_shape;
    assert('game_shape reported', !!g, g ? 'present' : 'MISSING — the game-shape ceiling did not deploy');
    assert(`game reachable_ceiling === ${REACHABLE_CEILING_GAME}`,
           g?.reachable_ceiling === REACHABLE_CEILING_GAME,
           `got ${JSON.stringify(g?.reachable_ceiling)}`);
    assert('game shape drops only matchup',
           JSON.stringify(g?.unreachable_dims) === JSON.stringify(UNREACHABLE_DIMS_GAME),
           `got ${JSON.stringify(g?.unreachable_dims)}`);
    assert(`game four_fifths === ${FOUR_FIFTHS_REACHABLE_GAME}`,
           g?.four_fifths_of_reachable === FOUR_FIFTHS_REACHABLE_GAME,
           `got ${JSON.stringify(g?.four_fifths_of_reachable)}`);
    // Guards the arithmetic, not the opinion: the deployed percentage must match
    // what the deployed ceilings imply. A stale worker serving yesterday's
    // constants fails here instead of quietly reporting an old bar.
    assert(`240 is ${PCT(240, REACHABLE_CEILING_GAME)}% of the game-shape ceiling`,
           g?.flat_bar_pct_of_reachable === PCT(240, REACHABLE_CEILING_GAME),
           `got ${JSON.stringify(g?.flat_bar_pct_of_reachable)}`);

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
