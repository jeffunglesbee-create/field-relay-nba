// One-shot script: fetch current FIFA rankings for all WC26 teams.
// Run via GitHub Actions (relay is blocked from CC bash egress).
// Output: JSON blob of { teamName: rank } for use in model fitting.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

const TEAMS = [
  'Algeria','Argentina','Australia','Austria','Belgium',
  'Bosnia-Herzegovina','Brazil','Canada','Cape Verde','Colombia',
  'Congo DR','Croatia','Curaçao','Czechia','Ecuador','Egypt',
  'England','France','Germany','Ghana','Haiti','Iran','Iraq',
  'Ivory Coast','Japan','Jordan','Mexico','Morocco','Netherlands',
  'New Zealand','Norway','Panama','Paraguay','Portugal','Qatar',
  'Saudi Arabia','Scotland','Senegal','South Africa','South Korea',
  'Spain','Sweden','Switzerland','Tunisia','Türkiye',
  'United States','Uruguay','Uzbekistan',
];

async function main() {
  const results = {};
  const failed = [];
  for (const team of TEAMS) {
    try {
      const res = await fetch(`${RELAY}/fifa-rankings/${encodeURIComponent(team)}`);
      if (!res.ok) { failed.push(`${team} HTTP ${res.status}`); results[team] = null; continue; }
      const data = await res.json();
      results[team] = data.rank ?? null;
      console.error(`  ${team} → rank ${data.rank} (${data.points} pts)`);
    } catch (e) {
      failed.push(`${team}: ${e.message}`);
      results[team] = null;
    }
  }
  console.log('RANK_DATA=' + JSON.stringify(results));
  if (failed.length) console.error('FAILED:', failed);
}

main().catch(e => { console.error(e); process.exit(1); });
