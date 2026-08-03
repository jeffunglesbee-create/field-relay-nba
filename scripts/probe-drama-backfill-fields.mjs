// CC-CMD-2026-08-03-fix-drama-backfill-situational-fields TASK 1 probe.
// Fetches a real MLB event's play-by-play via the relay's own /espn-summary
// proxy (same path drama-backfill.mjs uses) and dumps the real, current key
// shape of a play object -- confirms whether situational fields
// (outs/onFirst/onSecond/onThird/balls/strikes) are nested under
// `situation` or live top-level on the play object itself. Also checks a
// real WNBA event for the same class of dependency (WNBA's own fetcher
// currently reads no situational fields at all -- confirming that's really
// true against a live shape, not just the code as written).
//
// Also runs a real D1 query via /d1/execute to identify which
// regular_season_games/postseason_games rows were written by the buggy
// Node backfill script specifically -- the real, structural signal: the
// backfill script's drama_arc is a bare JSON ARRAY of numbers
// (`states.map(dramaScoreLive(...))`), while every client write path
// (live in-game AND client-side backfill, both via computeDramaRetroactive
// in field.js) always writes drama_arc as a JSON OBJECT with keys like
// peak/samples/classification. This is a real, checkable shape difference,
// not a heuristic guess.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// Real, live MLB event already confirmed today per the CC-CMD doc.
const MLB_EVENT_ID = '401696639';

async function probeMLB() {
  console.log('=== MLB play-by-play shape probe (event ' + MLB_EVENT_ID + ') ===');
  const url = `${RELAY}/espn-summary/sports/baseball/mlb/summary?event=${MLB_EVENT_ID}`;
  const res = await fetch(url);
  console.log('HTTP', res.status);
  if (!res.ok) { console.log('FAILED:', await res.text()); return; }
  const data = await res.json();
  const plays = data.plays || [];
  console.log('plays.length =', plays.length);
  if (!plays.length) { console.log('NO PLAYS -- cannot confirm shape'); return; }

  // Find a play mid-game with actual base-runner/count state, not just the first.
  const sample = plays.find(p => p.outs != null || p.situation != null) || plays[Math.floor(plays.length / 2)];
  console.log('sample play top-level keys:', Object.keys(sample).sort());
  console.log('sample.situation:', JSON.stringify(sample.situation ?? '<<undefined>>'));
  console.log('sample.outs (top-level):', sample.outs);
  console.log('sample.balls (top-level):', sample.balls);
  console.log('sample.strikes (top-level):', sample.strikes);
  console.log('sample.onFirst (top-level):', sample.onFirst);
  console.log('sample.onSecond (top-level):', sample.onSecond);
  console.log('sample.onThird (top-level):', sample.onThird);
  console.log('full sample play JSON:', JSON.stringify(sample, null, 2).slice(0, 2000));
}

// Real WNBA event to confirm current fetcher's situational-field claim.
const WNBA_EVENT_ID = process.env.WNBA_EVENT_ID || null;

async function probeWNBA() {
  console.log('\n=== WNBA play-by-play shape probe ===');
  if (!WNBA_EVENT_ID) {
    console.log('No real WNBA_EVENT_ID provided -- skipping live probe. Code-inspection finding: ' +
      'fetchWNBAHistoricalStates only reads homeScore/awayScore/period/clock, no situational fields ' +
      'at all, so there is no situation-path bug class to probe for regardless of ESPN shape.');
    return;
  }
  const url = `${RELAY}/espn-summary/sports/basketball/wnba/summary?event=${WNBA_EVENT_ID}`;
  const res = await fetch(url);
  console.log('HTTP', res.status);
  if (!res.ok) { console.log('FAILED:', await res.text()); return; }
  const data = await res.json();
  const plays = data.plays || [];
  if (!plays.length) { console.log('NO PLAYS'); return; }
  console.log('sample play top-level keys:', Object.keys(plays[Math.floor(plays.length / 2)]).sort());
}

// Real D1 query to identify buggy-script-written rows via drama_arc shape.
async function queryD1() {
  console.log('\n=== D1 real row-count query (drama_arc shape signal) ===');
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM regular_season_games WHERE sport='MLB' AND drama_peak IS NOT NULL) AS reg_mlb_total,
      (SELECT COUNT(*) FROM postseason_games    WHERE sport='MLB' AND drama_peak IS NOT NULL) AS post_mlb_total,
      (SELECT COUNT(*) FROM regular_season_games WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc LIKE '[%') AS reg_mlb_array_shape,
      (SELECT COUNT(*) FROM postseason_games    WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc LIKE '[%') AS post_mlb_array_shape,
      (SELECT COUNT(*) FROM regular_season_games WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc LIKE '{%') AS reg_mlb_object_shape,
      (SELECT COUNT(*) FROM postseason_games    WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc LIKE '{%') AS post_mlb_object_shape
  `;
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql }),
  });
  console.log('HTTP', res.status);
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

async function main() {
  await probeMLB();
  await probeWNBA();
  await queryD1();
}

main().catch(e => { console.error('PROBE ERROR:', e); process.exit(1); });
