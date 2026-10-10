// Forwarding the BSD event fields that already arrive and were being dropped.
//
// Task 2 and Task 3 of docs/CC-CMD-2026-10-10-bsd-fields-already-arriving.md.
//
// NO NEW UPSTREAM CALL. The WC enrichment at src/index.js already fetches the
// full event row and copied exactly two fields off it — `group_name` and
// `weather`. Everything else on that row was discarded at the point of use.
// This forwards the rest off the SAME row.
//
// RULE 62 — the public shape stays BSD's. `is_local_derby` is not renamed to
// `derby`, and `head_to_head` is not collapsed into a summary: a consumer that
// wants a rate can divide. A relay that reshapes is a relay the client has to
// un-reshape, and the contract then lives in two places.
//
// RULE 99 — absence is a SIBLING of the value, not a value. The live census on
// 2026-10-10 is why this is not optional:
//
//     attendance             0 present, 193 null   <- in the schema, never populated
//     previous_leg_event_id  0 present, 193 null   <- same
//     round_name             0 present, 193 EMPTY  <- empty string, not null
//     is_local_derby       193 present             <- and its value is often FALSE
//
// Serialize a missing `attendance` as 0 and a brief can report a crowd of
// nobody. Treat `is_local_derby: false` as missing and the 193 rows that
// answered the question read as 193 rows that did not.

/** The fields the CC-CMD names, as BSD names them. */
export const FORWARDED = [
  'has_xg', 'pitch_condition', 'travel_distance_km', 'is_local_derby',
  'is_neutral_ground', 'attendance', 'head_to_head', 'round_label',
  'round_name', 'round_number', 'stage', 'stage_name',
  'previous_leg_event_id', 'referee_id', 'home_coach_id', 'away_coach_id',
  'highlights',
];

/** Is this value a reading, or the absence of one?
 *
 *  `false` and `0` ARE readings — that is the whole distinction. An empty
 *  string and an empty array are not: BSD uses `round_name: ""` on every row
 *  of the 2026-10-10 census and an empty `highlights` on 134 of 193, and
 *  neither carries information a brief could cite. */
export const isReading = (v) => {
  if (v === null || v === undefined) return false;
  if (v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true; // includes false and 0, deliberately
};

/** Forward the fields that carry a reading, and name the ones that do not.
 *
 *  The returned object has BSD's own keys for anything present, plus
 *  `_notReported`: the names that came back null, absent or empty. A consumer
 *  asking "was there a crowd of zero, or no crowd figure?" reads
 *  `'attendance' in bsd` for the first and `_notReported.includes('attendance')`
 *  for the second, and the two can never both be true. */
export const forwardBsdFields = (row, names = FORWARDED) => {
  const out = {};
  const notReported = [];
  for (const k of names) {
    const v = row?.[k];
    if (isReading(v)) out[k] = v;
    else notReported.push(k);
  }
  out._notReported = notReported;
  return out;
};

/** The invariant Task 3 asks a check to assert, as a function so the check and
 *  the code under it cannot drift: no name is ever both forwarded and listed
 *  as not reported, and every requested name lands in exactly one of the two. */
export const partitionIsExact = (bsd, names = FORWARDED) => {
  const present = Object.keys(bsd).filter(k => k !== '_notReported');
  const missing = bsd._notReported ?? [];
  const both = present.filter(k => missing.includes(k));
  const neither = names.filter(k => !present.includes(k) && !missing.includes(k));
  return { ok: both.length === 0 && neither.length === 0, both, neither };
};
