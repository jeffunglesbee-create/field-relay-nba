// src/nfl-epa.js
// Per-play Expected Points Added, transcribed from jubilant-bassoon's
// `_computeESPNPlayEPA` / `_epLookup` (src/legacy/field.js).
//
// EXTRACTED RATHER THAN INLINED IN THE ROUTE, for one reason: a transcription
// that nothing can compare against the original is a claim, not a fact. With
// the computation exported, `scripts/nfl-epa-transcription-check.mjs` holds the
// CLIENT's code verbatim as its reference and asserts the two agree across a
// grid of inputs. If either side is ever edited alone, that check fails — which
// is the whole point of moving the model here rather than copying it.
//
// Same one-file-one-concern convention as cache-helpers.js, odds-shape.js and
// soccer-wp.js.
//
// Every ESPN field read here was verified live against a real game by
// scripts/nfl-epa-shape-probe.mjs (14/14, artifact
// outbox/nfl-epa-shape-probe-20260815T013003Z.log): start.{down,distance,
// yardsToEndzone}, type.text, scoringPlay, isTurnover, end.{down,distance,
// yardsToEndzone}. `yardsToEndzone` IS yardline_100 — no conversion — which
// that probe asserts by name because guessing it wrong is silent.

/// Plays that carry no EPA. Verbatim from the client's SKIP list.
export const SKIP_TYPES = [
    'Kickoff', 'Extra Point', 'Two-Point Conversion', 'Timeout',
    'Two Minute Warning', 'End of Period', 'End of Half', 'End of Game',
];

const YTG_BUCKETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 20, 25];
const YL100_BUCKETS = [1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91, 96];

const nearest = (v, arr) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b));

/// The lookup table, unwrapped from what the relay serves.
///
/// `epa_table.json` is NOT the table. It is
/// `{generated, method, description, inputs, ytg_buckets, yl100_buckets, ep,
/// turnover_ep}` — the 1120 EP entries live under `.ep`. The client unwraps it
/// (`_epTable = d.ep || d`) and so must this.
///
/// This function exists because getting it wrong was silent. The route's first
/// version passed the whole document to `epLookup`, every key missed, `?? 0`
/// returned, and the live probe reported "ROUTE MATCHES CLIENT — 149 route
/// plays, 149 client plays, 0 disagreements" — because both sides were being
/// compared on a table only one of them had unwrapped. Agreement on zero is
/// still agreement. `?? json` preserves the client's `|| d` fallback so a flat
/// table still works.
///
/// `turnover_ep` is deliberately unused: the client's turnover branch computes
/// `-epLookup(1, 10, 100 - yl100)` rather than reading that table, and this is a
/// transcription, not an improvement.
export function epTableFrom(json) {
    return json?.ep ?? json;
}

/// Expected points at a down/distance/field position, bucketed.
///
/// Returns 0 for a key the table does not carry — and 0 is a REAL expected-points
/// value, so a miss and a genuine zero are indistinguishable. That is the
/// client's behaviour and it is preserved deliberately: "improving" it here
/// would make this a second model rather than the same one, which is the
/// divergence this file exists to prevent.
export function epLookup(table, down, ytg, yl100) {
    if (!table) return 0;
    const y = nearest(Math.min(Math.max(ytg, 1), 25), YTG_BUCKETS);
    const l = nearest(Math.max(1, Math.min(99, yl100)), YL100_BUCKETS);
    return table[`${down}_${y}_${l}`] ?? 0;
}

/// One ESPN play → its EPA, or `null` when the play has none.
///
/// `null` covers four distinct cases the client also collapses: no `start`, a
/// skipped play type, a snap missing down/distance/field position, and a
/// non-scoring non-turnover play with no resolved `end`. They are collapsed
/// because the consumer's question is only "is there an EPA here", and splitting
/// them would be a shape the client cannot produce.
export function playEpa(table, play) {
    if (!play?.start) return null;
    const ptext = play.type?.text || '';
    if (SKIP_TYPES.some(t => ptext.includes(t))) return null;

    const down = play.start.down, ytg = play.start.distance, yl100 = play.start.yardsToEndzone;
    if (!down || !ytg || !yl100) return null;

    const epStart = epLookup(table, down, ytg, yl100);
    let epEnd;
    if (play.scoringPlay) {
        const lc = ptext.toLowerCase();
        // 6.96, not 7: the touchdown value carries the expected points of the
        // conversion attempt that follows. A made field goal is exactly 3.
        epEnd = (lc.includes('field goal') && !lc.includes('miss')) ? 3 : 6.96;
    } else if (play.isTurnover) {
        // The opponent's expected points, negated: possession flipped, and the
        // field position flips with it.
        epEnd = -epLookup(table, 1, 10, Math.max(1, Math.min(99, 100 - yl100)));
    } else {
        if (!play.end || play.end.yardsToEndzone === undefined || play.end.yardsToEndzone === null) return null;
        epEnd = epLookup(table, play.end.down, play.end.distance, play.end.yardsToEndzone);
    }

    return {
        id: play.id ?? null,
        epa: Math.round((epEnd - epStart) * 100) / 100,
        ep_start: epStart,
        ep_end: epEnd,
        scoringPlay: play.scoringPlay === true,
        // The three lookup inputs, passed through under ESPN's own names.
        //
        // The client renders a situation label from exactly these ("3rd & 7 @
        // OPP 22"). Serving that STRING instead would put an English word list
        // and an OWN/OPP viewpoint choice in the relay, and a second consumer
        // wanting a different label would have to un-format it. A neutral data
        // vendor publishes down, distance and field position; whoever displays
        // them writes the sentence. Rule 60 is satisfied by serving the inputs
        // the consumer reads -- formatting numbers into a label is rendering,
        // not the normalization layer Rule 64 forbids.
        down,
        distance: ytg,
        yardsToEndzone: yl100,
    };
}
