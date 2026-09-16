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
  // `a.length > v.length` used to live here and is now redundant: the loop bound
  // below cannot run when the archive name is longer. `!a.length` is NOT
  // redundant — a.every() on an empty array is vacuously true, so an empty
  // archive name would match every vendor event ever.
  if (!a.length) return false;
  // A CONTIGUOUS WINDOW, not an index-0 anchor.
  //
  // Anchoring at 0 was measured on ONE CFB sport-date, where the archive holds
  // the school and the vendor prefixes with it: "Georgia" -> "Georgia
  // Bulldogs". Shipped to the daily cron, it paired 0 of 26 on 2026-09-15
  // (run 35110321483, 80 credits, nothing filled) because MLB is the other way
  // round: the archive holds the nickname ALONE and the vendor puts a city in
  // front of it, at a position that varies.
  //
  //     'Rays'      <- 'Tampa Bay Rays'       nickname at index 2
  //     'Guardians' <- 'Cleveland Guardians'  index 1
  //     'Athletics' <- 'Athletics'            index 0
  //
  // So the archive tokens must match SOME run of consecutive vendor tokens,
  // wherever it starts. Per-token prefixing is unchanged, which is what still
  // carries "N Colorado" -> "Northern Colorado Bears".
  for (let off = 0; off + a.length <= v.length; off++) {
    if (a.every((t, i) => v[off + i].startsWith(t))) return true;
  }
  return false;
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

/** The UTC date string one day after `iso` (YYYY-MM-DD). */
function nextDay(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + 86400000).toISOString().slice(0, 10) : null;
}

/**
 * The events that could belong to `isoDate`'s slate.
 *
 * THE HISTORICAL SNAPSHOT RETURNS FUTURE FIXTURES. Asking for
 * {date}T12:00:00Z on 2026-09-12 returned 95 events of which 15 kick off on
 * 09-17 through 09-20. They are not candidates for that date's games and their
 * only effect is to manufacture ambiguity: "GA Southern @ Clemson" had two
 * "Clemson" opponents to choose between, and the rival was a week later.
 *
 * The window is the date AND the next, because a Saturday evening slate runs
 * past midnight UTC — 10 of the 80 in-window events on 2026-09-12 carry a
 * 09-13 commence_time.
 */
export function slateWindow(events, isoDate) {
  const list = Array.isArray(events) ? events : [];
  const d2 = nextDay(isoDate);
  if (!isoDate || !d2) return list;          // no date to filter on: change nothing
  const ok = new Set([isoDate, d2]);
  return list.filter(e => ok.has(String(e?.commence_time || '').slice(0, 10)));
}

/**
 * Match a whole slate at once, rather than each game independently.
 *
 * WHY A SLATE AND NOT A ROW. The per-row matcher above cannot read an
 * initialism: "ETSU" is not a prefix of "East Tennessee State Buccaneers" and
 * no amount of tuning makes it one. Seven of 80 games failed on exactly that.
 *
 * The novel part is that the abbreviation never has to be read. The two sides
 * are the SAME SLATE, so a vendor event can belong to at most one archive row.
 * Once stage 1 pins the unambiguous pairs, those events are spent — and each
 * remaining row still matches uniquely on the side that is NOT abbreviated.
 * "ETSU @ North Carolina" has exactly one unclaimed opponent at North Carolina,
 * so the pairing is forced by elimination without decoding "ETSU" at all.
 *
 * Measured on outbox/fixture-cfb-2026-09-12.json: stage 1 solves 73, stage 2
 * forces the remaining 7, total 80 of 80 with zero alias entries. Six of the
 * seven land at kickoff delta 0 on the independent cross-check.
 *
 * THIS IS NOT A FALLBACK (and the repo bans those). A fallback guesses when the
 * primary fails. This adds a fact: a vendor event pairs with at most one game.
 *
 * IT MUST DEGRADE SAFELY, and that is tested rather than assumed. Dropping each
 * archive row in turn mis-forces nothing (80 of 80); dropping each of the seven
 * forced events makes its row unmatched rather than sending it to a substitute
 * (7 of 7). A row with two candidates is refused, never resolved by order.
 *
 * @param {Array<{id: string, home: string, away: string}>} games
 * @param {Array<object>} events raw vendor payload, unfiltered
 * @param {string} isoDate the slate's date, YYYY-MM-DD
 * @returns {{
 *   byGameId: Map<string, {event: object, swapped: boolean, stage: 1|2}>,
 *   stage1: number, stage2: number, unmatched: number,
 *   ambiguous: number, poolSize: number, droppedOutOfWindow: number,
 * }}
 */
export function matchSlate(games, events, isoDate) {
  const rows = Array.isArray(games) ? games : [];
  const all  = Array.isArray(events) ? events : [];
  const pool = slateWindow(all, isoDate);

  const byGameId = new Map();
  const claimed  = new Set();
  const residual = [];
  let ambiguous = 0;

  // STAGE 1 — both sides, unique. Order-independent: each row is decided
  // against the whole pool, so no row's outcome depends on another's.
  for (const g of rows) {
    const r = findVendorEvent(g, pool);
    if (r.ambiguous) { ambiguous++; residual.push(g); continue; }
    if (!r.event) { residual.push(g); continue; }
    byGameId.set(g.id, { event: r.event, swapped: r.swapped, stage: 1 });
    claimed.add(r.event.id);
  }

  // STAGE 2 — one side, among events stage 1 did not spend.
  const free = pool.filter(e => !claimed.has(e.id));
  const proposals = new Map();               // gameId -> event
  const wantedBy  = new Map();               // eventId -> [gameId]
  for (const g of residual) {
    const c = [...new Set([
      ...free.filter(e => nameMatches(g.home, e.home_team)),
      ...free.filter(e => nameMatches(g.away, e.away_team)),
    ])];
    if (c.length !== 1) continue;            // 0 or many: not forced, never guessed
    proposals.set(g.id, c[0]);
    wantedBy.set(c[0].id, [...(wantedBy.get(c[0].id) || []), g.id]);
  }

  // Two rows forcing the SAME event is not an elimination, it is a collision.
  // Both are refused — resolving it by iteration order would make the result
  // depend on payload order, which is the defect the ambiguity guard exists for.
  let stage2 = 0;
  for (const [gameId, event] of proposals) {
    if ((wantedBy.get(event.id) || []).length !== 1) { ambiguous++; continue; }
    byGameId.set(gameId, { event, swapped: false, stage: 2 });
    stage2++;
  }

  return {
    byGameId,
    stage1: byGameId.size - stage2,
    stage2,
    unmatched: rows.length - byGameId.size,
    ambiguous,
    poolSize: pool.length,
    droppedOutOfWindow: all.length - pool.length,
  };
}
