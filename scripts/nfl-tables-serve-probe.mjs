// nfl-tables-serve-probe.mjs — confirm the P2 NFL tables actually serve 200 from
// the live relay /nflverse/ route (R2-first). Runs on a GH runner (sandbox 403s
// *.workers.dev). Rule 61 E2E: a client consumer is only real if the file serves.
const R = 'https://field-relay-nba.jeffunglesbee.workers.dev/nflverse';
const files = ['team-participation.json', 'snap-counts.json', 'depth-charts.json', 'team_epa.json'];
let fail = 0;
for (const f of files) {
  try {
    const r = await fetch(`${R}/${f}`);
    const src = r.headers.get('x-source') || '(github)';
    let rows = '?';
    if (r.ok) { try { const j = await r.json(); rows = Object.keys(j.data || {}).length; } catch {} }
    const ok = r.status === 200 && rows !== '?' && rows > 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${f}  HTTP ${r.status}  src=${src}  rows=${rows}`);
    if (!ok) fail++;
  } catch (e) { console.log(`  FAIL  ${f}  ${e.message}`); fail++; }
}
console.log(`\n== RESULT: ${files.length - fail}/${files.length} serve non-empty ==`);
process.exit(fail > 0 ? 1 : 0);
