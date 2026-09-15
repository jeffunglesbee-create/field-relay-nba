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

/** The snapshot anchor the historical odds route asks for, per src/index.js. */
export function windowEndFor(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? `${date}T12:00:00Z` : null;
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
    const window_end = windowEndFor(date);
    return {
        measured: false,
        stored_is: 'run-clock',
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
