// FIELD's "today" for journalism/schedule purposes: ET-anchored with a 4am ET
// rolling cutoff, NOT raw UTC midnight. Moved here from src/index.js on
// 2026-10-22 so AmbientDO can read the same slate (src/index.js imports
// ambient-do.js, so ambient-do.js cannot import from src/index.js).
//
// Ports jubilant-bassoon's window.TODAY_ISO (Drive doc "FIELD App — 2026-06-06
// Session Documentation Part 2 — Scout's Pick + 4am Rollover") to the relay
// side, which never got the same fix and was still using raw
// `new Date().toISOString().slice(0,10)`. ET is correct because FIELD's
// schedule and ESPN's own scoreboard are both ET-anchored; 4am ET is safe
// because no major US sports league starts games after 2am ET, so the 2-hour
// buffer covers overtime/extra innings/late TV windows. Confirmed live
// 2026-07-16: naive UTC-midnight computation advanced "today" to 07-16 at UTC
// 00:00 (= 8pm ET on 07-15, mid-primetime), well before any of that ET
// evening's games — including a completed WNBA game (espn:401857070) — had a
// chance to finish; the correct ET-anchored value stays on 07-15 until 4am ET
// (= 8am UTC). Used everywhere `dateKey` represents "today's slate", not for
// caller-supplied ?date= params.
//
// Before 4am the slate is the previous CALENDAR day, stepped back on the date,
// not 24 hours back on the instant. The spring-forward day is 23 hours long, so
// from 00:00 to 00:59 EDT on the Monday after it (2027-03-15T04:00-04:59Z),
// 24 hours back landed on the Saturday: a 5-minute sweep over 2026-10 to
// 2027-12 found exactly those 12 instants wrong, and none at fall-back
// (docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md, review finding
// G2). The 4am rollback itself is unchanged. The client's window.TODAY_ISO
// (jubilant-bassoon src/legacy/field.js) had the same 24-hour step and is
// fixed the same way, so the two still name the same slate at every instant.
//
// `now` exists so scripts/check-field-date-key.mjs can pin instants; every
// production caller passes nothing.
export function getFieldDateKey(now = new Date()) {
    const etHour = parseInt(
        now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }),
        10
    );
    const etDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
    if (etHour >= 4) return etDate;
    const [y, m, d] = etDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
