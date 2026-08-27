// nfl-epa-transcription-check.mjs — the relay's EPA is the CLIENT's EPA.
//
// WHY THIS EXISTS. CC-CMD-2026-08-27-relay-per-play-epa moves the EP model from
// jubilant-bassoon's browser to this relay so there is ONE model rather than two
// free to disagree. A transcription that nothing compares against the original
// is a claim, not a fact — so this file holds the client's code VERBATIM as its
// reference and asserts the two agree.
//
// The reference below is copied from jubilant-bassoon/src/legacy/field.js
// (`_epLookup`, `_computeESPNPlayEPA`) at 2026-08-27. It is deliberately NOT
// imported: this repo cannot import that one, and a paraphrase would test the
// paraphrase. If either side is edited alone, this check fails, which is the
// only thing that keeps "one model" true after today.
//
// Offline. No network, no fixtures — a synthetic grid over every branch, which
// is what makes it runnable in CI and in a sandbox alike.

import { playEpa, epLookup } from '../src/nfl-epa.js';

let pass = 0, fail = 0;
const A = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        → ${detail}`}`);
    ok ? pass++ : fail++;
};

// ── the client, verbatim ────────────────────────────────────────────────────
let _epTable = null;
function _epLookup(down, ytg, yl100) {
    if (!_epTable) return 0;
    const ytgBuckets = [1,2,3,4,5,6,7,8,9,10,11,15,20,25];
    const yl100Buckets = [1,6,11,16,21,26,31,36,41,46,51,56,61,66,71,76,81,86,91,96];
    const nearest = (v, arr) => arr.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) ? x : b);
    const ytgB = nearest(Math.min(Math.max(ytg, 1), 25), ytgBuckets);
    const yl100B = nearest(Math.max(1, Math.min(99, yl100)), yl100Buckets);
    return _epTable[`${down}_${ytgB}_${yl100B}`] ?? 0;
}
function _computeESPNPlayEPA(play) {
    if (!play?.start) return null;
    const SKIP = ['Kickoff','Extra Point','Two-Point Conversion','Timeout','Two Minute Warning','End of Period','End of Half','End of Game'];
    const ptext = play.type?.text || '';
    if (SKIP.some(t => ptext.includes(t))) return null;
    const down = play.start.down, ytg = play.start.distance, yl100 = play.start.yardsToEndzone;
    if (!down || !ytg || !yl100) return null;
    const epStart = _epLookup(down, ytg, yl100);
    if (play.scoringPlay) {
        const lc = ptext.toLowerCase();
        const isFG = lc.includes('field goal') && !lc.includes('miss');
        const epEnd = isFG ? 3 : 6.96;
        const epa = Math.round((epEnd - epStart) * 100) / 100;
        return { epa, ep_start: epStart, ep_end: epEnd };
    }
    if (play.isTurnover) {
        const epEnd = -_epLookup(1, 10, Math.max(1, Math.min(99, 100 - yl100)));
        const epa = Math.round((epEnd - epStart) * 100) / 100;
        return { epa, ep_start: epStart, ep_end: epEnd };
    }
    if (!play.end || play.end.yardsToEndzone === undefined || play.end.yardsToEndzone === null) return null;
    const epEnd = _epLookup(play.end.down, play.end.distance, play.end.yardsToEndzone);
    const epa = Math.round((epEnd - epStart) * 100) / 100;
    return { epa, ep_start: epStart, ep_end: epEnd };
}

// ── a table with real structure, so a bucket error cannot hide ──────────────
// Every (down, ytgBucket, yl100Bucket) key gets a DISTINCT value. A flat table
// would let a wrong bucket return the right number and pass.
const TABLE = {};
for (const d of [1,2,3,4])
    for (const y of [1,2,3,4,5,6,7,8,9,10,11,15,20,25])
        for (const l of [1,6,11,16,21,26,31,36,41,46,51,56,61,66,71,76,81,86,91,96])
            TABLE[`${d}_${y}_${l}`] = Math.round((d * 1000 + y * 37 + l * 7) / 100 * 100) / 100;
_epTable = TABLE;

A('the fixture table is distinct per key, so a bucket error cannot pass',
  new Set(Object.values(TABLE)).size > Object.keys(TABLE).length * 0.9,
  `${new Set(Object.values(TABLE)).size} distinct of ${Object.keys(TABLE).length}`);

// ── the grid ────────────────────────────────────────────────────────────────
const plays = [];
const push = p => plays.push(p);
// normal snaps across every down, several distances, the whole field
for (const down of [1,2,3,4])
    for (const ytg of [1,3,7,10,13,18,24,30])
        for (const yl of [1,3,17,42,50,63,88,97,99])
            push({ id: `n${down}${ytg}${yl}`, type: { text: 'Pass Reception' },
                   start: { down, distance: ytg, yardsToEndzone: yl },
                   end: { down: 1, distance: 10, yardsToEndzone: Math.max(1, yl - 7) } });
// scoring: touchdown, made FG, missed FG (missed must NOT take the 3 branch)
for (const t of ['Passing Touchdown', 'Field Goal Good', 'Field Goal Missed', 'Rushing Touchdown'])
    for (const yl of [2, 25, 60])
        push({ id: `s${t}${yl}`, type: { text: t }, scoringPlay: true,
               start: { down: 1, distance: 10, yardsToEndzone: yl } });
// turnovers across the field
for (const yl of [1, 20, 50, 80, 99])
    push({ id: `t${yl}`, type: { text: 'Interception' }, isTurnover: true,
           start: { down: 2, distance: 8, yardsToEndzone: yl } });
// every skipped type
for (const t of ['Kickoff','Extra Point','Two-Point Conversion','Timeout','Two Minute Warning','End of Period','End of Half','End of Game'])
    push({ id: `k${t}`, type: { text: t }, start: { down: 1, distance: 10, yardsToEndzone: 40 } });
// the null-producing shapes
push({ id: 'no-start', type: { text: 'Pass Reception' } });
push({ id: 'no-down', type: { text: 'Pass Reception' }, start: { distance: 10, yardsToEndzone: 40 }, end: { down: 1, distance: 10, yardsToEndzone: 33 } });
push({ id: 'no-end', type: { text: 'Pass Reception' }, start: { down: 1, distance: 10, yardsToEndzone: 40 } });
push({ id: 'end-null-yte', type: { text: 'Pass Reception' }, start: { down: 1, distance: 10, yardsToEndzone: 40 }, end: { down: 1, distance: 10, yardsToEndzone: null } });

let mismatches = [], nulls = 0, values = 0;
for (const p of plays) {
    const ref = _computeESPNPlayEPA(p);
    const got = playEpa(TABLE, p);
    if (ref === null || got === null) {
        if ((ref === null) !== (got === null))
            mismatches.push(`${p.id}: ref ${ref === null ? 'null' : 'value'}, relay ${got === null ? 'null' : 'value'}`);
        else nulls++;
        continue;
    }
    values++;
    if (ref.epa !== got.epa || ref.ep_start !== got.ep_start || ref.ep_end !== got.ep_end)
        mismatches.push(`${p.id}: ref ${JSON.stringify(ref)} vs relay ${JSON.stringify({epa:got.epa,ep_start:got.ep_start,ep_end:got.ep_end})}`);
}

console.log(`\n  ${plays.length} synthetic play(s): ${values} with an EPA, ${nulls} correctly null\n`);

// Non-vacuity first, and loudest. A grid that produced no values would agree
// with anything — the shape this repo keeps finding.
A('the grid actually produced EPA values', values > 100, `${values} value(s)`);
A('...and exercised the null branches too', nulls >= 12, `${nulls} null(s)`);
A('every play agrees with the client, exactly',
  mismatches.length === 0, mismatches.slice(0, 5).join('\n        '));

// The check must be able to fail. Break the lookup and confirm it objects.
const broken = { ...TABLE, '1_10_41': (TABLE['1_10_41'] ?? 0) + 1 };
const differs = plays.some(p => {
    const a = _computeESPNPlayEPA(p), b = playEpa(broken, p);
    return a && b && (a.epa !== b.epa);
});
A('a one-cell change to the table IS detected — this check can fail', differs,
  'the grid never reads 1_10_41, so agreement above proves nothing about it');

A('epLookup clamps out-of-range distance and field position like the client',
  epLookup(TABLE, 1, 99, 250) === _epLookup(1, 99, 250)
  && epLookup(TABLE, 1, -5, -5) === _epLookup(1, -5, -5),
  `${epLookup(TABLE, 1, 99, 250)} vs ${_epLookup(1, 99, 250)}`);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
