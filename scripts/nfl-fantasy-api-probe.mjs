// Does NFL Fantasy expose an open JSON API the way FPL does?
//
// FPL's fantasy.premierleague.com/api/bootstrap-static/ is a genuinely public,
// unauthenticated JSON endpoint — a front door the Premier League leaves open on
// purpose, and FIELD already consumes its NFL-analog pattern elsewhere. The
// question here is whether fantasy.nfl.com has the same: an endpoint that returns
// stat JSON to an anonymous GET, by design.
//
// IMPORTANT SCOPE — what this can and cannot be:
//   * A fantasy API returns BOX-SCORE-derived stats (yards, TDs, targets, fantasy
//     points). It does NOT carry NGS player-TRACKING data (speed, separation,
//     x/y). So this is not, and cannot be, a "side door" to the gated tracking
//     feed — that data simply isn't in a fantasy payload. It is only ever a
//     source of conventional stats.
//   * Every request below is an anonymous GET. No cookie, token, or credential is
//     sent, minted, or replayed. An endpoint that answers 200 without auth is
//     public by construction; one that 401/403s is gated and we stop there — we
//     do not try to get past it.
//
// The FPL control at the end proves the probe itself works (that endpoint is
// known-open), so a 401 from an NFL endpoint means "gated", not "probe broken".

const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0; +https://github.com/jeffunglesbee-create/field-relay-nba)';

const TARGETS = [
  // Historic public NFL fantasy JSON surfaces (the FPL-equivalent candidates).
  ['fantasy players (v2 current week)', 'https://api.fantasy.nfl.com/v2/players/weekstats?season=2024&week=1'],
  ['fantasy players (v1 research)',     'https://api.fantasy.nfl.com/v1/players/stats?statType=seasonStats&season=2024&format=json'],
  ['fantasy players list (v1)',         'https://api.fantasy.nfl.com/v1/players/researchinfo?format=json'],
  ['fantasy game (players/ownership)',  'https://api.fantasy.nfl.com/v2/players/ownership?season=2024&week=1'],
  ['flags api (seen in the page)',      'https://flags.api.nfl.com/api/v1/'],
  // FPL control — known-open, proves the probe works.
  ['FPL bootstrap (CONTROL, open)',     'https://fantasy.premierleague.com/api/bootstrap-static/'],
];

(async () => {
  console.log(`=== nfl-fantasy-api-probe  utc=${new Date().toISOString()} ===`);
  console.log('anonymous GETs only — no cookie/token sent; a 401/403 means gated and we stop there\n');
  for (const [label, url] of TARGETS) {
    const rec = { label, url };
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      const ct = r.headers.get('content-type') || '';
      const body = await r.text();
      let shape = '', rows = null;
      if (/json/i.test(ct)) {
        try {
          const j = JSON.parse(body);
          const top = Array.isArray(j) ? `array[${j.length}]` : Object.keys(j).slice(0, 8).join(',');
          // Try to find a players/stats array to report a count.
          const arr = Array.isArray(j) ? j
            : j.players || j.games?.[0]?.players || j.elements || null;
          rows = Array.isArray(arr) ? arr.length : null;
          shape = top;
        } catch { shape = 'unparseable-json'; }
      } else {
        shape = ct.split(';')[0];
      }
      const gate = r.status === 401 || r.status === 403 ? '  ← GATED (stop)' : '';
      console.log(`  ${String(r.status).padEnd(4)} ${ct.slice(0, 24).padEnd(26)} ${String(body.length).padStart(8)}b  rows=${rows ?? '-'}  ${label}${gate}`);
      if (r.status === 200 && shape) console.log(`         shape: ${shape}`);
    } catch (e) {
      console.log(`  ERR   ${label}  (${e.message})`);
    }
  }
  console.log('\nRead: any 200 with a players/stats array = a genuinely open NFL fantasy source.');
  console.log('BUT box-score stats only — never NGS tracking. If all NFL rows are 401/403,');
  console.log('the FPL-style open door does not exist for NFL fantasy and there is nothing to force.');
  process.exit(0);
})();

// ── Appendix: dump the shape of the one endpoint that answered 200 ──────────
// So the "open door" is characterized by real structure, not just a status code.
(async () => {
  const url = 'https://api.fantasy.nfl.com/v2/players/weekstats?season=2024&week=1';
  console.log('\n=== shape of the open v2/players/weekstats endpoint ===');
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FIELD-probe', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const j = JSON.parse(await r.text());
    const seen = [];
    (function walk(o, pfx) {
      if (seen.length >= 3 || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        if (o.length && o[0] && typeof o[0] === 'object' && (o[0].id || o[0].name || o[0].stats)) {
          seen.push({ path: pfx, count: o.length, sampleKeys: Object.keys(o[0]).slice(0, 14), sample: o[0] });
        }
        return;
      }
      for (const k of Object.keys(o)) walk(o[k], pfx + '.' + k);
    })(j, '$');
    console.log('top keys:', Object.keys(j).join(','));
    for (const s of seen) {
      console.log(`\narray at ${s.path}: ${s.count} items`);
      console.log('  keys:', s.sampleKeys.join(', '));
      console.log('  sample[0]:', JSON.stringify(s.sample).slice(0, 400));
    }
    if (!seen.length) console.log('no id/name/stats array found — dumping nested keys:\n',
      JSON.stringify(j, (k, v) => (Array.isArray(v) && v.length > 3 ? `[array ${v.length}]` : v)).slice(0, 800));
  } catch (e) { console.log('shape probe error:', e.message); }
  process.exit(0);
})();
