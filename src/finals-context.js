// ─────────────────────────────────────────────────────────────────────────────
// FIELD Finals Narrative Context
//
// Provides pre-loaded historical narrative depth for the 2026 Finals to the
// cron slate brief journalism prompt. Implements the functional intent of
// the B1 / TIER 1B "R2 Finals Narrative Context" spec
// (1UIuazvMvY4ewJap2Y4Z4-LbqHGvt8z-QhX28ImnAlt0,
//  1yt-3ruXqTNNOl9k1jRQARFw9OtHt6IzNG4xkfcjVqTE).
//
// SPEC DEVIATION (documented): the spec architecture stored these JSON objects
// in Cloudflare R2 and the relay fetched them per request. For the immediate
// deadline (SCF G1 June 2 at 8pm ET, NBA Finals G1 June 3 at 8:30pm ET) the
// content is embedded inline. The migration to R2 makes sense when the
// 48-team WC2026 archive justifies the architecture (see WC2026 corrections
// doc 17D_EzrqoNUR4LN4OK3hr6MqKFUHitWlO72O1CWmqLks). The functional intent
// of the spec is preserved: pre-loaded narrative context, zero per-game
// Claude cost, verified facts with sources.
//
// FIELD_FEATURES key: 'finals-context-r2' (kept for spec consistency)
//
// ALL FACTS VERIFIED — sources noted inline.
// Codebase verifications cross-reference index.html HEAD 8008759 (jubilant-bassoon, June 1 baseline).
// Historical facts cross-referenced against Wikipedia, basketball-reference,
// hockey-reference, ESPN, NBA.com, CBS, PBS, CBC.
//
// SHIPPED: June 3 2026 (salvage of June 1 build, committed verbatim from
// handoff doc 1w5Ypy1ME6LlKKkyWh1_0IJyRm5iics61jhyBswO9uT8).
//
// P0.2 FIX (June 4 2026): detection patterns updated to match ESPN short
// display names ("Spurs", "Knicks", "Hurricanes", "Canes", "Golden Knights",
// "Knights") and "NBA Finals"/"Stanley Cup Final" without year suffix.
// buildGameLine() in the cron uses shortDisplayName from ESPN API, not full
// team names, so the original full-name-only detection silently failed for G1.
// ─────────────────────────────────────────────────────────────────────────────


const NBA_FINALS_2026_CONTEXT = [
  'NBA FINALS 2026 — San Antonio Spurs vs New York Knicks. G1 Wed June 3, 8:30pm ET, Frost Bank Center, ABC.',
  '- SAS regular season 62-20. NYK regular season 53-29. (Source: FIELD codebase line 7424.)',
  '- NYK first Finals appearance since 1999 (27 years). The 1999 Finals: NYK lost 4-1 to the same SAS franchise; Tim Duncan won his first Finals MVP. NYK was the only 8-seed Finals team until 2023. (Source: Wikipedia 1999 NBA Finals; basketball-reference.)',
  '- SAS last Finals appearance: 2014 (12 years). Won 4-1 over Miami Heat; Kawhi Leonard MVP; 5th franchise championship. SAS regular season was also 62-20 that year — same as 2026. (Source: Wikipedia 2014 NBA Finals; nba.com history.)',
  '- Path to 2026 Finals: SAS defeated defending champion OKC 4-3 in WCF (Wembanyama 28.2 PPG / 3.7 BPG this postseason — his first deep playoff run). NYK swept CLE 4-0 in ECF (Brunson ECF MVP). (Source: FIELD codebase matchupNote line 7422/7424.)',
  '- Venues: SAS hosts G1/G2/G5/G7 at Frost Bank Center, San Antonio. NYK hosts G3/G4/G6 at Madison Square Garden. (Source: FIELD codebase line 7424-7430.)',
  '- ABC crew: Mike Breen play-by-play, Richard Jefferson + Tim Legler analysts. (Source: FIELD codebase line 7424.)',
  '- Franchise championships: SAS has 5 (1999, 2003, 2005, 2007, 2014). NYK has 2 (1970, 1973). (Source: nba.com history.)',
].join('\n');


const NHL_SCF_2026_CONTEXT = [
  'STANLEY CUP FINAL 2026 — Carolina Hurricanes vs Vegas Golden Knights. G1 Tue June 2, 8pm ET, Lenovo Center, Raleigh, ABC.',
  "- CAR first Stanley Cup Final since winning the Cup in 2006 (20 years). The 2006 Final: CAR defeated Edmonton Oilers 4-3 in 7 games; rookie goalie Cam Ward won Conn Smythe; Rod Brind'Amour captained the win — CAR's 1st championship and 2nd-ever Final appearance (also 2002, lost to Detroit). (Source: Wikipedia 2006 Stanley Cup Final; ESPN 2006 box scores.)",
  "- VGK making 3rd Final in 9 years (franchise founded 2017 as expansion). 2018: lost 4-1 to Washington Capitals in VGK's inaugural season (Ovechkin's first Cup). 2023: won 4-1 over Florida Panthers; Mark Stone hat trick in clinching G5 (9-3) — VGK's 1st championship, in just its 6th season. (Source: CBS 2023 SCF coverage; PBS; The Hockey Writers.)",
  '- Path to 2026 SCF: CAR completed ECF 4-1 over Montreal (Andersen shutout in G4, 6-1 G5 win). VGK swept Colorado 4-0 in WCF (Stone GWG in G4, outscored COL 14-7 across series). (Source: FIELD codebase matchupNote line 7456-7458, 7476.)',
  '- Venues: CAR hosts G1/G2/G5/G7 at Lenovo Center. VGK hosts G3/G4/G6 at T-Mobile Arena, Las Vegas. (Source: FIELD codebase line 7463-7469.)',
  '- ABC crew: Sean McDonough play-by-play, Ray Ferraro analyst. (Source: FIELD codebase line 7463.)',
  '- Key CAR players: Andrei Svechnikov, Sebastian Aho, Frederik Andersen (G). (Source: FIELD codebase matchupNote line 7463.)',
  '- Key VGK players: Mark Stone (captain), Pavel Dorofeyev, Jonathan Marchessault. (Source: FIELD codebase matchupNote line 7463.)',
  '- Franchise championships: CAR has 1 (2006). VGK has 1 (2023). (Source: nhl.com history.)',
].join('\n');


// ─────────────────────────────────────────────────────────────────────────────
// Detection: scan gameLines for the confirmed Finals matchups.
//
// buildGameLine() uses ESPN's shortDisplayName ("Spurs", "Knicks") not full
// team names, and ESPN's series text is "NBA Finals" not "NBA Finals 2026".
// Detection must handle all three cases:
//   1. Full team names in same line (non-ESPN data sources, direct injection)
//   2. Short display names in same line (ESPN scoreboard — primary cron source)
//   3. "NBA Finals" / "Stanley Cup Final" label without year (ESPN series field)
// ─────────────────────────────────────────────────────────────────────────────


function slateHasNBAFinals(gameLines) {
  return gameLines.some(l =>
    // Case 3: ESPN series field — "NBA Finals" with or without year
    /\bNBA Finals\b/i.test(l) ||
    // Case 1: full team names in same line (direct data / non-ESPN sources)
    (/\bSan Antonio Spurs\b/.test(l) && /\bNew York Knicks\b/.test(l)) ||
    // Case 2: ESPN short display names — "Spurs" + "Knicks" in same game line.
    // Safe: "Spurs" without "Knicks" matches Tottenham in EPL lines; combined
    // check prevents false positives across sports.
    (/\bSpurs\b/.test(l) && /\bKnicks\b/.test(l))
  );
}


function slateHasSCF(gameLines) {
  return gameLines.some(l =>
    // Case 3: ESPN series field — "Stanley Cup Final" with or without year
    /\bStanley Cup Final\b/i.test(l) ||
    // Case 1: full team names in same line
    (/\bCarolina Hurricanes\b/.test(l) && /\bVegas Golden Knights\b/.test(l)) ||
    // Case 2: ESPN short display names — "Hurricanes" or "Canes" + "Golden Knights" or "Knights"
    (/\b(Hurricanes|Canes)\b/.test(l) && /\b(Golden Knights|Knights)\b/.test(l))
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Injection: returns the block to append to the journalism prompt.
// Empty string when no Finals games on slate (no-op).
// ─────────────────────────────────────────────────────────────────────────────


export function buildFinalsContextBlock(gameLines) {
  const blocks = [];
  if (slateHasNBAFinals(gameLines)) blocks.push(NBA_FINALS_2026_CONTEXT);
  if (slateHasSCF(gameLines))       blocks.push(NHL_SCF_2026_CONTEXT);
  if (!blocks.length) return '';
  return [
    '',
    'FINALS NARRATIVE CONTEXT (verified background facts; use where natural, do NOT invent beyond these):',
    ...blocks,
  ].join('\n');
}


// Exported for smoke tests
export const _FINALS_CONTEXT_INTERNAL = {
  NBA_FINALS_2026_CONTEXT,
  NHL_SCF_2026_CONTEXT,
  slateHasNBAFinals,
  slateHasSCF,
};
