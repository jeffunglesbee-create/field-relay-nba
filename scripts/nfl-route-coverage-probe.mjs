// What does the relay ACTUALLY serve for NFL today?
//
// Closes an open item the NFL-B NGS pipeline doc (Drive, 2026-06-11) left
// unticked since June: "Verify ngs-receiving + ngs-rushing are served correctly
// from relay R2 (probe /nflverse/ngs-receiving.json to confirm R2 hit or outbox
// fallback)." Never done. Everything below is measured, not read from a doc.
//
// It also tests a specific asymmetry found by reading src/index.js at HEAD.
// The /nflverse/ handler has TWO gates:
//
//   NFL_R2_FILES  (~L15791) — tried first, served straight from R2 if present
//   NFLVERSE_OUT_ALLOWED (~L731) — the fallback allow-list for GitHub raw
//
// `ngs-passing.json` is in the FIRST list but NOT the second. Its two siblings
// (`ngs-receiving`, `ngs-rushing`) are in both. So passing is served only while
// the R2 object exists; on an R2 miss it falls through to the allow-list check
// and 403s, even though outbox/nfl/ngs-passing.json exists in the repo and is
// fresh (committed 2026-08-12).
//
// That predicts a specific, falsifiable difference, which is what makes it
// worth probing rather than asserting:
//   - if R2 is populated: passing returns 200 with X-Source: r2, same as siblings
//   - if R2 is empty:     siblings still 200 (via GitHub raw), passing 403s alone
//
// Either way the single point of failure is real; the probe establishes which
// state we are in today. NGS passing is the CPOE/QB table — the doc's own
// Section 4 calls CPOE the best single-game QB metric.
//
// Read-only. GETs only.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// Every file either list mentions, plus the six Stage-1 tables from the
// nflverse design spec, so the output doubles as a coverage map.
const FILES = [
  // NFL-B pipeline (files that exist in outbox/nfl today)
  'ngs-passing.json', 'ngs-receiving.json', 'ngs-rushing.json', 'nfl-injuries.json',
  'epa_table.json',
  // R2-only per NFL_R2_FILES — no outbox equivalent
  'player-stats.json', 'pfr-rec.json',
  // Stage-1 tables from the nflverse relay-fetch design spec (May 27)
  'team_epa.json', 'qb_metrics.json', 'receiver_metrics.json',
  'defense_metrics.json', 'schedule_refs.json', 'team_tendencies.json',
  // Big Data Bowl (Phase 4)
  'bdb_route_entropy.json', 'bdb_xblock_pass_rush.json',
  'bdb_tendency_fingerprint.json', 'bdb_separation.json',
];

(async () => {
  console.log(`=== nfl-route-coverage-probe  relay=${RELAY}  utc=${new Date().toISOString()} ===\n`);
  console.log('  status  source        bytes    file');
  const rows = [];
  for (const f of FILES) {
    const rec = { file: f };
    try {
      const r = await fetch(`${RELAY}/nflverse/${f}`, { signal: AbortSignal.timeout(30000) });
      rec.status = r.status;
      rec.source = r.headers.get('X-Source') || r.headers.get('x-source') || '';
      rec.relayError = r.headers.get('X-RELAY-Error') || '';
      const t = await r.text();
      rec.bytes = t.length;
      // A 200 that is not JSON is a different failure from a 403, so record it.
      if (r.status === 200) {
        try {
          const j = JSON.parse(t);
          rec.topLevel = Array.isArray(j) ? `array[${j.length}]` : Object.keys(j).slice(0, 4).join(',');
          rec.season = j?.season ?? j?.[0]?.season ?? null;
        } catch { rec.notJson = true; }
      }
    } catch (e) { rec.error = String(e.message || e); }
    rows.push(rec);
    console.log(`  ${String(rec.status ?? 'ERR').padEnd(6)}  ${String(rec.source || rec.relayError || '-').padEnd(12)}  ${String(rec.bytes ?? '-').padStart(7)}  ${f}`);
  }

  const ok = rows.filter(r => r.status === 200);
  const forbidden = rows.filter(r => r.status === 403);
  const served = new Set(ok.map(r => r.file));

  console.log(`\nserved (200): ${ok.length}/${rows.length}`);
  console.log(`403 not-whitelisted: ${forbidden.map(r => r.file).join(', ') || '(none)'}`);

  // The specific asymmetry under test.
  const passing = rows.find(r => r.file === 'ngs-passing.json');
  const siblings = rows.filter(r => ['ngs-receiving.json', 'ngs-rushing.json'].includes(r.file));
  const siblingsOk = siblings.every(r => r.status === 200);
  console.log(`\nngs-passing status=${passing?.status} source=${passing?.source || passing?.relayError || '-'}`);
  console.log(`ngs-receiving/rushing both 200: ${siblingsOk}`);
  console.log(passing?.status === 200 && passing?.source === 'r2'
    ? '=> R2 IS populated, so passing is served today — but it has NO GitHub-raw fallback '
      + 'the way its siblings do. An R2 miss or a failed weekly update takes it to 403 alone. '
      + 'Adding it to NFLVERSE_OUT_ALLOWED is a one-line change.'
    : passing?.status === 403
      ? '=> CONFIRMED BROKEN TODAY: passing 403s while its siblings serve, exactly as the '
        + 'missing NFLVERSE_OUT_ALLOWED entry predicts. outbox/nfl/ngs-passing.json exists and is fresh.'
      : `=> UNEXPECTED (status ${passing?.status}) — investigate before concluding anything.`);

  // Stage-1 coverage, against the design spec's own six-table list.
  const stage1 = ['team_epa.json', 'qb_metrics.json', 'receiver_metrics.json',
                  'defense_metrics.json', 'schedule_refs.json', 'team_tendencies.json'];
  console.log(`\nnflverse Stage-1 tables served: ${stage1.filter(f => served.has(f)).length}/6`);
  console.log(`  missing: ${stage1.filter(f => !served.has(f)).join(', ') || '(none)'}`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
