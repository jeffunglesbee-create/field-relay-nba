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
  corpus: { expected: null, collected: 0, scored: 0, truncated_partitions: [] },
  unambiguous: null, proxy: null, mechanism: null, verdict: null,
};

try {
  // 1. The report gives the partition keys AND the denominator, so truncation
  //    is measurable rather than assumed.
  const report = await get(`/quality/report?days=${DAYS}`);
  const summary = report.summary || [];
  out.corpus.expected = summary.reduce((n, r) => n + (r.total || 0), 0);
  const types = [...new Set(summary.map(r => r.brief_type).filter(Boolean))];

  const dates = Array.from({ length: DAYS }, (_, i) =>
    new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));

  const seen = new Map();
  for (const date of dates) {
    for (const bt of types) {
      const q = `/archive/query?date=${date}&brief_type=${encodeURIComponent(bt)}&limit=${PAGE}`;
      let d; try { d = await get(q); } catch (e) { out.corpus.truncated_partitions.push(`${date}/${bt}: ${e.message}`); continue; }
      for (const row of d.results || []) seen.set(row.id, row);
      // No silent caps: a full page means rows may have been dropped.
      if ((d.results || []).length === PAGE) out.corpus.truncated_partitions.push(`${date}/${bt}: hit ${PAGE}-row cap`);
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

  const u = out.unambiguous.delta;
  out.verdict = u == null
    ? 'INCONCLUSIVE — one side of the unambiguous split is empty on this corpus.'
    : u > 0
      ? `CONFIRMED — contaminated soccer briefs score ${u} points HIGHER on average. The scale pays for the fabrication.`
      : `NOT CONFIRMED — contaminated soccer briefs score ${u} points relative to clean ones.`;
  out.fetch_ok = true;
} catch (e) {
  out.error = e.message;
}

const stamp = out.probed_at.replace(/[:.]/g, '-');
writeFileSync(`outbox/2f-score-bias-${stamp}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!out.fetch_ok) process.exit(1);
