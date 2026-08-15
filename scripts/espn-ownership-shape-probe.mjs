// PRE-BUILD probe (Rule 68) for wiring ESPN fantasy ownership into the relay.
//
// The relay's relayFetch caches on a URL-ONLY key (src/cache-helpers.js:31,
// `new Request(targetUrl)` — no headers in the key). ESPN's fantasy player
// endpoint is normally driven by an `x-fantasy-filter` HEADER, which would make
// every filtered request collide on one cache entry. So the design question this
// probe answers is concrete: can ownership be driven entirely by URL query params
// (so relayFetch's URL key is correct), and what does the payload look like?
//
// Tests, all anonymous GETs to lm-api-reads.fantasy.espn.com:
//   1. view=kona_player_info  — the ownership-bearing view, NO filter header
//   2. same, WITH a small filter header — to see if the header is required
//   3. view=players_wl        — the lean universe view (control, already 200)
// For each: status, bytes, player count, and whether an `ownership` object with a
// real percentOwned is actually present.

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2024/players';
const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0)';

const get = async (label, url, hdr = {}) => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...hdr }, signal: AbortSignal.timeout(30000) });
    const body = await r.text();
    const rec = { label, status: r.status, bytes: body.length, ms: Date.now() - t0, ct: r.headers.get('content-type') || '' };
    try {
      const j = JSON.parse(body);
      const arr = Array.isArray(j) ? j : (j.players || []);
      rec.players = Array.isArray(arr) ? arr.length : null;
      // Find the first entry that actually carries ownership.
      const withOwn = (Array.isArray(arr) ? arr : []).find(p => (p.ownership || p.player?.ownership));
      const own = withOwn?.ownership || withOwn?.player?.ownership;
      if (own) {
        rec.ownershipKeys = Object.keys(own).slice(0, 10);
        rec.samplePercentOwned = own.percentOwned;
        rec.sampleName = withOwn.fullName || withOwn.player?.fullName;
      } else {
        rec.ownershipPresent = false;
      }
    } catch { rec.notJson = true; rec.head = body.slice(0, 140); }
    return rec;
  } catch (e) { return { label, error: e.message, ms: Date.now() - t0 }; }
};

(async () => {
  console.log(`=== espn-ownership-shape-probe  utc=${new Date().toISOString()} ===\n`);

  const results = [];
  // 1. ownership view, URL-only (the thing we WANT to work)
  results.push(await get('kona URL-only',
    `${BASE}?scoringPeriodId=0&view=kona_player_info`));
  // 2. ownership view WITH a filter header (limit 5), to compare
  results.push(await get('kona + filter header',
    `${BASE}?scoringPeriodId=0&view=kona_player_info`,
    { 'x-fantasy-filter': JSON.stringify({ players: { limit: 5, sortPercOwned: { sortAsc: false, sortPriority: 1 } } }) }));
  // 3. lean universe view, URL-only (control)
  results.push(await get('players_wl URL-only',
    `${BASE}?scoringPeriodId=0&view=players_wl`));

  for (const r of results) {
    console.log(`── ${r.label}`);
    if (r.error) { console.log(`   ERROR ${r.error}\n`); continue; }
    console.log(`   status=${r.status} bytes=${r.bytes} ms=${r.ms} players=${r.players ?? '-'}`);
    if (r.ownershipKeys) {
      console.log(`   ownership keys: ${r.ownershipKeys.join(', ')}`);
      console.log(`   sample: ${r.sampleName} percentOwned=${r.samplePercentOwned}`);
    } else if (r.ownershipPresent === false) {
      console.log(`   ownership: NOT present in this view`);
    } else if (r.notJson) {
      console.log(`   non-JSON: ${r.head}`);
    }
    console.log();
  }

  // The verdict that drives the build decision.
  const konaUrl = results[0];
  console.log('=== BUILD DECISION ===');
  if (konaUrl.status === 200 && konaUrl.ownershipKeys) {
    console.log(`URL-ONLY WORKS: kona_player_info returns ownership without a filter header.`);
    console.log(`→ a relayFetch passthrough is correct (URL-only cache key is sound).`);
    console.log(`  payload ${(konaUrl.bytes/1024).toFixed(0)}KB for ${konaUrl.players} players`
      + (konaUrl.bytes > 500000 ? ' — LARGE; consider a transform route that emits {id: percentOwned} instead of proxying raw.' : '.'));
  } else if (konaUrl.status === 200 && konaUrl.ownershipPresent === false) {
    console.log('kona_player_info 200 but NO ownership without the filter header → ownership needs the header,');
    console.log('which relayFetch cannot key on. Build a dedicated route that sets the header server-side and');
    console.log('emits a small {id: percentOwned} table, OR pre-process to R2. Do NOT proxy verbatim.');
  } else {
    console.log(`kona URL-only returned ${konaUrl.status} — investigate before building.`);
  }
  process.exit(0);
})();
