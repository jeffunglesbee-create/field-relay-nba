// Two questions, one run.
//
// Q1 — CLOSE THE SEASON-PARAMETER QUESTION.
// The guessed path /stats/team-stats/offense/passing/2025/reg/all returned 200
// with a full table — but so does the bare /stats/team-stats/, at nearly the
// same byte count (193,910 vs 193,720) with the same teams. That is equally
// consistent with "the path is honored" and "the path is ignored and the default
// view is served". Byte count cannot separate them; a VALUE can. If the same
// team's Pass Yds differs across seasons, the path parameterizes. If every
// season returns the identical number, it does not.
//
// Seasons chosen to be unambiguous: 2025 (the season the saved page's dropdown
// had selected) vs 2015 (a decade earlier — no chance of coincidental equality).
//
// Q2 — IS THERE A REAL JSON API, rather than HTML?
// Preference is an actual endpoint, not page parsing. These candidates are all
// PUBLIC, UNAUTHENTICATED surfaces recorded in FIELD's own June 26 source spec.
// This probe only asks "does an unauthenticated GET return JSON" for each. It
// does NOT attempt to authenticate, mint, reuse, or work around any credential:
// nextgenstats.nfl.com/api/prod/* is OAuth-gated (measured 401, 2026-06-11) and
// is deliberately NOT probed here — a gated API stays gated.
//
// Read-only GETs, one per URL.

const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0; +https://github.com/jeffunglesbee-create/field-relay-nba)';
const get = async (url, accept = 'text/html') => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(30000) });
    const body = await r.text();
    return { status: r.status, ct: r.headers.get('content-type') || '', body, ms: Date.now() - t0 };
  } catch (e) { return { error: e.message, ms: Date.now() - t0 }; }
};

// Pull one team's row from the rendered table so seasons can be compared by VALUE.
function teamRow(html, team) {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const r of rows) {
    if (!r.includes(team)) continue;
    const cells = (r.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').split(/\s+/).filter(Boolean).join(' '));
    if (cells.length >= 6) return cells;
  }
  return null;
}

(async () => {
  console.log(`=== nfl-season-param-probe  utc=${new Date().toISOString()} ===\n`);

  // ── Q1 ────────────────────────────────────────────────────────────────────
  console.log('── Q1: does the season path actually parameterize? ──');
  const variants = [
    ['default   ', 'https://www.nfl.com/stats/team-stats/'],
    ['path 2025 ', 'https://www.nfl.com/stats/team-stats/offense/passing/2025/reg/all'],
    ['path 2015 ', 'https://www.nfl.com/stats/team-stats/offense/passing/2015/reg/all'],
    ['path 2015 post', 'https://www.nfl.com/stats/team-stats/offense/passing/2015/post/all'],
  ];
  const seen = {};
  for (const [label, url] of variants) {
    const r = await get(url);
    if (r.error) { console.log(`  ${label}  ERROR ${r.error}`); continue; }
    const row = teamRow(r.body, 'Bengals');
    // Column order from the saved page: Team, Att, Cmp, Cmp%, Yds/Att, Pass Yds, ...
    const passYds = row ? row[5] : null;
    seen[label.trim()] = passYds;
    console.log(`  ${label}  status=${r.status} bytes=${r.body.length}  Bengals row=${row ? row.slice(0, 7).join(' | ') : 'NOT FOUND'}`);
  }
  const y2025 = seen['path 2025'], y2015 = seen['path 2015'], dflt = seen['default'];
  console.log(`\n  Bengals Pass Yds — default=${dflt}  2025=${y2025}  2015=${y2015}`);
  console.log(`  => ${y2025 && y2015 && y2025 !== y2015
    ? 'PARAMETERIZED — different seasons return different values. The path is a real season selector.'
    : y2025 && y2015 && y2025 === y2015
      ? 'NOT PARAMETERIZED — every season returns the same numbers; the path segment is decorative.'
      : 'INCONCLUSIVE — could not extract the comparison value from one or both responses.'}\n`);

  // ── Q2 ────────────────────────────────────────────────────────────────────
  console.log('── Q2: is there an unauthenticated JSON endpoint? ──');
  console.log('   (gated APIs are not probed — nextgenstats /api/prod/* is OAuth-walled and stays that way)\n');
  const candidates = [
    // ESPN — already FIELD's backbone, free, documented in the June 26 spec.
    ['ESPN nfl scoreboard', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'],
    ['ESPN nfl teams', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams'],
    ['ESPN core team season stats',
     'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/types/2/teams/4/statistics'],
    // api.nfl.com Shield — listed as a public bonus source in the June 26 spec.
    ['NFL Shield football/v2', 'https://api.nfl.com/football/v2/stats/live/game-summaries'],
    // nflverse — the sanctioned, CC-BY path FIELD already uses.
    ['nflverse release index', 'https://api.github.com/repos/nflverse/nflverse-data/releases/tags/nextgen_stats'],
  ];
  for (const [label, url] of candidates) {
    const r = await get(url, 'application/json');
    if (r.error) { console.log(`  ${label.padEnd(28)} ERROR ${r.error}`); continue; }
    let shape = '';
    if (/json/i.test(r.ct)) {
      try {
        const j = JSON.parse(r.body);
        shape = Array.isArray(j) ? `array[${j.length}]` : Object.keys(j).slice(0, 6).join(',');
      } catch { shape = 'unparseable'; }
    }
    console.log(`  ${label.padEnd(28)} status=${r.status} ${String(r.ct).slice(0, 30).padEnd(32)} ${r.body.length} bytes  ${shape}`);
  }
  process.exit(0);
})();
