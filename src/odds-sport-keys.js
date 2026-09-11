// The one place a sport's Odds API key is written down.
//
// WHY THIS FILE EXISTS
//
// `ARCHIVE_SPORT_TO_ODDS_KEY` was declared twice — index.js and wp-resolver.js —
// with the same sixteen keys and the same sixteen values. Measured, not assumed:
// `scripts/check-odds-key-equivalence.mjs` compared them before this extraction
// and found no key and no value differing. One table, written twice.
//
// This is Rule 50's condition in a second domain (field-laboratory's
// SPORT-PROOF.md: "five separate string-keyed registries"). Reproducing the
// registry pattern is the thing to stop, not just this instance of it.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
//
// It does not merge the three tables into one. They have different KEY SHAPES
// and different COVERAGE, and the coverage difference is a live-cost decision,
// not an accident:
//
//   ARCHIVE (16, short code)   every sport the archive stores odds for
//   CRON    (6, sport|league)  the ESPN scoreboard loop's own vocabulary
//   AMBIENT (11, short code)   the in-play path — six fewer than ARCHIVE
//
// Raising AMBIENT to ARCHIVE's sixteen adds six sports to a path that spends
// Odds API credit on every pre->live transition. That is a budget change gated
// by CC-CMD-2026-09-11 Task 2 and it is NOT made here.
// `check-odds-key-equivalence.mjs` asserts the gap is still exactly six, so it
// cannot be closed by accident.
//
// A NOTE ON WHAT THIS DOES NOT FIX. The CC-CMD that prompted this extraction
// claimed the divergence starves MLS of odds. It does not: ambient's table has
// held `mls: 'soccer_usa_mls'` since 043f4d6 created it. MLS, Bundesliga, CFB
// and NFL resolve through these tables and still receive nothing; the cause is
// downstream of every table here. See
// outbox/cc-session-2026-09-11-odds-key-map-reconcile.md.

// Archive `sport` column (uppercase short codes — D1 introspection 2026-06-16:
// regular_season has MLB/WNBA/EPL/MLS/CFL/AFL/IPL/La Liga/Ligue 1; postseason
// has NBA/NHL/UFL) -> Odds API sport_key.
// Case-insensitive lookup is applied in archiveSportToOddsKey().
export const ARCHIVE_SPORT_TO_ODDS_KEY = {
  nba:        'basketball_nba',
  wnba:       'basketball_wnba',
  nhl:        'icehockey_nhl',
  mlb:        'baseball_mlb',
  epl:        'soccer_epl',
  mls:        'soccer_usa_mls',
  'la liga':  'soccer_spain_la_liga',
  'ligue 1':  'soccer_france_ligue_one',
  bundesliga: 'soccer_germany_bundesliga',
  'serie a':  'soccer_italy_serie_a',
  cfl:        'americanfootball_cfl',
  cfb:        'americanfootball_ncaaf',
  nfl:        'americanfootball_nfl',
  ufl:        'americanfootball_ufl',
  afl:        'aussierules_afl',
  ipl:        'cricket_ipl',
};

// Cron LEAGUES (sport, league) -> Odds API sport_key. Used when the journalism
// cron iterates ESPN scoreboard sports. A DIFFERENT key shape from the archive
// table because its caller has {sport, league} in hand, not a short code.
export const CRON_SPORT_LEAGUE_TO_ODDS_KEY = {
  'basketball|nba':       'basketball_nba',
  'basketball|wnba':      'basketball_wnba',
  'hockey|nhl':           'icehockey_nhl',
  'baseball|mlb':         'baseball_mlb',
  'soccer|eng.1':         'soccer_epl',
  'soccer|fifa.world':    'soccer_fifa_world_cup',
};

// AmbientDO's in-play path. Short codes, as AmbientDO stores them on _scores.
// Carries wc26, which the archive table does not; lacks the six americanfootball
// / aussierules / cricket keys, which the archive table does.
export const AMBIENT_SPORT_TO_ODDS_KEY = {
  nba:        'basketball_nba',
  nhl:        'icehockey_nhl',
  mlb:        'baseball_mlb',
  wnba:       'basketball_wnba',
  wc26:       'soccer_fifa_world_cup',
  epl:        'soccer_epl',
  mls:        'soccer_usa_mls',
  laliga:     'soccer_spain_la_liga',
  seriea:     'soccer_italy_serie_a',
  bundesliga: 'soccer_germany_bundesliga',
  ligue1:     'soccer_france_ligue_one',
};

/** Archive short code -> Odds API key. Case-insensitive; the column is uppercase. */
export function archiveSportToOddsKey(sport) {
  if (!sport) return null;
  return ARCHIVE_SPORT_TO_ODDS_KEY[String(sport).toLowerCase()] || null;
}

/** ESPN cron {sport, league} -> Odds API key. */
export function cronSportLeagueToOddsKey(sport, league) {
  return CRON_SPORT_LEAGUE_TO_ODDS_KEY[`${sport}|${league}`] || null;
}
