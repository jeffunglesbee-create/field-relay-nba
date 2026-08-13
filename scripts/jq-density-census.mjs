// CC-CMD-2026-08-13-jq-density-unit-fix — DONE CONDITION measurement.
//
// Measures Dim 4 (Density) BOTH ways over the real `mlb_game` corpus, before
// and after the unit change, plus the achievable ceiling and the above_240
// question. Runs on a GitHub runner: this sandbox's proxy 403s *.workers.dev.
//
// The corpus is pulled FRESH from D1 via /d1/execute (`briefs` is in that
// route's ALLOWED_TABLES) rather than read from field-laboratory's committed
// snapshot. Rule 72 — the snapshot is an inherited artifact, and the
// authoritative table is one query away.
//
// EVERY constant below was read from HEAD, not from the CC-CMD (Rule 87 /
// TASK 0), because that document quotes sha 597f410 and warns its own line
// numbers drift:
//
//   src/journalism-quality.js:372-373  properNouns / numbersAll tokenizers
//   src/journalism-quality.js:418-419  rawDensity + taper
//   src/journalism-quality.js:424      W = {spec:30,statDepth:38,variety:30,density:16,fresh:36}
//   src/index.js:12606                 below_240 := SQL `quality_score < 240`
//
// Dim 4 is reproduced here rather than imported because `scoreProse` is async
// and calls Datamuse 5x per brief; at n≈600 that is ~3000 external requests
// with a 2s timeout each (Rule 78). Dim 4 is four lines of pure arithmetic
// with no network, so replicating it exactly is both faithful and cheap — and
// the delta it produces is the WHOLE delta, since this change touches no other
// dimension.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const BRIEF_TYPE = process.env.BRIEF_TYPE || 'mlb_game';
const TS = new Date().toISOString();

// The 6aed3bb deploy that created the SECOND scoring era. Briefs written
// before it were scored under the previous formula, so their stored scores are
// not comparable to later ones — the discontinuity TASK 3 is about.
const ERA2_CUTOVER = '2026-07-16T01:36:49Z';

async function d1(sql) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await r.json();
  if (!r.ok || b.success === false) throw new Error(`d1 ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

// ── Dim 4, both units. Tokenizers copied verbatim from journalism-quality.js.
function dim4(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const sentences = String(text).split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 3);
  const nSent = Math.max(1, sentences.length);
  const sentStarts = new Set(sentences.map((s) => s.split(/\s+/)[0]));
  const properNouns = words.filter((w) => /^[A-Z]/.test(w) && !sentStarts.has(w) && w.length > 1);
  const numbersAll = words.filter((w) => /\d/.test(w));

  const taper = (raw) => Math.max(0, Math.min(1, 1 - Math.abs(raw - 1) * 0.5));
  const rawShipped = (properNouns.length + numbersAll.length) / nSent;  // current
  const rawNumbers = numbersAll.length / nSent;                          // TASK 1
  return {
    nSent,
    properNouns: properNouns.length,
    numbers: numbersAll.length,
    rawShipped, rawNumbers,
    densityShipped: taper(rawShipped),
    densityNumbers: taper(rawNumbers),
  };
}

const W_DENSITY = 16;                 // src/journalism-quality.js:424
const CEILING_FULL = 300;             // 150 base + 45 + 25 + 20 + 30 + 30
const CEILING_RELAY = 245;            // Dims 7 (25) and 10 (30) are N/A without opts.game / matchupNote

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

(async () => {
  const out = { ts: TS, briefType: BRIEF_TYPE, era2Cutover: ERA2_CUTOVER };
  try {
    // brief_text / quality_score / date are the real column names
    // (src/index.js:5658 INSERT and 12598 report query).
    const rows = await d1(
      `SELECT id, date, brief_text, quality_score, word_count
         FROM briefs
        WHERE brief_type = '${BRIEF_TYPE}' AND brief_text IS NOT NULL
        ORDER BY date`);
    out.corpusSize = rows.length;
    if (!rows.length) throw new Error(`no briefs for brief_type=${BRIEF_TYPE}`);

    const scored = [];
    for (const r of rows) {
      const d = dim4(r.brief_text);
      if (!d) continue;
      scored.push({
        id: r.id, date: r.date, stored: r.quality_score,
        era: r.date < ERA2_CUTOVER.slice(0, 10) ? 'pre' : 'post',
        ...d,
        // Points this dimension contributes, before vs after the unit change.
        ptsShipped: d.densityShipped * W_DENSITY,
        ptsNumbers: d.densityNumbers * W_DENSITY,
      });
    }
    out.scoredCount = scored.length;

    const bucket = (name, set) => ({
      name, n: set.length,
      // DONE CONDITION 1 — floored percentage before and after.
      flooredShippedPct: pct(set.filter((x) => x.densityShipped === 0).length, set.length),
      flooredNumbersPct: pct(set.filter((x) => x.densityNumbers === 0).length, set.length),
      meanPtsShipped: Math.round(mean(set.map((x) => x.ptsShipped)) * 100) / 100,
      meanPtsNumbers: Math.round(mean(set.map((x) => x.ptsNumbers)) * 100) / 100,
      meanRawShipped: Math.round(mean(set.map((x) => x.rawShipped)) * 100) / 100,
      meanNumbersPerSent: Math.round(mean(set.map((x) => x.rawNumbers)) * 100) / 100,
      minRawShipped: Math.round(Math.min(...set.map((x) => x.rawShipped)) * 100) / 100,
      // The rule's own governed quantity: how many briefs exceed 1 number per
      // sentence badly enough that the rule WOULD flag them ("3+ numbers in a
      // sentence is a box score with verbs").
      overThreeNumbersPerSentPct: pct(set.filter((x) => x.rawNumbers >= 3).length, set.length),
      storedMean: Math.round(mean(set.filter((x) => x.stored != null).map((x) => x.stored)) * 10) / 10,
      storedMax: set.filter((x) => x.stored != null).length
        ? Math.max(...set.filter((x) => x.stored != null).map((x) => x.stored)) : null,
    });

    out.all = bucket('all', scored);
    out.pre = bucket('pre-6aed3bb', scored.filter((x) => x.era === 'pre'));
    out.post = bucket('post-6aed3bb', scored.filter((x) => x.era === 'post'));

    // DONE CONDITION 2 — the achievable ceiling, with its arithmetic.
    out.ceiling = {
      full: CEILING_FULL,
      relayPath: CEILING_RELAY,
      note: 'relay path excludes Dim 7 (25, needs opts.game) and Dim 10 (30, needs opts.matchupNote)',
      // A dimension that is floored for ~9 briefs in 10 is effectively absent
      // from the reachable maximum for those briefs.
      relayPathWithDensityFloored: CEILING_RELAY - W_DENSITY,
    };

    // DONE CONDITION 3 — is above_240 reachable at all? Answered from STORED
    // scores (what /quality/report actually counts) rather than a rescore,
    // because below_240 is computed in SQL over the stored column
    // (src/index.js:12606). A rescore would answer a different question.
    const withScore = scored.filter((x) => x.stored != null);
    out.above240 = {
      n: withScore.length,
      storedAbove240: withScore.filter((x) => x.stored >= 240).length,
      storedMax: withScore.length ? Math.max(...withScore.map((x) => x.stored)) : null,
      postEraAbove240: withScore.filter((x) => x.era === 'post' && x.stored >= 240).length,
      postEraMax: withScore.filter((x) => x.era === 'post').length
        ? Math.max(...withScore.filter((x) => x.era === 'post').map((x) => x.stored)) : null,
    };

    // The headline: how many points the unit change returns, on average.
    out.delta = {
      meanPointsReturned: Math.round((out.all.meanPtsNumbers - out.all.meanPtsShipped) * 100) / 100,
      flooredPctDrop: Math.round((out.all.flooredShippedPct - out.all.flooredNumbersPct) * 10) / 10,
    };

    console.log(JSON.stringify(
      { corpusSize: out.corpusSize, scoredCount: out.scoredCount,
        all: out.all, pre: out.pre, post: out.post,
        ceiling: out.ceiling, above240: out.above240, delta: out.delta }, null, 2));
  } catch (e) {
    out.error = String(e.stack || e.message || e);
    console.error('census failed:', out.error);
  }

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/jq-density-census-${TS.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
})();
