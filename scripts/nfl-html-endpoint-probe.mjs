// Are the two saved NFL pages actually fetchable data sources, or just DOM dumps?
//
// Two HTML pages were saved from a browser and inspected. Neither contains an
// API: no /api/prod path, no GraphQL, no __NEXT_DATA__, no self.__next_f, no
// window.__STATE__, no Apollo cache, no tokens. The data lives in <table> markup.
//
// That does NOT establish it is fetchable. A browser "save page" serializes the
// LIVE DOM, so client-rendered rows appear in the file even when the server
// returned an empty shell. Assuming otherwise is exactly the mistake this probe
// exists to avoid. The two pages give opposite predictions:
//
//   NGS (nextgenstats.nfl.com) — Vue SPA. Markers: id="app", data-vue-meta,
//     no data-* on the table itself. PREDICT: raw GET returns a shell, no rows.
//     Its real API is /api/prod/... which the 2026-06-11 investigation recorded
//     as OAuth-gated (HTTP 401 from every IP incl. the relay) — not in this file.
//
//   NFL.com /stats/team-stats — jQuery/RequireJS stack (NFLHeader, NFLToken,
//     oidcLoggedInChecker, main.js), NO React/Next data payload anywhere.
//     PREDICT: server-rendered, so a raw GET returns the full table.
//
// If the NFL.com prediction holds it is a real, free, no-auth source of OFFICIAL
// team totals with a season selector back to 2002 — something the nflverse path
// does not provide at all, and without its 8-day lag.
//
// NOTE (Rule 45 — no legal verdicts): whether scraping these pages is permitted
// under NFL.com terms is NOT decided here. This probe establishes technical
// reachability only. Flag for human review before anything is wired to it.
//
// Read-only. GETs only, one per URL.

const TARGETS = [
  { label: 'ngs-top-plays (Vue SPA — expect shell)',
    url: 'https://nextgenstats.nfl.com/stats/top-plays/fastest-ball-carriers',
    expectRows: ['Jahmyr Gibbs', 'Bijan Robinson'] },
  { label: 'nfl.com team-stats (expect server-rendered)',
    url: 'https://www.nfl.com/stats/team-stats/',
    expectRows: ['Bengals', 'Cardinals'] },
  // The season/type shape implied by the page title ("NFL 2026 REG") and the
  // 2002-2026 dropdown. Tested, not assumed — a 404 is a real answer.
  { label: 'nfl.com team-stats explicit season path',
    url: 'https://www.nfl.com/stats/team-stats/offense/passing/2025/reg/all',
    expectRows: ['Bengals', 'Cardinals'] },
];

const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0; +https://github.com/jeffunglesbee-create/field-relay-nba)';

(async () => {
  console.log(`=== nfl-html-endpoint-probe  utc=${new Date().toISOString()} ===\n`);
  for (const t of TARGETS) {
    const rec = { label: t.label, url: t.url };
    try {
      const r = await fetch(t.url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: AbortSignal.timeout(30000) });
      const body = await r.text();
      const rows = (body.match(/<tr[\s>]/gi) || []).length;
      const found = t.expectRows.filter(n => body.includes(n));
      console.log(`${t.label}`);
      console.log(`  ${t.url}`);
      console.log(`  status=${r.status}  bytes=${body.length}  <tr> count=${rows}`);
      console.log(`  expected names present: ${found.length}/${t.expectRows.length} ${found.length ? `(${found.join(', ')})` : ''}`);
      // Does the raw response carry a data payload the saved file lacked?
      const payloads = ['__NEXT_DATA__', 'self.__next_f', 'window.__', '/api/prod', 'graphql']
        .filter(m => body.includes(m));
      console.log(`  data-payload markers in RAW response: ${payloads.join(', ') || 'none'}`);
      console.log(`  => ${found.length === t.expectRows.length
        ? 'SERVER-RENDERED — a plain GET returns the table. Usable as a data source (subject to terms).'
        : rows > 5
          ? 'PARTIAL — table markup present but expected names absent; different season/default view.'
          : 'SHELL — no table in the raw response. The saved file captured client-rendered DOM.'}\n`);
    } catch (e) {
      console.log(`${t.label}\n  ${t.url}\n  ERROR: ${e.message}\n`);
    }
  }
  process.exit(0);
})();
