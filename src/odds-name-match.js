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
// THE KICKOFF INSTANT IS NOT A KEY, BUT IT MAY REFUSE (owner ruling 2026-10-19).
// It was the obvious join, and measuring it is what removed it: names alone are
// unique on the 2026-09-12 CFB payload (73 solved, 0 ambiguous), while 5 of
// those 73 pairs disagree on kickoff by -90 to +1 minutes. So it still never
// CHOOSES a pair. The 2026-10-19 census showed what names alone cannot see:
// 12 MLB games paired with the same two teams' NEXT game (gaps 1141-1740 min)
// and 3 doubleheader twins sharing one event (206-301 min). The owner ruled that
// the instant may refuse (docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md):
//   - any pair more than KICKOFF_REFUSE_MINUTES off is refused, in both stages;
//   - on an event two games claimed, a game more than
//     CONTESTED_KICKOFF_MINUTES off is refused, and the others keep the pair.
// A missing instant refuses nothing: it is counted (unjudgedKickoff), not judged. Every refusal
// leaves its event claimed, so refusing can only remove pairs, never add one.
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
 * Could `archiveName` be an ABBREVIATION of `vendorName`? Weaker than
 * nameMatches, and used only where nameMatches has already said no: on the
 * side stage 2 of matchSlate pairs WITHOUT reading.
 *
 * WHY (docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md, task 1). Stage 2
 * exists for names the predicate cannot read, such as "ETSU" or "Jax State".
 * It never checked that the unread side could be that team at all. Measured
 * 2026-10-19 over the 49 one-sided pairs stored since 2026-09-16:
 * - 11 were another team's game: "Arkansas" took Jacksonville State's event,
 *   7 MLB and 3 NHL rows took a team's NEXT-DAY game, "Blue Jays" against
 *   Chicago White Sox.
 * - 38 were the right team under an abbreviation: Jax State, GA Southern,
 *   MTSU, FIU, QPR, MK Dons, Nottm Forest, Wolves, UAlbany, The Citadel.
 *
 * THE RULE. An abbreviation keeps the first letter of the name it shortens,
 * so the archive name's first letter must be the vendor name's first letter.
 * "UAlbany" and "The Citadel" keep it differently: one archive token contains
 * the vendor's whole first token, of 4 letters or more. A leading "the" is not
 * stripped: containment already reads the one archive name that has it, and
 * no vendor name in the 776 stored rows starts with it.
 * On those 49 rows this refuses all 11 wrong ones and 1 right one, "Boro" for
 * Middlesbrough, a nickname rather than an abbreviation.
 *
 * WHAT IT DOES NOT CATCH. A wrong team whose name happens to share the first
 * letter: about 5% of (archive name, non-matching vendor team) combinations in
 * MLB, NHL and CFB pass. Comparing against ANY vendor token instead of the
 * first one passes 10-15%, which is why it is the first.
 *
 * @returns {boolean}
 */
export function couldAbbreviate(archiveName, vendorName) {
  const a = teamTokens(archiveName), v = teamTokens(vendorName);
  if (!a.length || !v.length) return false;
  if (a[0][0] === v[0][0]) return true;
  return v[0].length >= 4 && a.some(t => t.includes(v[0]));
}

/** Minutes from the archive kickoff to the vendor's (vendor minus archive), or
 *  null when either instant is missing or unreadable. */
export function kickoffGapMinutes(game, event) {
  const a = Date.parse(game?.start_time || ''), v = Date.parse(event?.commence_time || '');
  return Number.isFinite(a) && Number.isFinite(v) ? Math.round((v - a) / 60000) : null;
}

// THE TWO LIMITS, from the 2026-10-19 census of 776 stored pairs
// (outbox/fixture-odds-pairs-2026-10-19.json, measured in check-odds-matcher):
// - right pairs reach -130 min (CFB Clemson @ LSU), and a rain-delayed MLB game
//   +235; the next-day class starts at +1141. 720 refuses all 12 of that class
//   and none of the right pairs.
// - on a shared event, the right doubleheader game sits 1-6 min away and its
//   twin 206-301. 90 is the census's own "gap over 90" line, and it separates
//   them.
export const KICKOFF_REFUSE_MINUTES = 720;
export const CONTESTED_KICKOFF_MINUTES = 90;
const beyond = (gap, limit) => gap !== null && Math.abs(gap) > limit;

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
 * Which way round a stored pairing is: does the vendor's home team name the
 * archive's home team ('straight') or its away team ('swapped')?
 *
 * WHY IT EXISTS (docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md, task 2).
 * odds_history keeps the vendor's orientation, so a swapped pairing is
 * consistent THERE. The sync into the game tables then wrote
 * `moneyline.home = home_ml` by position. That gave the archive's home team the
 * vendor's home team's price, which was the other team.
 *
 * Measured 2026-10-19 on CFB_2026-09-19_e401856802:
 * - archive: home Virginia, away West Virginia;
 * - vendor: home West Virginia Mountaineers 9.7, away Virginia Cavaliers 1.06;
 * - game row as synced: home +870, away −1667, the two teams' prices exchanged.
 *
 * Both sides must agree before a direction is named, because one side alone is
 * not evidence here: "Virginia" also prefix-matches "West Virginia
 * Mountaineers". When neither or both directions hold on both sides, the
 * single-side reading decides only if it is unambiguous. Stage 2 pairs are
 * straight by construction, so this gives 'straight' for them. Anything else
 * is null, and the caller must not guess.
 *
 * @param {{home: string, away: string}} game  archive row
 * @param {{home_team: string, away_team: string}} pair the vendor's teams
 * @returns {'straight'|'swapped'|null}
 */
export function pairOrientation(game, pair) {
  const hh = nameMatches(game?.home, pair?.home_team), aa = nameMatches(game?.away, pair?.away_team);
  const ah = nameMatches(game?.away, pair?.home_team), ha = nameMatches(game?.home, pair?.away_team);
  const straightBoth = hh && aa, swappedBoth = ah && ha;
  if (straightBoth !== swappedBoth) return straightBoth ? 'straight' : 'swapped';
  if (straightBoth) return null;                 // both directions fit on both sides
  const straightSide = hh || aa, swappedSide = ah || ha;
  if (straightSide !== swappedSide) return straightSide ? 'straight' : 'swapped';
  return null;
}

/**
 * A stored odds_history row's moneylines, keyed to the ARCHIVE game's sides.
 * This is what the sync into the game tables writes, so the price follows the
 * team rather than the position. Null when pairOrientation cannot read the
 * direction: the caller writes nothing rather than guess.
 *
 * @param {{home: string, away: string}} game  archive row
 * @param {{home_team: string, away_team: string, home_ml: number, away_ml: number}} row odds_history row
 * @returns {{home: number|null, away: number|null, orientation: 'straight'|'swapped'}|null}
 */
export function pricesByTeam(game, row) {
  const orientation = pairOrientation(game, row);
  if (!orientation) return null;
  const [home, away] = orientation === 'swapped'
    ? [row.away_ml, row.home_ml]
    : [row.home_ml, row.away_ml];
  return { home: home ?? null, away: away ?? null, orientation };
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
 *   ambiguous: number, contradicted: number, lateKickoff: number, sharedRefused: number,
 *   unjudgedKickoff: number,
 *   poolSize: number, droppedOutOfWindow: number,
 * }}
 */
export function matchSlate(games, events, isoDate) {
  const rows = Array.isArray(games) ? games : [];
  const all  = Array.isArray(events) ? events : [];
  const pool = slateWindow(all, isoDate);

  const byGameId = new Map();
  const claimed  = new Set();
  const residual = [];
  const byId = new Map(rows.map(g => [g.id, g]));
  let ambiguous = 0, lateKickoff = 0, sharedRefused = 0, unjudgedKickoff = 0;

  // STAGE 1 — both sides, unique. Order-independent: each row is decided
  // against the whole pool, so no row's outcome depends on another's.
  //
  // A row refused here by the kickoff is refused OUTRIGHT, not sent to stage 2,
  // and its event stays claimed. Either shortcut would let a refusal hand a row
  // or an event to elimination, and a refusal would then create a pair.
  //
  // A CLAIM IS COUNTED BEFORE ANY REFUSAL. A game refused for its kickoff still
  // named the event, so it still makes the event shared. Counting only the
  // survivors would let a twin 300 min off keep the event whenever the other
  // claimant happened to be refused, and one refusal would create a pair
  // (found by review, 2026-10-20).
  const named = new Map();                   // gameId -> {event, swapped}
  const claimants = new Map();               // eventId -> games that named it
  for (const g of rows) {
    const r = findVendorEvent(g, pool);
    if (r.ambiguous) { ambiguous++; residual.push(g); continue; }
    if (!r.event) { residual.push(g); continue; }
    claimed.add(r.event.id);
    claimants.set(r.event.id, (claimants.get(r.event.id) ?? 0) + 1);
    if (beyond(kickoffGapMinutes(g, r.event), KICKOFF_REFUSE_MINUTES)) { lateKickoff++; continue; }
    named.set(g.id, r);
  }

  // ONE EVENT, SEVERAL GAMES: the claim check. Stage 1 decides rows one at a
  // time, so a doubleheader's two games both name the one event the snapshot
  // still lists. The game whose known kickoff is CONTESTED_KICKOFF_MINUTES off
  // is refused; the rest keep the pair they already had. That keeps the MLS
  // fixtures archived twice (one copy has no kickoff), which are the same game
  // and both priced right.
  //
  // A pair kept without a kickoff on both sides is counted as UNJUDGED, so the
  // caller can print how many of its pairs the rule actually saw (Rule 91).
  for (const [gameId, r] of named) {
    const gap = kickoffGapMinutes(byId.get(gameId), r.event);
    if (claimants.get(r.event.id) > 1 && beyond(gap, CONTESTED_KICKOFF_MINUTES)) {
      sharedRefused++;
      continue;
    }
    if (gap === null) unjudgedKickoff++;
    byGameId.set(gameId, { event: r.event, swapped: r.swapped, stage: 1 });
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
  //
  // THE UNREAD SIDE MUST BE ABLE TO BE THAT TEAM (couldAbbreviate). It is
  // checked HERE, after the collision test, and never by dropping a proposal
  // earlier: a refused row still holds its claim on the event, so a row it
  // collided with stays refused too. Refusing can only remove pairs, never add.
  let stage2 = 0, contradicted = 0;
  for (const [gameId, event] of proposals) {
    if ((wantedBy.get(event.id) || []).length !== 1) { ambiguous++; continue; }
    const g = byId.get(gameId);
    const homeHit = nameMatches(g.home, event.home_team), awayHit = nameMatches(g.away, event.away_team);
    if (!(homeHit && awayHit)
        && !(homeHit ? couldAbbreviate(g.away, event.away_team) : couldAbbreviate(g.home, event.home_team))) {
      contradicted++;
      continue;
    }
    const gap2 = kickoffGapMinutes(g, event);
    if (beyond(gap2, KICKOFF_REFUSE_MINUTES)) { lateKickoff++; continue; }
    if (gap2 === null) unjudgedKickoff++;
    byGameId.set(gameId, { event, swapped: false, stage: 2 });
    stage2++;
  }

  return {
    byGameId,
    stage1: byGameId.size - stage2,
    stage2,
    unmatched: rows.length - byGameId.size,
    ambiguous,
    contradicted,
    lateKickoff,
    sharedRefused,
    unjudgedKickoff,
    poolSize: pool.length,
    droppedOutOfWindow: all.length - pool.length,
  };
}
