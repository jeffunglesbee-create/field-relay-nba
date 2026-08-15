// What else on nfl.com / NGS is reachable without credentials?
//
// Established so far, measured:
//   nextgenstats.nfl.com/stats/*        Vue SPA — raw GET returns 0 <tr> (shell)
//   nextgenstats.nfl.com/api/prod/*     OAuth-gated, 401 (2026-06-11). NOT probed
//                                       here and not to be worked around.
//   www.nfl.com/stats/team-stats/       server-rendered, 33 <tr>, season-parameterized
//
// The lead this sweep follows: the saved www.nfl.com page links to
// `nfl.com/stats/ngs/leaders` — an NGS surface hosted on WWW.nfl.com rather than
// on the SPA host. www.nfl.com has already proven to be server-rendered
// (jQuery/RequireJS, no client data payload), so NGS content served from that host
// may be reachable exactly the way team-stats is, with no auth involved.
//
// Everything below is an ordinary unauthenticated GET of a public page. No token
// is minted, replayed, or forged anywhere; the gated API is deliberately absent
// from the list.
//
// For each candidate: is there a real data table in the RAW response, and does it
// carry recognizable NGS/stat column headers rather than just page chrome?

const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0; +https://github.com/jeffunglesbee-create/field-relay-nba)';

const CANDIDATES = [
  // The lead.
  ['ngs leaders (www host)',       'https://www.nfl.com/stats/ngs/leaders'],
  ['ngs leaders passing',          'https://www.nfl.com/stats/ngs/leaders/passing'],
  ['ngs landing',                  'https://www.nfl.com/stats/ngs/'],
  // Known-good control — proves the parser and the host behave as measured before.
  ['team-stats (control)',         'https://www.nfl.com/stats/team-stats/'],
  // Other official stat surfaces on the same server-rendered host.
  ['team defense passing',         'https://www.nfl.com/stats/team-stats/defense/passing/2025/reg/all'],
  ['team offense rushing',         'https://www.nfl.com/stats/team-stats/offense/rushing/2025/reg/all'],
  ['team offense scoring',         'https://www.nfl.com/stats/team-stats/offense/scoring/2025/reg/all'],
  ['player stats passing',         'https://www.nfl.com/stats/player-stats/'],
  ['player stats category',        'https://www.nfl.com/stats/player-stats/category/passing/2025/reg/all/passingyards/desc'],
  // Injuries + schedule are official surfaces FIELD has a real use for.
  ['injuries',                     'https://www.nfl.com/injuries/'],
  ['schedule week 1',              'https://www.nfl.com/schedules/2026/REG1/'],
];

// Header words that mean "this is a stat table", not nav chrome.
const STAT_WORDS = ['Att', 'Cmp', 'Yds', 'TD', 'INT', 'Rate', 'Sck', 'CPOE', 'Separation',
                    'Time to Throw', 'Aggressiveness', 'Speed', 'Player', 'Team'];

(async () => {
  console.log(`=== nfl-surface-sweep  utc=${new Date().toISOString()} ===`);
  console.log('unauthenticated GETs of public pages only; the OAuth-gated NGS API is not probed\n');
  console.log('  status  <tr>   stat-words  bytes     surface');
  const hits = [];
  for (const [label, url] of CANDIDATES) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
      const body = await r.text();
      const rows = (body.match(/<tr[\s>]/gi) || []).length;
      // Only count header-ish occurrences, inside <th> or the first table region.
      const head = body.slice(0, body.indexOf('</table>') + 1 || 20000);
      const words = STAT_WORDS.filter(w => new RegExp(`>\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<`, 'i').test(head));
      const usable = rows > 5 && words.length >= 3;
      if (usable) hits.push({ label, url, rows, words });
      console.log(`  ${String(r.status).padEnd(6)}  ${String(rows).padStart(4)}   ${String(words.length).padStart(9)}  ${String(body.length).padStart(8)}  ${label}${usable ? '   ← USABLE' : ''}`);
    } catch (e) {
      console.log(`  ERR                              ${label}  (${e.message})`);
    }
  }

  console.log(`\nserver-rendered data surfaces found: ${hits.length}/${CANDIDATES.length}`);
  for (const h of hits) {
    console.log(`\n  ${h.label}`);
    console.log(`    ${h.url}`);
    console.log(`    rows=${h.rows}  columns detected: ${h.words.join(', ')}`);
  }
  if (!hits.length) console.log('  (none — every candidate was chrome-only or unreachable)');
  process.exit(0);
})();
