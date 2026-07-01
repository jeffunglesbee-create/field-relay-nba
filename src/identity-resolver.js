// src/identity-resolver.js
// Centralized team-name identity resolver. Every site that needs to
// match an ESPN/api-sports team name against an Odds-API team name
// (or vice versa) calls resolveTeamKey() and uses the returned
// canonical strip-form on both sides of the lookup. No drama scoring,
// no editorial logic — pure deterministic name canonicalization.
//
// Process:
//   1. NFD-strip diacritics, lowercase, drop non-alphanumerics.
//   2. Look up `CANONICAL[stripForm]` → returns canonical strip-form
//      if a known alias, otherwise the input stripForm itself.
//
// The CANONICAL map is forward-only: every known variant strip-form
// maps to the canonical strip-form. Canonical maps to itself
// (idempotent — calling resolveTeamKey twice returns the same key).
//
// Migration source: the inline ALIASES table in teamNameMatch +
// observed D1 mismatches probed June 21 2026.

function _strip(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

// stripForm → canonical stripForm. Canonical entries map to themselves
// so the lookup is idempotent. Built from D1 + Odds-API observed names
// (probe in outbox/cc-identity-resolver-2026-06-21.md).
const CANONICAL = (() => {
    // Build helper: declare {variant: canonical_human} pairs; encode
    // both sides to strip-form. Canonical also maps to itself.
    const pairs = [
        // ── WC / International ────────────────────────────────────
        ['United States',          'United States'],
        ['USA',                    'United States'],
        ['Türkiye',                'Türkiye'],
        ['Turkiye',                'Türkiye'],
        ['Turkey',                 'Türkiye'],
        ['Czechia',                'Czechia'],
        ['Czech Republic',         'Czechia'],
        ['DR Congo',               'DR Congo'],
        ['Congo DR',               'DR Congo'],
        ['Democratic Republic of the Congo', 'DR Congo'],
        ['Côte d\'Ivoire',         'Côte d\'Ivoire'],
        ['Cote d Ivoire',          'Côte d\'Ivoire'],
        ['Ivory Coast',            'Côte d\'Ivoire'],
        ['South Korea',            'South Korea'],
        ['Korea Republic',         'South Korea'],
        ['Republic of Korea',      'South Korea'],
        ['Curaçao',                'Curaçao'],
        ['Curacao',                'Curaçao'],
        ['Bosnia and Herzegovina', 'Bosnia and Herzegovina'],
        ['Bosnia-Herzegovina',     'Bosnia and Herzegovina'],
        ['Bosnia & Herzegovina',   'Bosnia and Herzegovina'],
        ['Bosnia-Herz',            'Bosnia and Herzegovina'],

        // ── EPL ───────────────────────────────────────────────────
        ['Brighton & Hove Albion', 'Brighton & Hove Albion'],
        ['Brighton and Hove Albion', 'Brighton & Hove Albion'],
        ['Brighton',               'Brighton & Hove Albion'],
        ['AFC Bournemouth',        'AFC Bournemouth'],
        ['Bournemouth',            'AFC Bournemouth'],
        ['Sunderland AFC',         'Sunderland AFC'],
        ['Sunderland',             'Sunderland AFC'],
        ['Wolverhampton Wanderers', 'Wolverhampton Wanderers'],
        ['Wolverhampton',          'Wolverhampton Wanderers'],
        ['Wolves',                 'Wolverhampton Wanderers'],
        ['Nottingham Forest',      'Nottingham Forest'],
        ['Nott\'m Forest',         'Nottingham Forest'],
        ['Nottm Forest',           'Nottingham Forest'],
        ['Newcastle United',       'Newcastle United'],
        ['Newcastle',              'Newcastle United'],
        ['Manchester United',      'Manchester United'],
        ['Man United',             'Manchester United'],
        ['Man Utd',                'Manchester United'],
        ['Manchester City',        'Manchester City'],
        ['Man City',               'Manchester City'],
        ['West Ham United',        'West Ham United'],
        ['West Ham',               'West Ham United'],
        ['Leeds United',           'Leeds United'],
        ['Leeds',                  'Leeds United'],

        // ── MLS — all 30 clubs, 2026 (canonical: stats-api.mlssoccer.com) ────
        // Aliases cover: ESPN displayName variants, D1 seed variants, common
        // short-form names, and old api-sports name strings.
        ['Atlanta United',         'Atlanta United'],
        ['Atlanta United FC',      'Atlanta United'],
        ['Atlanta',                'Atlanta United'],
        ['Austin FC',              'Austin FC'],
        ['Austin',                 'Austin FC'],
        ['CF Montréal',            'CF Montréal'],
        ['CF Montreal',            'CF Montréal'],
        ['Montreal Impact',        'CF Montréal'],
        ['Montreal',               'CF Montréal'],
        ['Charlotte FC',           'Charlotte FC'],
        ['Charlotte',              'Charlotte FC'],
        ['Chicago Fire FC',        'Chicago Fire FC'],
        ['Chicago Fire',           'Chicago Fire FC'],
        ['Chicago',                'Chicago Fire FC'],
        ['Colorado Rapids',        'Colorado Rapids'],
        ['Colorado',               'Colorado Rapids'],
        ['Columbus Crew',          'Columbus Crew'],
        ['Columbus',               'Columbus Crew'],
        ['D.C. United',            'D.C. United'],
        ['DC United',              'D.C. United'],
        ['FC Cincinnati',          'FC Cincinnati'],
        ['Cincinnati',             'FC Cincinnati'],
        ['FC Dallas',              'FC Dallas'],
        ['Dallas',                 'FC Dallas'],
        ['Houston Dynamo FC',      'Houston Dynamo FC'],
        ['Houston Dynamo',         'Houston Dynamo FC'],
        ['Houston',                'Houston Dynamo FC'],
        ['Inter Miami CF',         'Inter Miami CF'],
        ['Inter Miami',            'Inter Miami CF'],
        ['Miami',                  'Inter Miami CF'],
        ['LA Galaxy',              'LA Galaxy'],
        ['Los Angeles Galaxy',     'LA Galaxy'],
        ['Los Angeles Football Club', 'Los Angeles FC'],
        ['Los Angeles FC',         'Los Angeles FC'],
        ['LAFC',                   'Los Angeles FC'],
        ['Minnesota United FC',    'Minnesota United FC'],
        ['Minnesota United',       'Minnesota United FC'],
        ['Minnesota',              'Minnesota United FC'],
        ['Nashville SC',           'Nashville SC'],
        ['Nashville',              'Nashville SC'],
        ['New England Revolution', 'New England Revolution'],
        ['New England',            'New England Revolution'],
        ['New York City Football Club', 'New York City FC'],
        ['New York City FC',       'New York City FC'],
        ['NYCFC',                  'New York City FC'],
        ['New York City',          'New York City FC'],
        ['Red Bull New York',      'New York Red Bulls'],
        ['New York Red Bulls',     'New York Red Bulls'],
        ['NY Red Bulls',           'New York Red Bulls'],
        ['RBNY',                   'New York Red Bulls'],
        ['Orlando City',           'Orlando City'],
        ['Orlando City SC',        'Orlando City'],
        ['Orlando',                'Orlando City'],
        ['Philadelphia Union',     'Philadelphia Union'],
        ['Philadelphia',           'Philadelphia Union'],
        ['Portland Timbers',       'Portland Timbers'],
        ['Portland',               'Portland Timbers'],
        ['Real Salt Lake',         'Real Salt Lake'],
        ['RSL',                    'Real Salt Lake'],
        ['Salt Lake',              'Real Salt Lake'],
        ['San Diego FC',           'San Diego FC'],
        ['San Diego',              'San Diego FC'],
        ['San Jose Earthquakes',   'San Jose Earthquakes'],
        ['San Jose',               'San Jose Earthquakes'],
        ['Seattle Sounders FC',    'Seattle Sounders FC'],
        ['Seattle Sounders',       'Seattle Sounders FC'],
        ['Seattle',                'Seattle Sounders FC'],
        ['Sporting Kansas City',   'Sporting Kansas City'],
        ['SKC',                    'Sporting Kansas City'],
        ['Kansas City',            'Sporting Kansas City'],
        ['St. Louis CITY SC',      'St. Louis City SC'],
        ['St. Louis City SC',      'St. Louis City SC'],
        ['St Louis City SC',       'St. Louis City SC'],
        ['St. Louis City',         'St. Louis City SC'],
        ['St Louis City',          'St. Louis City SC'],
        ['St. Louis',              'St. Louis City SC'],
        ['Toronto FC',             'Toronto FC'],
        ['Toronto',                'Toronto FC'],
        ['Vancouver Whitecaps FC', 'Vancouver Whitecaps FC'],
        ['Vancouver Whitecaps',    'Vancouver Whitecaps FC'],
        ['Vancouver',              'Vancouver Whitecaps FC'],

        // ── WNBA (D1 has both short and long forms) ──────────────
        ['Las Vegas Aces',         'Las Vegas Aces'],
        ['Aces',                   'Las Vegas Aces'],
        ['Connecticut Sun',        'Connecticut Sun'],
        ['Sun',                    'Connecticut Sun'],
        ['New York Liberty',       'New York Liberty'],
        ['Liberty',                'New York Liberty'],
        ['Minnesota Lynx',         'Minnesota Lynx'],
        ['Lynx',                   'Minnesota Lynx'],
        ['Seattle Storm',          'Seattle Storm'],
        ['Storm',                  'Seattle Storm'],
        ['Indiana Fever',          'Indiana Fever'],
        ['Fever',                  'Indiana Fever'],
        ['Chicago Sky',            'Chicago Sky'],
        ['Sky',                    'Chicago Sky'],
        ['Los Angeles Sparks',     'Los Angeles Sparks'],
        ['LA Sparks',              'Los Angeles Sparks'],
        ['Sparks',                 'Los Angeles Sparks'],
        ['Phoenix Mercury',        'Phoenix Mercury'],
        ['Mercury',                'Phoenix Mercury'],
        ['Atlanta Dream',          'Atlanta Dream'],
        ['Dream',                  'Atlanta Dream'],
        ['Washington Mystics',     'Washington Mystics'],
        ['Mystics',                'Washington Mystics'],
        ['Dallas Wings',           'Dallas Wings'],
        ['Wings',                  'Dallas Wings'],
        ['Golden State Valkyries', 'Golden State Valkyries'],
        ['Valkyries',              'Golden State Valkyries'],
        ['Portland Fire',          'Portland Fire'],
        ['Fire',                   'Portland Fire'],
        ['Toronto Tempo',          'Toronto Tempo'],
        ['Tempo',                  'Toronto Tempo'],

        // ── MLB (short forms + relocated Athletics) ──────────────
        ['Athletics',              'Athletics'],
        ['Oakland Athletics',      'Athletics'],
        ['Sacramento Athletics',   'Athletics'],
        ['Houston Astros',         'Houston Astros'],
        ['Astros',                 'Houston Astros'],
        ['Cleveland Guardians',    'Cleveland Guardians'],
        ['Guardians',              'Cleveland Guardians'],
        ['Atlanta Braves',         'Atlanta Braves'],
        ['Braves',                 'Atlanta Braves'],
        ['Milwaukee Brewers',      'Milwaukee Brewers'],
        ['Brewers',                'Milwaukee Brewers'],
        ['New York Yankees',       'New York Yankees'],
        ['Yankees',                'New York Yankees'],
        ['New York Mets',          'New York Mets'],
        ['Mets',                   'New York Mets'],
        ['Los Angeles Dodgers',    'Los Angeles Dodgers'],
        ['LA Dodgers',             'Los Angeles Dodgers'],
        ['Dodgers',                'Los Angeles Dodgers'],
        ['Los Angeles Angels',     'Los Angeles Angels'],
        ['LA Angels',              'Los Angeles Angels'],
        ['Angels',                 'Los Angeles Angels'],
        ['Boston Red Sox',         'Boston Red Sox'],
        ['Red Sox',                'Boston Red Sox'],
        ['Chicago Cubs',           'Chicago Cubs'],
        ['Cubs',                   'Chicago Cubs'],
        ['Chicago White Sox',      'Chicago White Sox'],
        ['White Sox',              'Chicago White Sox'],
        ['Philadelphia Phillies',  'Philadelphia Phillies'],
        ['Phillies',               'Philadelphia Phillies'],
        ['Toronto Blue Jays',      'Toronto Blue Jays'],
        ['Blue Jays',              'Toronto Blue Jays'],
        ['Baltimore Orioles',      'Baltimore Orioles'],
        ['Orioles',                'Baltimore Orioles'],
        ['Tampa Bay Rays',         'Tampa Bay Rays'],
        ['Rays',                   'Tampa Bay Rays'],
        ['Detroit Tigers',         'Detroit Tigers'],
        ['Tigers',                 'Detroit Tigers'],
        ['Minnesota Twins',        'Minnesota Twins'],
        ['Twins',                  'Minnesota Twins'],
        ['Kansas City Royals',     'Kansas City Royals'],
        ['Royals',                 'Kansas City Royals'],
        ['Texas Rangers',          'Texas Rangers'],
        ['Rangers',                'Texas Rangers'],
        ['Seattle Mariners',       'Seattle Mariners'],
        ['Mariners',               'Seattle Mariners'],
        ['San Francisco Giants',   'San Francisco Giants'],
        ['SF Giants',              'San Francisco Giants'],
        ['Giants',                 'San Francisco Giants'],
        ['San Diego Padres',       'San Diego Padres'],
        ['Padres',                 'San Diego Padres'],
        ['Cincinnati Reds',        'Cincinnati Reds'],
        ['Reds',                   'Cincinnati Reds'],
        ['Pittsburgh Pirates',     'Pittsburgh Pirates'],
        ['Pirates',                'Pittsburgh Pirates'],
        ['St. Louis Cardinals',    'St. Louis Cardinals'],
        ['Cardinals',              'St. Louis Cardinals'],
        ['Washington Nationals',   'Washington Nationals'],
        ['Nationals',              'Washington Nationals'],
        ['Miami Marlins',          'Miami Marlins'],
        ['Marlins',                'Miami Marlins'],
        ['Colorado Rockies',       'Colorado Rockies'],
        ['Rockies',                'Colorado Rockies'],
        ['Arizona Diamondbacks',   'Arizona Diamondbacks'],
        ['D-backs',                'Arizona Diamondbacks'],
        ['Diamondbacks',           'Arizona Diamondbacks'],

        // ── NBA (long ↔ short LA forms) ───────────────────────────
        ['Los Angeles Clippers',   'Los Angeles Clippers'],
        ['LA Clippers',            'Los Angeles Clippers'],
        ['Los Angeles Lakers',     'Los Angeles Lakers'],
        ['LA Lakers',              'Los Angeles Lakers'],

        // ── Ligue 1 ───────────────────────────────────────────────
        ['Paris Saint-Germain',    'Paris Saint-Germain'],
        ['PSG',                    'Paris Saint-Germain'],
        ['Paris SG',               'Paris Saint-Germain'],
    ];
    const out = {};
    for (const [variant, canonical] of pairs) {
        out[_strip(variant)] = _strip(canonical);
    }
    return out;
})();

/**
 * Resolve a team name to a canonical strip-form key. Pass the same
 * input from EITHER side of a comparison and the keys are equal when
 * the names refer to the same team.
 *
 * @param {string|null|undefined} name
 * @returns {string} canonical strip-form (empty string for empty input)
 */
function resolveTeamKey(name) {
    const k = _strip(name);
    if (!k) return '';
    return CANONICAL[k] || k;
}

export { resolveTeamKey };
