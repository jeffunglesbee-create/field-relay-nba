// bdb-access-probe.mjs — verify whether NFL Big Data Bowl tracking data (P3) is
// reachable WITHOUT Kaggle credentials (Rule 72: verify the "needs Kaggle" claim).
// Runs on a GH runner (unrestricted egress). Tries the Kaggle download endpoints
// and a few candidate public mirrors; reports status for each.
const targets = [
  ['kaggle-competition-download', 'https://www.kaggle.com/api/v1/competitions/data/download-all/nfl-big-data-bowl-2025'],
  ['kaggle-dataset-download',     'https://www.kaggle.com/api/v1/datasets/download/nfl-big-data-bowl-2025'],
  ['nflverse-releases-tracking',  'https://github.com/nflverse/nflverse-data/releases/download/tracking/tracking_2025.parquet'],
  ['nflverse-pbp-participation',  'https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_2024.parquet'],
];
for (const [name, url] of targets) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual' });
    console.log(`  ${name}: HTTP ${r.status} ${r.headers.get('content-type')||''} loc=${r.headers.get('location')||''}`.slice(0,160));
  } catch (e) { console.log(`  ${name}: ERROR ${e.message}`); }
}
console.log('\n== Conclusion: any non-4xx GET above = a public route to tracking-ish data ==');
