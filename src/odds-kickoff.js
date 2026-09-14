// Does this odds blob have the right to call itself a closing line?
//
// `closing_odds` means the last price before kickoff. MEASURED 2026-09-14: no
// writer had ever enforced that, and 91 of 877 askable rows were captured at or
// after kickoff — one by 64 days. The guard shipped in 48a19dc stops new ones.
//
// THIS IS THE OTHER HALF, AND IT IS THE HALF THAT MAKES THE OLD ROWS READABLE.
//
// The 91 is not a population, it is a measurement artifact: rows where the
// defect is PROVABLE, because 877 had a start_time to check against and 530 did
// not. Relabelling just the provable ones would take the archive from
// "91 known-bad + 530 unknowable" to "0 known-bad + 530 unknowable", which
// reads as clean — the same failure as choosing between two in-play prices,
// applied to five hundred rows instead of two.
//
// So the row carries the evidence of its own validity, the way `_oddsProof`
// does. A blob with this mark and `verified: true` is provably a closing line.
// One without the mark at all was written before any writer checked, which is
// every row in the archive today and is the honest answer for all of them.
//
// IT NEVER REFUSES. Whether to write is the caller's decision and the three
// writers answer it differently on purpose:
//   archive_game_closing  refuses a late capture — the historical endpoint can
//                         be asked again for a better snapshot.
//   AmbientDO             fires ON the pre-to-live transition, so it is late by
//                         construction (measured 0-25 min). Refusing there
//                         would delete the only near-kickoff capture that
//                         exists; it writes, marked.
//   odds-backfill         is the only source for old games. It writes, marked.

/**
 * @param {string|null|undefined} capturedAt  the blob's own captured_at
 * @param {string|null|undefined} startTime   kickoff, as the archive holds it
 * @returns {{at: string|null, verified: boolean, late_minutes: number|null}}
 */
export function kickoffMark(capturedAt, startTime) {
    // COMPARED AS INSTANTS, NEVER AS TEXT. start_time arrives both as
    // `2026-07-25T20:05Z` and `2026-06-06T23:00:00+00:00`; compared as strings
    // 'Z' (0x5A) sorts above ':' (0x3A), so `...20:05:30.000Z` sorts BELOW
    // `...20:05Z` and a capture thirty seconds late reads as early. That defect
    // shipped in the probe that found the one this file exists for.
    const cap = Date.parse(capturedAt ?? '');
    const kick = Date.parse(startTime ?? '');
    // ABSENT IS NOT ON TIME (Rule 99). A kickoff nobody could read leaves the
    // row unverified, which is what it is — not verified, and not late either.
    if (!Number.isFinite(cap) || !Number.isFinite(kick))
        return { at: typeof startTime === 'string' ? startTime : null,
                 verified: false, late_minutes: null };
    const lateMs = cap - kick;
    return {
        at: startTime,
        verified: lateMs < 0,
        // Only meaningful when it IS late. A pre-kickoff capture reports null
        // rather than a negative, so a consumer summing lateness cannot quietly
        // net an early capture against a late one.
        late_minutes: lateMs < 0 ? null : Math.round(lateMs / 60000),
    };
}

/** Stamps the mark onto an odds object in place and returns it. */
export function stampKickoff(odds, capturedAt, startTime) {
    if (!odds || typeof odds !== 'object') return odds;
    odds._kickoff = kickoffMark(capturedAt, startTime);
    return odds;
}
