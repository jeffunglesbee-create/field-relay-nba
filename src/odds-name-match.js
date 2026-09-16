// One team-name matcher, imported by every consumer.
//
// WHY THIS FILE EXISTS. On 2026-09-16 the tree held three matchers: the cron's
// (.github/scripts/odds-backfill.js:323), the targeted fill's
// (scripts/targeted-odds-fill.mjs:145), and the diagnosis script's. The first
// two were whole-string EQUALITY after stripping non-alphanumerics. Measured
// against outbox/fixture-cfb-2026-09-12.json, that matcher scores 0 of 80 —
// not "poorly", zero — because the vendor appends a mascot to every college
// name and "Georgia" never equals "Georgia Bulldogs". This is the same shape as
// the fourth sport-key registry deleted on 2026-09-15: a private copy of a
// cross-boundary rule, wrong in a way local reading cannot see.
//
// THE PREDICATE. Positional token prefix: split both names on whitespace, and
// require every archive token to prefix the vendor token at the same index. The
// vendor may carry extra trailing tokens — that is the mascot.
//
//   ["western","ky"]      vs ["western","kentucky","hilltoppers"]   -> ky is NOT
//   ["n","colorado"]      vs ["northern","colorado","bears"]        -> match
//   ["illinois","st"]     vs ["illinois","state","redbirds"]        -> match
//
// Whole-string prefix cannot do the middle two: "ncolorado" is not a prefix of
// "northerncoloradobears". Per-token is, and it costs one line.
//
// THE KICKOFF INSTANT IS NOT A KEY. It was the obvious join — and measuring it
// is what removed it. Names alone are unique across this payload (73 solved, 0
// ambiguous), while 5 of those 73 pairs disagree on kickoff by -90 to +1
// minutes. Filtering on the instant would have discarded five correct pairings
// to gain nothing. It belongs where assertOneSportDate uses it: as an
// INDEPENDENT cross-check that the names chose right, never as a filter.
//
// AMBIGUITY IS NEVER RESOLVED BY GUESSING. Two candidates return no event. A
// one-token archive name such as "Ohio" prefixes both "Ohio Bobcats" and "Ohio
// State Buckeyes"; requiring both sides of the pair is what keeps that to zero
// here, and it is a property of a 95-event payload, not a guarantee.

/** Split a team name into comparable tokens. Apostrophes and periods are
 *  REMOVED rather than split on — "Hawai'i" must tokenise to ["hawaii"], not
 *  ["hawai","i"], or it will never reach "Hawaii Rainbow Warriors". */
export function teamTokens(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019'.]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Does `vendorName` name the same team as `archiveName`? Directional: the
 *  archive side is the abbreviated one, the vendor side the expanded one. */
export function nameMatches(archiveName, vendorName) {
  const a = teamTokens(archiveName);
  const v = teamTokens(vendorName);
  if (!a.length || a.length > v.length) return false;
  return a.every((t, i) => v[i].startsWith(t));
}

/**
 * Find the one vendor event for an archive game.
 *
 * @param {{home: string, away: string}} game   archive row
 * @param {Array<{home_team: string, away_team: string}>} events vendor payload
 * @returns {{event: object|null, swapped: boolean, ambiguous: boolean, candidates: Array}}
 *
 * `swapped` means the vendor lists the pairing with home and away reversed. The
 * cron's buildOddsRow keys home_ml off event.home_team, so a swapped row stays
 * internally consistent; the caller must not relabel it with the archive's
 * orientation. Measured 0 of 80 on the CFB fixture — kept because the sports
 * not in that fixture are unmeasured, and counted so that a first firing is
 * visible rather than silent.
 */
export function findVendorEvent(game, events) {
  const list = Array.isArray(events) ? events : [];
  const straight = list.filter(e =>
    nameMatches(game.home, e.home_team) && nameMatches(game.away, e.away_team));
  if (straight.length === 1) return { event: straight[0], swapped: false, ambiguous: false, candidates: straight };
  if (straight.length > 1)   return { event: null, swapped: false, ambiguous: true, candidates: straight };

  const swapped = list.filter(e =>
    nameMatches(game.away, e.home_team) && nameMatches(game.home, e.away_team));
  if (swapped.length === 1)  return { event: swapped[0], swapped: true, ambiguous: false, candidates: swapped };
  if (swapped.length > 1)    return { event: null, swapped: true, ambiguous: true, candidates: swapped };

  return { event: null, swapped: false, ambiguous: false, candidates: [] };
}

/**
 * Read the home/away/draw moneyline out of an h2h market.
 *
 * WHY THIS IS HERE AND NOT AT EACH CALL SITE. Outcome names are the VENDOR's,
 * so they must be keyed off the VENDOR's team names. targeted-odds-fill.mjs
 * compared them to the ARCHIVE's names instead, which returns null for every
 * college game — so a matched event would have inserted a row with home_ml and
 * away_ml empty. That defect was invisible while the matcher above was finding
 * nothing. One reader, so the two writers into odds_history cannot drift again.
 *
 * @param {Array<{name: string, price: number}>} outcomes h2h market outcomes
 * @param {{home_team: string, away_team: string}} event  the vendor event
 * @returns {{home: number|null, away: number|null, draw: number|null}}
 */
export function h2hPrices(outcomes, event) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  const key = (s) => teamTokens(s).join('');
  const priceOf = (teamName) => {
    const k = key(teamName);
    if (!k) return null;
    const o = list.find(x => key(x.name) === k);
    return o && o.price != null ? Number(o.price) : null;
  };
  return {
    home: priceOf(event?.home_team),
    away: priceOf(event?.away_team),
    draw: list.find(o => /^draw$/i.test(o?.name || ''))?.price ?? null,
  };
}
