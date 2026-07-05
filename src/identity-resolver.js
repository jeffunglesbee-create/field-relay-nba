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
const { CANONICAL_TEAM, CANONICAL_TEAM_DISPLAY } = (() => {
    // Build helper: declare {variant: canonical_human} pairs; encode
    // both sides to strip-form. Canonical also maps to itself.
    // CANONICAL_TEAM: strip-form → canonical strip-form (for resolveTeamKey matching)
    // CANONICAL_TEAM_DISPLAY: strip-form → canonical human-readable string (for resolveTeamName)
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
        ['Cape Verde',             'Cape Verde'],
        ['Cape Verde Islands',     'Cape Verde'],  // ESPN/BSD variant → FIELD canonical

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
    const strip = {};
    const display = {};
    for (const [variant, canonical] of pairs) {
        const k = _strip(variant);
        strip[k] = _strip(canonical);
        display[k] = canonical;
    }
    return { CANONICAL_TEAM: strip, CANONICAL_TEAM_DISPLAY: display };
})();

function resolveTeamName(name) {
    return CANONICAL_TEAM_DISPLAY[_strip(name)] || name;
}

// ── Player identity — DELIBERATELY DIFFERENT algorithm from _strip() ──
// _strip() NFD-strips diacritics (correct for teams, proven by the
// Bosnia identity fix). Players need the OPPOSITE: preserve diacritics,
// to match name_key() (jubilant-bassoon/scripts/mlb-weekly-update.py)
// and lastNameOf()+_mlbPlayerKey() (jubilant-bassoon/index.html) — the
// functions that already generate and consume real Savant-derived
// player keys (pitch_arsenals.json, pitch_tempo.json, sprint_speed.json).
//
// Two-stage pipeline, mirroring the client's lastNameOf() + _mlbPlayerKey()
// split (combined into one function here since the relay has no equivalent
// two-function split):
//   1. Extract last-name-with-suffix from a full name (e.g. "Bobby Witt
//      Jr." -> "Witt Jr.", "Kevin Gausman" -> "Gausman").
//   2. Normalize via the EXACT SAME sequential, non-anchored replace
//      chain as Python's name_key() and the client's _mlbPlayerKey() —
//      NOT an anchored regex. This is required to reproduce a real,
//      already-documented quirk: sequential (not anchored) replacement
//      of ' ii' as a substring means "Player III" -> "playeri", not
//      "player". Real committed data (e.g. lynch_iv in pitch_tempo.json)
//      was generated by the quirky version, so an "obviously correct"
//      anchored-regex rewrite would silently stop matching real keys.
//      Verified 2026-07-02 against 5 real cases including this quirk —
//      do not "fix" this to look cleaner without re-verifying name_key()
//      hasn't changed.
const _STRIP_PLAYER_SUFFIX_TOKENS = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

function _stripPlayer(name) {
    const parts = String(name || '').split(' ').filter(Boolean);
    let lastForm;
    if (parts.length > 1 && _STRIP_PLAYER_SUFFIX_TOKENS.has(parts[parts.length - 1].toLowerCase())) {
        const suffix = parts.pop();
        lastForm = `${parts.pop() || ''} ${suffix}`.trim();
    } else {
        lastForm = parts.pop() || '';
    }
    let s = lastForm.toLowerCase();
    s = s.split(',')[0].trim();
    s = s.replace(' jr.', '').replace(' sr.', '').replace(' ii', '').replace(' iii', '');
    return s.replace(/[\s-]/g, '_');
}

// Starts near-empty. Populated the same way CANONICAL_TEAM grew: a
// real mismatch surfaces, gets added as one documented pair with
// evidence inline — never speculative entries.
const CANONICAL_PLAYER = (() => {
    const pairs = [
        // Found 2026-07-02 during TASK 7 verification, not speculative:
        // ESPN's roster API `fullName` field strips diacritics
        // ("Cristopher Sanchez"), but Savant-sourced pitch_arsenals.json
        // keys preserve them ("sánchez" — team PHI, cross-referenced
        // against the real ESPN PHI roster to confirm same player).
        // Any caller passing an ESPN-sourced fullName for this player
        // would otherwise silently miss the real data row.
        ['Cristopher Sanchez', 'sánchez'],

        // Found 2026-07-02 via scripts/mlb-player-mismatch-detector.js
        // (jubilant-bassoon, workflow run 28599226655) — 22 real candidates
        // total from a full 30-team ESPN roster cross-reference. Before
        // adding any, checked each accent-stripped key against all 3
        // source files for an INDEPENDENT existing entry under that same
        // unaccented spelling — a real collision risk this flat map has
        // no way to disambiguate (no team/context key). 10 of 22 collided
        // with a genuinely different real player already using that
        // shorter spelling (e.g. 'lopez', 'diaz', 'rodriguez' — all
        // common enough to have multiple distinct real MLB players) and
        // are DELIBERATELY NOT added here — see
        // outbox/mlb-player-mismatches.json for the full candidate list
        // and cf/2026-07-02/canonical-player-collision-risk in Codex for
        // the excluded ones and the design gap this exposes. The 2
        // multi-word-surname candidates (del_castillo, de_la_cruz) also
        // collided (castillo/cruz both exist independently) and are
        // excluded for the same reason. Only the 11 below had zero
        // independent collision across pitch_arsenals.json,
        // pitch_tempo.json, and sprint_speed.json — confirmed via direct
        // key lookup, not assumed safe from the detector's output alone.
        ['Andres Gimenez', 'giménez'],
        ['Yohendrick Pinango', 'piñango'],
        ['Rafael Marchan', 'marchán'],
        ['Teoscar Hernandez', 'hernández'],
        ['Walbert Urena', 'ureña'],
        ['Eury Perez', 'pérez'],
        ['Jasson Dominguez', 'domínguez'],
        ['Mauricio Dubon', 'dubón'],
        ['Randy Vasquez', 'vásquez'],
        ['Carlos Narvaez', 'narváez'],
        ['Nelson Velazquez', 'velázquez'],
    ];
    const out = {};
    for (const [variant, canonical] of pairs) {
        out[_stripPlayer(variant)] = _stripPlayer(canonical);
    }
    return out;
})();

const _CANONICAL_BY_TYPE = { team: CANONICAL_TEAM, player: CANONICAL_PLAYER };
const _STRIP_BY_TYPE = { team: _strip, player: _stripPlayer };

/**
 * Resolve an entity name to a canonical strip-form key, keyed by type.
 * IMPORTANT: team and player use DIFFERENT normalization algorithms —
 * see _stripPlayer's comment for why. Do not assume one strip function
 * works for both.
 *
 * @param {string} type - 'team' | 'player'
 * @param {string|null|undefined} name
 * @returns {string} canonical strip-form (empty string for empty input
 *   or unrecognized type)
 */
function resolveEntity(type, name) {
    const stripFn = _STRIP_BY_TYPE[type];
    if (!stripFn) return '';
    const k = stripFn(name);
    if (!k) return '';
    const map = _CANONICAL_BY_TYPE[type];
    return map[k] || k;
}

/**
 * Resolve a team name to a canonical strip-form key. Pass the same
 * input from EITHER side of a comparison and the keys are equal when
 * the names refer to the same team.
 *
 * Thin wrapper over resolveEntity('team', name) — preserves exact
 * existing behavior for all 10 call sites in index.js and 4 in
 * context-assembler.js. None of them need to change.
 *
 * @param {string|null|undefined} name
 * @returns {string} canonical strip-form (empty string for empty input)
 */
function resolveTeamKey(name) {
    return resolveEntity('team', name);
}

// ── Soccer player identity — separate algorithm from both _strip() and
// _stripPlayer() (MLB) ──────────────────────────────────────────────
// MLB's _stripPlayer strips Jr/Sr/II/III/IV suffixes and takes only the
// last name token -- both wrong for soccer: no generational-suffix
// convention, and real particle surnames exist ("Da Costa", verified
// live 2026-07-02 via a real WC26 player) that a last-token-only
// extraction would truncate.
//
// Two real input shapes must both be handled, verified against all 9
// real candidates found this session in BOTH forms before shipping:
//   1. BSD's abbreviated format: "B. A. Yılmaz" (leading period-
//      terminated initials, surname is everything after).
//   2. ESPN's fullName format: "Baris Alper Yilmaz" (no periods,
//      spelled-out given names) -- falls back to last-token extraction
//      since no real multi-word-surname case has been observed yet in
//      this format specifically. If one surfaces (e.g. "N'Golo Da
//      Costa" as a full name), this needs the same particle-detection
//      MLB's lastNameOf() uses for suffixes, adapted for soccer
//      particles (van, de, da, dos, von) -- not built here because no
//      real case has required it yet.
//
// Deliberately does NOT strip diacritics -- preserves whatever the
// input has, same principle as MLB's _stripPlayer. BSD-sourced strings
// (canonical side) keep their real accents; ESPN-sourced strings
// (variant side) naturally produce whatever ESPN's own transliteration
// gives (verified inconsistent: keeps some accents like Ç, drops
// Turkish-specific ı).
function _stripPlayerSoccer(name) {
    const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return '';
    let i = 0;
    while (i < tokens.length - 1 && /^[A-Za-z]\.$/.test(tokens[i])) i++;
    if (i > 0) return tokens.slice(i).join(' ').toLowerCase();
    return tokens[tokens.length - 1].toLowerCase();
}

// Populated from scripts/soccer-player-crosscheck.js (field-relay-nba),
// real production runs 2026-07-02 (commits 129f848 through 6e472f78c).
// Every entry here was verified TWICE before being added:
//   1. By the detector itself (exact-match-preference + within-match
//      collision check across the 32 players in one BSD event).
//   2. By a broader collision check against full competition athlete
//      pools (1246-3331 real athletes each, multiple competition
//      contexts) -- confirms each surname maps to exactly one real
//      distinct person, not just "no collision in one game's sample."
//      This is the same rigor CANONICAL_PLAYER (MLB) got before its
//      11 entries were added -- narrower single-match verification
//      alone was explicitly judged insufficient first.
// Canonical value is BSD's own extracted surname (source of truth for
// the live data pipeline, same directionality as CANONICAL_PLAYER).
// _SOCCER_BUILD: builds both name→canonical map and canonical-key→bsdPlayerId map
// in one pass. SOCCER_PLAYER_ID_BY_KEY uses the CANONICAL key (output of
// _stripPlayerSoccer(canonical)) so that resolveEntity('soccer_player', espnName)
// → canonical key → ID lookup works without a second strip call at the call site.
// bsdPlayerId values sourced from scripts/soccer-player-crosscheck.js real output
// (field-relay-nba, confirmed 2026-07-02). Macià (5143) and Purić (5154) flagged
// in CC-CMD-2026-07-02-goalscorer-xg as unconfirmed — verify against live
// crosscheck output before relying on those two IDs in production.
const _SOCCER_BUILD = (() => {
    const pairs = [
        ['Baris Alper Yilmaz', 'Yılmaz',    3734],
        ['Ugurcan Çakir',      'Çakır',      3724],
        ['Kenan Yildiz',       'Yıldız',     2184],
        ['Oguz Aydin',         'Aydın',      3412],
        ['Eren Elmali',        'Elmalı',     4217],
        ['Abdülkerim Bardakçi','Bardakcı',   3727],
        ['Christian Pulisic',  'Pulišić',    3820],
        ['Carlos Macià',       'Macia',      5143],
        ['Aleksa Puric',       'Purić',      5154],
    ];
    const canonical = {};
    const idByKey   = {};
    for (const [variant, canonicalName, playerId] of pairs) {
        const variantKey   = _stripPlayerSoccer(variant);
        const canonicalKey = _stripPlayerSoccer(canonicalName);
        canonical[variantKey] = canonicalKey;
        if (playerId != null) idByKey[canonicalKey] = playerId;
    }
    return { canonical, idByKey };
})();

const CANONICAL_PLAYER_SOCCER  = _SOCCER_BUILD.canonical;
// Maps resolveEntity('soccer_player', espnName) → BSD numeric player_id.
// Key is the canonical strip form (same string resolveEntity returns).
const SOCCER_PLAYER_ID_BY_KEY  = _SOCCER_BUILD.idByKey;

_STRIP_BY_TYPE.soccer_player    = _stripPlayerSoccer;
_CANONICAL_BY_TYPE.soccer_player = CANONICAL_PLAYER_SOCCER;

// ── AFL team identity ──────────────────────────────────────────────────────────
// Nickname-stripping + 6-char truncation bridges ESPN displayNames
// (e.g. "Melbourne Demons") to D1 shorter forms ("Melbourne"). Migrated from
// normAFL() in drama-backfill.mjs (2026-07-05, CC-CMD consolidate-afl-v2).
// GWS Giants / Greater Western Sydney resolved via CANONICAL_AFL map below.
function _stripAFL(name) {
    return String(name || '').toLowerCase().trim()
        .replace(/\b(lions|swans|eagles|hawks|magpies|bombers|cats|blues|tigers|bulldogs|kangaroos|power|crows|demons|dockers|suns|giants|saints|roos)\b/g, '')
        .replace(/[^a-z]/g, '').slice(0, 6);
}

const CANONICAL_AFL = (() => {
    const pairs = [
        // ESPN stores "GWS Giants"; D1 stores "Greater Western Sydney".
        // Confirmed real mismatch, found 2026-07-05 during AFL drama backfill.
        ['GWS Giants', 'Greater Western Sydney'],
    ];
    const out = {};
    for (const [variant, canonical] of pairs) out[_stripAFL(variant)] = _stripAFL(canonical);
    return out;
})();

_STRIP_BY_TYPE.afl_team    = _stripAFL;
_CANONICAL_BY_TYPE.afl_team = CANONICAL_AFL;

function resolveAFLTeamKey(name) {
    return resolveEntity('afl_team', name);
}

export { resolveTeamKey, resolveTeamName, resolveAFLTeamKey, resolveEntity, SOCCER_PLAYER_ID_BY_KEY };
