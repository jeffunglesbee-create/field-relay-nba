// Which same-slate collisions can actually produce a false odds fact.
//
// EXTRACTED FROM THE ROUTE BODY ON PURPOSE. These three predicates decide a
// watch condition, and every previous version of them lived inline in
// /identity/substitution-census where nothing could exercise them. Two shipped
// broken from exactly there: a filter written against `population`, a field
// that does not exist on these rows and made the test vacuously true; and a
// narrowing block placed above the `const` it read, a temporal dead zone that
// `node --check` parses happily and that returned HTTP 500 on every request
// until a six-hourly watch failed loudly. A predicate that cannot be mutated is
// a predicate that has never been shown to work.

/**
 * FNV-1a, 32-bit. Difference detection, not security, and synchronous because
 * it runs per row over a few hundred rows — crypto.subtle.digest is async.
 * null in, null out: a column with no value has no digest, and `null` is
 * distinguishable from every hash.
 */
export function oddsDigest(v) {
    if (v == null) return null;
    const str = typeof v === 'string' ? v : JSON.stringify(v);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * TWO DIFFERENT ESPN EVENT IDS IS A DOUBLEHEADER, not a duplicate: two real
 * games sharing a team pair and a date. Both ids must be present AND differ —
 * one row carrying an id and the other not is the ordinary half-truth pair.
 */
export function twoRealGames(c) {
    const [x, y] = c.games || [];
    return !!(x?.espn_event_id && y?.espn_event_id
              && x.espn_event_id !== y.espn_event_id);
}

/**
 * DISAGREEMENT, NOT PRESENCE, and the difference is what lets the condition
 * ever close. Presence asks "does either row carry a line", which stays true
 * forever once a gap is filled — the hazard gone and the watch still red.
 *
 * The harm is that the join cannot tell the two rows apart and they say
 * DIFFERENT things. Neither carrying odds: safe. Both carrying the same line:
 * safe, whichever one it reaches. One carrying and one not, or two different
 * lines: a false fact is available.
 *
 * COMPARED ON THE DIGEST, never on has_*_odds. Those booleans are a projection:
 * two rows can both read `true` and hold different numbers, which is precisely
 * the false fact, invisible to the flag.
 */
export function oddsDisagree(c) {
    const [x, y] = c.games || [];
    return (x?.opening_odds_digest ?? null) !== (y?.opening_odds_digest ?? null)
        || (x?.closing_odds_digest ?? null) !== (y?.closing_odds_digest ?? null);
}

/**
 * @param {Array} collisions  every same-slate collision, detail already merged in
 * @param {string|null} detailError  the detail read's error, or null
 *
 * A FAILED DETAIL READ LEAVES EVERY DIGEST UNDEFINED, WHICH READS AS AGREEMENT.
 * Rule 99: absence is not zero. If the read failed, nothing has been SHOWN
 * inert, so nothing is — every collision comes back reachable and the condition
 * stays open until a successful read says otherwise.
 */
export function reachableCollisions(collisions, detailError) {
    if (detailError) return collisions.slice();
    return collisions.filter(c => !twoRealGames(c) && oddsDisagree(c));
}
