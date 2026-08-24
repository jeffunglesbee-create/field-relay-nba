#!/usr/bin/env node
// Does the 300-point quality scale REWARD a fabricated statistic?
//
// Measured locally 2026-08-23 on the brief that prompted
// CC-CMD-2026-08-22-brief-sport-contamination:
//   "Everton maintains a 107.7 DRTG, best in the NBA, despite playing soccer
//    tonight."                                            scoreProse -> 165
//   the same brief with the invented stat replaced by a true one
//                                                          scoreProse -> 128
// EPL briefs average 141.4, so the contaminated version scored ABOVE the
// average and the truthful one BELOW it. Dim 2 (statDepth) counts numeric+unit
// patterns and `107.7 DRTG` is in its own match list at journalism-quality.js
// :253. Nothing in the scale asks whether the number is real.
//
// n=1 is an anecdote. This runs it across the live corpus.
//
// Sandbox egress 403s *.workers.dev; a runner does not. Read-only: GET
// /quality/report and GET /archive/query only.

import { writeFileSync } from 'node:fs';
import { total } from './lib/summary-invariants.mjs';
import { PROMPT_EXAMPLE_LITERALS } from '../src/journalism-quality.js';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DAYS = 7;
const PAGE = 50;                       // /archive/query hard-caps limit at 50

const FOREIGN = /\b(?:NBA|NHL|NFL|MLB|WNBA|DRTG|ORTG)\b/;
const SOCCER = /^(?:epl|la ?liga|mls|seriea|serie a|bundesliga|ligue ?1|uefa|ucl|wc26|wc)$/i;
const NUMERIC = /\b\d+(?:\.\d+)?%?\b/g;

const get = async (path) => {
  const r = await fetch(`${RELAY}${path}`, { headers: { 'User-Agent': UA } });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
};
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r1 = x => x == null ? null : Math.round(x * 10) / 10;

const out = {
  probed_at: new Date().toISOString(), days: DAYS,
  fetch_ok: false, error: null,
  corpus: { expected: null, window: null, collected: 0, scored: 0, recovered_by_sport_split: 0, truncated_partitions: [] },
  unambiguous: null, proxy: null, mechanism: null, mechanism_reading: null, verdict: null,
};

try {
  // 1. The report gives the partition keys AND the denominator, so truncation
  //    is measurable rather than assumed.
  const report = await get(`/quality/report?days=${DAYS}`);
  const summary = report.summary || [];
  // `total()` rather than `n + (r.total || 0)`: the coalescing form turns a row
  // missing `total` into a zero contribution, and a denominator built that way
  // is indistinguishable from a genuinely small corpus. That exact shape
  // published `briefs_counted: 0` beside `cleared_196: 66` twice
  // (outbox/quality-scale-verify-2026082{2,3}*.json, both all_passed: true).
  // `skipped` is asserted on below so a short read is a finding, not a number.
  const expectedTot = total(summary, 'total');
  out.corpus.expected = expectedTot.sum;
  out.corpus.expected_rows_unreadable = expectedTot.skipped;
  if (expectedTot.skipped > 0) throw new Error(
    `/quality/report returned ${expectedTot.skipped} of ${summary.length} summary rows with no numeric \`total\` — ` +
    `the corpus denominator cannot be computed and must not be guessed`);
  const types = [...new Set(summary.map(r => r.brief_type).filter(Boolean))];

  // Walk the report's OWN window, not a locally derived one. /quality/report
  // filters `date >= since` where since is DAYS days back, which spans DAYS+1
  // distinct dates; a `today - i for i in 0..DAYS-1` walk covers only DAYS of
  // them and silently skips the oldest. Run 2 collected 388 of an expected 461
  // with zero capped partitions -- the missing 73 were 2026-08-16, counted in
  // the denominator and never queried. Deriving both ends from `since` makes
  // expected and collected reconcile.
  const since = report.since || new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const dates = [];
  for (let d = new Date(`${since}T00:00:00Z`); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  out.corpus.window = { since, dates: dates.length };

  const seen = new Map();
  for (const date of dates) {
    for (const bt of types) {
      const q = `/archive/query?date=${date}&brief_type=${encodeURIComponent(bt)}&limit=${PAGE}`;
      let d; try { d = await get(q); } catch (e) { out.corpus.truncated_partitions.push(`${date}/${bt}: ${e.message}`); continue; }
      for (const row of d.results || []) seen.set(row.id, row);
      // A full page means rows were dropped. /archive/query has no offset, so
      // the only way to see past the cap is to narrow the query -- re-walk the
      // partition one sport at a time. The first run lost 83 of 460 rows to
      // exactly two capped partitions (08-22/game_live, 08-20/game_recap), and
      // those are the partitions a contaminated soccer brief lives in, so the
      // gap sat precisely where the effect would show.
      if ((d.results || []).length === PAGE) {
        const sports = [...new Set(summary.filter(r => r.brief_type === bt)
          .map(r => r.sport).filter(Boolean))];
        let recovered = 0;
        for (const sp of sports) {
          const sq = `/archive/query?date=${date}&brief_type=${encodeURIComponent(bt)}` +
                     `&sport=${encodeURIComponent(sp)}&limit=${PAGE}`;
          let sd; try { sd = await get(sq); } catch { continue; }
          for (const row of sd.results || []) { if (!seen.has(row.id)) recovered++; seen.set(row.id, row); }
          if ((sd.results || []).length === PAGE)
            out.corpus.truncated_partitions.push(`${date}/${bt}/${sp}: still at ${PAGE}-row cap`);
        }
        out.corpus.recovered_by_sport_split = (out.corpus.recovered_by_sport_split || 0) + recovered;
      }
    }
  }

  const rows = [...seen.values()];
  out.corpus.collected = rows.length;
  const scored = rows.filter(r => typeof r.quality_score === 'number' && r.brief_text);
  out.corpus.scored = scored.length;

  // 2. UNAMBIGUOUS: a soccer brief naming a non-soccer league or a basketball
  //    rating metric is wrong by construction. No judgement call.
  const soccer = scored.filter(r => SOCCER.test(String(r.sport || '').trim()));
  const dirty = soccer.filter(r => FOREIGN.test(r.brief_text));
  const clean = soccer.filter(r => !FOREIGN.test(r.brief_text));
  out.unambiguous = {
    what: 'soccer briefs naming NBA/NHL/NFL/MLB/WNBA/DRTG/ORTG vs soccer briefs that do not',
    contaminated: { n: dirty.length, mean_score: r1(mean(dirty.map(r => r.quality_score))) },
    clean:        { n: clean.length, mean_score: r1(mean(clean.map(r => r.quality_score))) },
    delta: null,
  };
  if (dirty.length && clean.length) {
    out.unambiguous.delta = r1(mean(dirty.map(r => r.quality_score)) - mean(clean.map(r => r.quality_score)));
  }

  // 3. PROXY, labelled as such: a brief carrying a tracked prompt literal. The
  //    original prompt is not stored, so 2f's context discriminator cannot be
  //    reapplied — a real 37-goal side would land here too. Directional only.
  const lit = scored.filter(r => PROMPT_EXAMPLE_LITERALS.some(l => r.brief_text.includes(l)));
  const nolit = scored.filter(r => !PROMPT_EXAMPLE_LITERALS.some(l => r.brief_text.includes(l)));
  out.proxy = {
    caveat: 'prompt not stored; cannot apply 2f context check. A genuine figure matching a tracked literal counts as flagged.',
    with_literal: { n: lit.length, mean_score: r1(mean(lit.map(r => r.quality_score))) },
    without:      { n: nolit.length, mean_score: r1(mean(nolit.map(r => r.quality_score))) },
    delta: (lit.length && nolit.length)
      ? r1(mean(lit.map(r => r.quality_score)) - mean(nolit.map(r => r.quality_score))) : null,
  };

  // 4. MECHANISM: score against raw numeral count. If Dim 2 pays for density
  //    regardless of truth, more numbers should mean more points.
  const buckets = {};
  for (const r of scored) {
    const n = (r.brief_text.match(NUMERIC) || []).length;
    const k = n >= 12 ? '12+' : n >= 8 ? '8-11' : n >= 4 ? '4-7' : n >= 1 ? '1-3' : '0';
    (buckets[k] ||= []).push(r.quality_score);
  }
  out.mechanism = Object.fromEntries(['0', '1-3', '4-7', '8-11', '12+']
    .filter(k => buckets[k]).map(k => [k, { n: buckets[k].length, mean_score: r1(mean(buckets[k])) }]));

  // MIN_N exists because of this repo's own precedent, five days old: the
  // 2026-08-22 session found soccer_opening_coverage "was the probe's fault --
  // it called a regression off a single fixture", and added a 4-game floor that
  // holds small samples at PENDING. The first run of THIS probe made the same
  // mistake in the same week: it printed CONFIRMED off n=2, which is not a
  // corpus result, it is the two briefs the CC-CMD already quoted.
  const MIN_N = 8;
  const u = out.unambiguous.delta;
  const nDirty = out.unambiguous.contaminated.n;
  out.verdict =
    u == null ? 'INCONCLUSIVE — one side of the unambiguous split is empty on this corpus.'
    : nDirty < MIN_N ? `PENDING — only ${nDirty} contaminated soccer brief(s) in ${DAYS} days ` +
        `(floor is ${MIN_N}). Observed delta ${u >= 0 ? '+' : ''}${u}, directional only. ` +
        `Three commits deployed 2026-08-23 remove this contamination at the source, so this ` +
        `group should shrink toward zero and may never reach the floor — in which case the ` +
        `mechanism split below, which needs no contamination judgement, is the standing evidence.`
    : u > 0 ? `CONFIRMED — contaminated soccer briefs score ${u} points HIGHER on average (n=${nDirty}).`
    : `NOT CONFIRMED — contaminated soccer briefs score ${u} points relative to clean (n=${nDirty}).`;

  // The mechanism split is the load-bearing one: it needs no judgement about
  // whether a figure is true, only how many figures a brief carries.
  const m = out.mechanism;
  if (m['0'] && m['1-3']) {
    out.mechanism_reading = `having ANY figure is worth ${r1(m['1-3'].mean_score - m['0'].mean_score)} ` +
      `points over having none (${m['0'].mean_score} -> ${m['1-3'].mean_score}). Stacking more is not ` +
      `linearly rewarded${m['12+'] ? ` — the 12+ bucket falls back to ${m['12+'].mean_score}` : ''}. ` +
      `This measures FORM, not truth: it cannot distinguish a real figure from an ` +
      `invented one, and a controlled test on 2026-08-23 showed it does not need to — ` +
      `see below.`;
    // CORRECTION, 2026-08-23. An earlier version of this line ended "the pressure a
    // thin-context brief feels is therefore to invent ONE number, not many." That
    // inference does not survive a control.
    //
    // It came from one pair: the Everton brief scored 165 with its invented
    // "107.7 DRTG" and 128 with a true stat in its place. But the true version read
    // "a third clean sheet in four" — worded, no digit — so the pair varied TWO
    // things at once, fabrication and surface form, and the gap was attributed to
    // the wrong one.
    //
    // Holding form constant, three fabricated/real pairs scored 165/161, 153/140
    // and 154/152 — a mean gap near 6 on a 300-point scale. Against that, the same
    // fact as a digit rather than a word is worth 161 vs 128, and any figure versus
    // none is worth 26 to 59. The scale rewards NUMERALS OVER WORDS. It barely
    // notices whether the numeral is true.
    //
    // Which means these buckets are a real measurement of form and a bad proxy for
    // fabrication pressure. Reported as the former.
  }
  out.fetch_ok = true;
} catch (e) {
  out.error = e.message;
}

const stamp = out.probed_at.replace(/[:.]/g, '-');
writeFileSync(`outbox/2f-score-bias-${stamp}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!out.fetch_ok) process.exit(1);
