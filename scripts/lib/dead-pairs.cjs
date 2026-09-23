// WHICH SPORT-DATE PAIRS ARE KNOWN TO BUY NOTHING, AND UNDER WHAT CODE.
//
// WHY THIS EXISTS
//
// The 2026-09-19 fill spent 200 credits on ten pairs. Six priced 99-100%.
// Four did not, and the reasons were NOT the same (from the run's own log,
// outbox/targeted-odds-fill-20260919T032609Z.log):
//
//   2026-08-22 nfl      272 event(s),  0 in window ->  0/10 priced
//   2026-08-28 nfl      272 event(s),  0 in window ->  0/10 priced
//   2026-05-24 la liga    1 event(s),  1 in window ->  1/10 priced
//   2026-09-12 cfb       95 event(s), 80 in window ->  0/13 priced
//
// Nothing records any of that. The plan is rebuilt from games with no
// odds_history row and sorted by game count, so all four sort straight back to
// the top and the next fill re-buys them at 20 credits each.
//
// THE PART THAT MAKES THIS DANGEROUS TO BUILD CARELESSLY. Those four are dead
// for three different reasons, and only one of them is a property of the
// vendor's data:
//
//   no-events        the vendor has nothing for that sport-date at all.
//                    A function of the REQUEST (regions, markets, hour).
//   none-in-window   events came back, none inside the date window.
//                    A function of the window rule, which lives in matchSlate.
//   pool-exhausted   every in-window event was already used; the games still
//                    wanted have no event left to match.
//   priced-zero      events in window, names matched, nothing priced.
//                    A function of the matcher and the price reader.
//
// A ledger that excluded all four permanently would make `priced-zero` pairs
// unreachable forever — and `priced-zero` is precisely the class a matcher fix
// recovers. The 2026-09-12 cfb pair matched 12 events by name and priced none;
// that is a bug in our reading, not an absence in their data.
//
// SO EVERY ROW RECORDS THE CODE IT WAS MEASURED UNDER. A matcher-dependent
// exclusion expires by itself the moment src/odds-name-match.js changes. No
// constant to bump, no human to remember: the ledger says what it was true of,
// and stops applying when that stops being the code.
'use strict';

/**
 * ONE MAPPING, NOT TWO SETS. This was a VENDOR_CLASSES set and a
 * MATCHER_CLASSES set, and a class could sit in both — in which case the
 * matcher expiry silently won and the vendor membership did nothing. The
 * mutation harness found it: moving `priced-zero` into the vendor set changed
 * no behaviour at all, because it stayed in the matcher set as well, so the
 * mutation was dead and the property it aimed at was untested.
 *
 * 'vendor'  — a fact about THEIR data. Survives any change to our code.
 * 'matcher' — a fact about OUR reading. Expires when src/odds-name-match.js
 *             changes, which is what makes this ledger safe to write at all.
 */
const CLASS_KIND = {
  'no-events':        'vendor',
  'vendor-exhausted': 'vendor',
  'none-in-window':   'matcher',
  'pool-exhausted':   'matcher',
  'priced-zero':      'matcher',
};

const kindOf = (klass) => CLASS_KIND[klass] || null;
const VENDOR_CLASSES = new Set(Object.keys(CLASS_KIND).filter(k => CLASS_KIND[k] === 'vendor'));
const MATCHER_CLASSES = new Set(Object.keys(CLASS_KIND).filter(k => CLASS_KIND[k] === 'matcher'));
const DEAD_CLASSES = new Set(Object.keys(CLASS_KIND));

const pairKey = (sport, date) => `${String(date)}\t${String(sport).toLowerCase()}`;

/**
 * What a completed attempt on one pair means.
 * @param {{events:number, inWindow:number, priced:number, wanted:number}} o
 * @returns {string} one of: complete, partial, priced-zero, pool-exhausted,
 *                   none-in-window, no-events, unknown
 *
 * ORDER MATTERS and is from narrowest to widest. `complete` first because a
 * pair that got everything is not dead by any of the routes below.
 */
function classifyPair(o) {
  if (!o || typeof o !== 'object') return 'unknown';
  const { events, inWindow, priced, wanted } = o;
  for (const v of [events, inWindow, priced, wanted]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'unknown';
  }
  if (wanted === 0) return 'unknown';           // nothing was being asked for
  if (priced >= wanted) return 'complete';
  if (events === 0) return 'no-events';
  // THE VENDOR CANNOT SUPPLY THE REMAINDER, however well we read it. This is a
  // counting fact, not a matching one: 2026-05-24 la liga returned ONE event
  // against ten wanted games, priced that one, and left nine that no matcher
  // can reach because there is nothing to reach. Re-buying returns the same
  // single event, already priced, for another 20 credits.
  //
  // `events` is the WHOLE snapshot the historical endpoint returned, which is
  // wider than our date — 2026-08-22 nfl got 272 events with none in window. So
  // using it as the ceiling is conservative in the safe direction: if even that
  // inflated count cannot cover the remainder, the in-window count certainly
  // cannot. A pair is only called vendor-exhausted when the inequality holds
  // against the generous number.
  if (events < wanted - priced) return 'vendor-exhausted';
  if (inWindow === 0) return 'none-in-window';
  if (priced === 0) return 'priced-zero';
  // Some priced, some not. Dead only if the in-window pool is used up: an
  // unused in-window event is a game a better matcher could still reach.
  if (inWindow <= priced) return 'pool-exhausted';
  return 'partial';
}

/**
 * Does this ledger row still forbid spending, given the code running now?
 * @param {{klass:string, params_fp:string, matcher_fp:string}} row
 * @param {{params_fp:string, matcher_fp:string}} now
 */
function stillDead(row, now) {
  if (!row || !now) return false;
  const kind = kindOf(row.klass);
  if (kind === null) return false;
  // The request shape governs every class: a different regions/markets/hour is
  // a different question, and the old answer does not apply to it.
  if (row.params_fp !== now.params_fp) return false;
  // Matcher-dependent classes additionally expire when the matcher changes.
  if (kind === 'matcher' && row.matcher_fp !== now.matcher_fp) return false;
  return true;
}

/**
 * Split a plan into what is worth buying and what is already known to be dead.
 * @returns {{kept: any[], skipped: {key,sport,date,klass,credits}[], creditsSaved:number}}
 */
function excludeDead(pairs, ledger, now, perCallCost) {
  if (!Array.isArray(pairs)) return { kept: [], skipped: [], creditsSaved: 0 };
  const by = new Map();
  for (const row of (Array.isArray(ledger) ? ledger : [])) {
    if (row && row.sport != null && row.date != null) by.set(pairKey(row.sport, row.date), row);
  }
  const kept = [], skipped = [];
  for (const p of pairs) {
    const row = by.get(pairKey(p.sport, p.date));
    if (row && stillDead(row, now)) {
      skipped.push({ key: pairKey(p.sport, p.date), sport: p.sport, date: p.date,
                     klass: row.klass, credits: Number(perCallCost) || 0 });
    } else kept.push(p);
  }
  return { kept, skipped, creditsSaved: skipped.length * (Number(perCallCost) || 0) };
}

module.exports = {
  classifyPair, stillDead, excludeDead, pairKey, kindOf,
  CLASS_KIND, VENDOR_CLASSES, MATCHER_CLASSES, DEAD_CLASSES,
};
