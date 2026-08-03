// CC-CMD-2026-08-03-fix-drama-backfill-situational-fields TASK 4 real
// verification: confirms drama_peak values across the MLB leaderboard are
// no longer collapsed to a small set of flat repeated values, and that
// drama_arc shows genuine situational variation.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function main() {
  const res = await fetch(`${RELAY}/archive/drama/leaderboard?sport=MLB&limit=50`);
  console.log('HTTP', res.status);
  const data = await res.json();
  const games = data.games || []; // real confirmed shape: {ok, sport, season, limit, games:[{...,drama_arc (raw TEXT)}]}
  console.log('games returned:', games.length);

  const peaks = games.map(g => g.drama_peak);
  const uniquePeaks = new Set(peaks);
  console.log('unique drama_peak values among top', games.length, ':', uniquePeaks.size);
  console.log('peak distribution (first 20):', peaks.slice(0, 20));

  // Check arc variation for the top 5. drama_arc is raw TEXT from D1 (JSON string).
  for (const g of games.slice(0, 5)) {
    let arc = null;
    try { arc = JSON.parse(g.drama_arc); } catch { arc = null; }
    console.log(`  ${g.home} vs ${g.away} (${g.date}) drama_peak=${g.drama_peak} arc_type=${Array.isArray(arc) ? 'array' : typeof arc} arc_sample=${JSON.stringify(arc).slice(0,150)}`);
  }
}

main().catch(e => { console.error('VERIFY ERROR:', e); process.exit(1); });
