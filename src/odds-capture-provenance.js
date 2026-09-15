// src/odds-capture-provenance.js
// WHETHER A BLOB'S captured_at IS A MEASUREMENT, said on the blob itself.
//
// MEASURED 2026-09-15: 58 archived closing lines carry a captured_at that is
// the worker's clock rather than the snapshot the data came from. They were
// written before a1937eb (2026-08-22T21:11:07Z) threaded the snapshot time
// through `extractOddsForGame`. The defect is fixed; these rows are its residue.
//
// A BETTER TIMESTAMP IS NOT AVAILABLE, and that is the whole design constraint.
// The historical endpoint is asked for `<date>T12:00:00Z` and serves the
// snapshot AT OR BEFORE it, returning the real time as `servedAt`. That value
// was never stored and cannot be recovered weeks later. All that is derivable
// is the WINDOW: the capture happened at some point ending at noon UTC.
//
// So this does not repair captured_at. It says what captured_at is:
//
//   _capture: {
//     measured: false,            // the stored value is not the capture time
//     stored_is: 'run-clock',     // what it actually records
//     window_end: '<date>T12:00:00Z',
//     kickoff_decidable: true|false
//   }
//
// `kickoff_decidable` is the field that earns this module. For a match that
// started BEFORE the window closed, the capture could be either side of
// kickoff and `_kickoff.verified` is not supportable either way — measured on
// EPL_2026-08-22_hull_manunited, kickoff 11:30Z against a window ending at
// 12:00. Saying so beside the mark is honest; overwriting the mark would
// replace one unprovable claim with another.
//
// `_kickoff` IS DELIBERATELY NOT TOUCHED. 1383 rows carry it and its contract
// is in CONTRACTS.md; an additive field costs no consumer a migration.
//
// PURE. No I/O, no D1, no clock.

// THE POPULATION, AS ONE SQL PREDICATE, because two copies of it drift and the
// executor and the watch must agree or the watch can never reach zero.
//
// A millisecond fraction is what new Date().toISOString() adds and the vendor's
// whole-second form does not have. `_oddsProof` is written by
// extractOddsForGame (src/index.js) on every blob and by nothing else — notably
// NOT by AmbientDO._captureClosingOdds, whose own clock IS its capture moment.
// Only the historical path writes closing_odds through extractOddsForGame, and
// it has a snapshot time to use. So the two together say: a price replayed from
// a snapshot and stamped with the wrong clock.
//
// Takes the column name because callers alias the table differently.
export function replayedRunClockSql(col = 'closing_odds') {
    return `json_extract(${col},'$.captured_at') GLOB '*.[0-9][0-9][0-9]Z'\n`
         + `           AND json_extract(${col},'$._oddsProof') IS NOT NULL`;
}

/**
 * The snapshot the historical odds route ASKS for — `${isoDate}T12:00:00Z`,
 * unchanged since 60596e4 (2026-06-16), which predates every row in this
 * population.
 */
export function windowAskedFor(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? `${date}T12:00:00Z` : null;
}

/**
 * WHERE THE WINDOW ACTUALLY ENDS, which is earlier than the anchor more often
 * than not — and this is the part that was nearly written off.
 *
 * The run clock was treated as pure noise: the wrong answer to "when was this
 * captured". It is not noise. It is an UPPER BOUND. The vendor serves a
 * historical snapshot at or before the requested timestamp, and the worker
 * stamps its own clock after receiving the response — so the capture cannot be
 * later than the stamp. And when the worker ran BEFORE noon on the match's own
 * date, the noon snapshot had not happened yet; the vendor can only have served
 * something up to the moment of the request.
 *
 *     window_end = min(anchor, run clock)
 *
 * MEASURED CONSEQUENCE: EPL_2026-08-22_hull_manunited, kickoff 11:30Z, stamped
 * 10:00:37Z. Against the noon anchor its kickoff is undecidable — the one row
 * in 874 that was. Against the run clock the whole window closes at 10:00:37,
 * an hour and a half before kickoff, and the row is decidable after all.
 *
 * The discarded value answered the question the replacement could not.
 */
export function windowEndFor(date, capturedAt) {
    const asked = windowAskedFor(date);
    if (!asked) return null;
    const a = Date.parse(asked), c = Date.parse(capturedAt ?? '');
    if (!Number.isFinite(c)) return asked;
    return c < a ? capturedAt : asked;
}

/**
 * Does this blob's captured_at look like a worker clock rather than a snapshot?
 * A millisecond fraction is what `new Date().toISOString()` adds and what the
 * vendor's whole-second form does not have.
 */
export function isRunClockStamp(capturedAt) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(capturedAt || ''));
}

/**
 * Can the kickoff question be decided at all, given only the window?
 * Decidable when the whole window closed before kickoff. If the match started
 * inside the window, the capture may be either side of it and nothing stored
 * says which.
 */
export function kickoffDecidable(windowEnd, startTime) {
    const w = Date.parse(windowEnd ?? '');
    const k = Date.parse(startTime ?? '');
    if (!Number.isFinite(w) || !Number.isFinite(k)) return false;
    return w < k;
}

/**
 * The mark for one row, or null when the row does not need one.
 * @returns {{measured: boolean, stored_is: string, window_end: string|null,
 *            kickoff_decidable: boolean}|null}
 */
export function captureMark(odds, date, startTime) {
    if (!odds || typeof odds !== 'object') return null;
    if (!isRunClockStamp(odds.captured_at)) return null;   // nothing to say
    const window_asked = windowAskedFor(date);
    const window_end = windowEndFor(date, odds.captured_at);
    return {
        measured: false,
        stored_is: 'run-clock',
        // Both are kept: what the call asked for, and where the window really
        // closed. A reader that sees only the effective end cannot tell whether
        // the run clock or the anchor bounded it.
        window_asked,
        window_end,
        kickoff_decidable: kickoffDecidable(window_end, startTime),
    };
}

/**
 * Apply the mark to a copy of the blob. Returns the same object when there is
 * nothing to mark, and NEVER touches `_kickoff`.
 */
export function markCapture(odds, date, startTime) {
    const mark = captureMark(odds, date, startTime);
    if (!mark) return odds;
    return { ...odds, _capture: mark };
}

/** Already marked? Used so a re-run is a no-op rather than a rewrite. */
export function hasCaptureMark(odds) {
    return !!(odds && typeof odds === 'object' && odds._capture
              && odds._capture.measured === false);
}
