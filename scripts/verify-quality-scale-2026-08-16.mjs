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
// One implementation, and this time nothing to pass it wrong: it takes the rows.
import { CONTRACT, missingContractFields, total, invariants }
  from './lib/summary-invariants.mjs';
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
    // Era 6 emptied this list: Dim 10 stopped reading a note 99.5% of non-golf
    // rows lack and started reading the result, so a game brief now reaches every
    // dimension. The assertion is unchanged because both sides derive from
    // source; only its NAME was wrong once "matchup" stopped being a SCALE key.
    assert(`game shape drops ${UNREACHABLE_DIMS_GAME.length ? UNREACHABLE_DIMS_GAME.join(', ') : 'nothing'}`,
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

    // ── What briefs actually score ─────────────────────────────────────────
    //
    // THIS BLOCK PUBLISHED AN ARITHMETIC IMPOSSIBILITY TWICE, AND PASSED:
    //
    //   quality-scale-verify-20260822T234307Z  briefs_counted: 0  cleared_196: 61  all_passed: true
    //   quality-scale-verify-20260823T145535Z  briefs_counted: 0  cleared_196: 66  all_passed: true
    //
    // Zero briefs counted, and sixty-six of them cleared 196. The cause was one
    // line:
    //
    //   n: x.n ?? x.count ?? null          // then Number(n) || 0, then summed
    //
    // /quality/report serves `total` and `scored`. It has never served `n` or
    // `count`, so both guesses missed and `n` was null on all 48 rows. `??`
    // dressed the unknown as a deliberate value; `|| 0` made it arithmetic; the
    // sum over 48 erased unknowns is indistinguishable from a real zero.
    //
    // THE NULL WAS THE ONLY HONEST THING IN THE BLOCK. `n: null` correctly said
    // "I do not know". Two operators laundered it into a confident 0, and none
    // of the eleven assertions read the field, so nothing objected for two days.
    //
    // Worse, this is the probe that was meant to decide the 110-vs-240 question
    // -- its own note said so -- and it informed that judgement with a
    // denominator of zero. That question was ultimately settled by measuring
    // runQualityChain directly (scoreThreshold turned out to be read by nothing
    // and was deleted 2026-08-24), which is the only reason this did not bite.
    //
    // So: no coalescing between a missing field and an aggregate. The contract
    // is asserted, the read is direct, and the totals must reconcile.
    // Rule 60: the relay owns these names. If one moves, this must go RED, not
    // silently null -- which is the entire defect above, stated as an assertion.
    const missingFields = missingContractFields(rows);
    assert('every summary row carries the fields this probe reads',
           missingFields.length === 0,
           missingFields.length ? `absent from at least one row: ${missingFields.join(', ')}`
                                : `all of ${CONTRACT.join(', ')}`);

    out.summary = rows.map((x) => ({
        brief_type: x.brief_type, sport: x.sport,
        // `scored` is the right denominator: briefs that HAVE a quality_score.
        // `total` includes unscored rows, which cannot clear any bar.
        scored: x.scored, total: x.total,
        avg: x.avg_score,
        cleared_196: x.cleared_196, above_240: x.above_240, below_240: x.below_240,
    }));
    const tot = (k) => total(out.summary, k);
    const scored = tot('scored'), c196 = tot('cleared_196'), a240 = tot('above_240');
    out.score_reality = {
        rows: out.summary.length,
        briefs_counted: scored.sum,
        cleared_196: c196.sum,
        above_240: a240.sum,
        // Every total says how many rows it could not read. `0 (48 skipped)` and
        // `0 (0 skipped)` are different findings and used to look identical.
        skipped: { scored: scored.skipped, cleared_196: c196.skipped, above_240: a240.skipped },
        note: 'Reported, not asserted on: this probe cannot know what the bar SHOULD be. It reports what briefs actually score.',
    };

    // ── The invariants that would have caught it on day one. ───────────────
    // Same function scripts/check-aggregate-launders-unknowns.mjs replays the
    // two published artifacts through, so "these would have caught it" is a
    // demonstrated fact rather than a claim about code nobody ran.
    for (const inv of invariants(out.summary)) assert(inv.name, inv.pass, inv.detail);
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
