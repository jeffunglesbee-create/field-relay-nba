// The two done conditions for CC-CMD-2026-09-01-archive-game-numeric-espn-upsert-key.
//
// d253209 changed /archive/game's id from
//
//     `${sport}_${date}_${idTail}`                     (team-name shortcodes)
// to  `${sport}_${date}_e${source_id}` WHEN source_id  is a bare numeric ESPN
//                                       event id, and the team-name form otherwise.
//
// So the change has exactly two observable claims, and this asserts both against
// the DEPLOYED worker rather than against the source:
//
//   A. two writes carrying ONE numeric source_id and TWO team-name spellings
//      collapse onto ONE row, whose id ends `_e<digits>`
//   B. the same two writes carrying `golf_999999999` still produce TWO rows
//
// B IS NOT A FORMALITY. Golf's `golf_<eventId>` is a per-TOURNAMENT key covering
// R1..R4 as separate rows; keying the id on it would merge two real rounds and
// destroy a scored row. The measured collision census found all three
// different-fixture collisions were `golf_*` and none were bare numeric. A
// change that made A pass and B fail would be a data-loss bug that looks like a
// success.
//
// SYNTHETIC FUTURE DATES so no real slate is written to, and both are deleted at
// the end. /archive/game needs no auth; the read-back and cleanup use
// /d1/execute the way the other 52 scripts in this repo do.
//
// Usage:  node scripts/numeric-espn-upsert-key-verify.mjs

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// THE GATE COMES FROM THE ENVIRONMENT, WITH NO DEFAULT.
//
// This script originally compiled the value in, the way ~50 others in this repo
// still do, and that made it the 116th occurrence against a declared maximum of
// 115 — `guards.yml` failed on `check-exposed-secrets.mjs` at the commit that
// added it, and the ratchet was right. `docs/exposed-secrets.sha256` prescribes
// exactly this fix: `process.env.RELAY_SHARED_SECRET` with NO default, because a
// default makes an unset secret indistinguishable from a set one until the relay
// 401s and the run reports "the probe failed" instead of "the probe never ran".
const RELAY_GATE = process.env.RELAY_SHARED_SECRET;
if (!RELAY_GATE) {
    console.error('RELAY_SHARED_SECRET is not set. This script cannot reach /d1/execute without it,');
    console.error('and it will not guess: pass it from the workflow as an env, never as a literal.');
    process.exit(1);
}

// Far enough out that no real fixture can share them.
const DATE_A = '2099-03-01';
const DATE_B = '2099-03-02';
const NUMERIC_ID = '999000111';
const GOLF_ID = 'golf_999999999';
// Two spellings of one club — the exact drift the change exists for.
const SPELLINGS = [
    { home: 'Test Alpha', away: 'Dream' },
    { home: 'Test Alpha FC', away: 'Atlanta Dream' },
];

async function post(body) {
    const r = await fetch(`${RELAY}/archive/game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
}

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': RELAY_GATE, 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}

const rowsOn = async (date) =>
    (await d1(`SELECT id FROM regular_season_games WHERE date = ? ORDER BY id`, [date]))
        .map(r => r.id);

let failed = 0;
const assert = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) { failed++; console.log(`      ${detail}`); }
};

// A PRE-CHECK, not politeness: a leftover row from an earlier run would make A
// look like a pass for the wrong reason, or B fail for one.
for (const d of [DATE_A, DATE_B]) {
    const pre = await rowsOn(d);
    if (pre.length) {
        console.log(`clearing ${pre.length} leftover row(s) on ${d}: ${pre.join(', ')}`);
        await d1(`DELETE FROM regular_season_games WHERE date = ?`, [d]);
    }
}

console.log('\n=== A. one numeric source_id, two spellings ===');
for (const s of SPELLINGS) {
    const r = await post({ sport: 'MLB', date: DATE_A, source_id: NUMERIC_ID, ...s });
    console.log(`  POST ${JSON.stringify(s)} -> ${r.status} ${r.body}`);
}
const a = await rowsOn(DATE_A);
console.log(`  rows on ${DATE_A}: ${a.length} — ${a.join(', ') || '(none)'}`);
assert('A1: exactly ONE row', a.length === 1, `saw ${a.length}: ${a.join(', ')}`);
assert('A2: its id ends _e<digits>', a.length === 1 && /_e\d+$/.test(a[0]),
    `id is ${a[0] ?? '(none)'}`);

console.log('\n=== B. golf_ source_id, two spellings ===');
for (const s of SPELLINGS) {
    const r = await post({ sport: 'MLB', date: DATE_B, source_id: GOLF_ID, ...s });
    console.log(`  POST ${JSON.stringify(s)} -> ${r.status} ${r.body}`);
}
const b = await rowsOn(DATE_B);
console.log(`  rows on ${DATE_B}: ${b.length} — ${b.join(', ') || '(none)'}`);
assert('B1: still TWO rows — a golf key must never merge rounds', b.length === 2,
    `saw ${b.length}: ${b.join(', ')}`);
assert('B2: neither id ends _e<digits>', b.every(id => !/_e\d+$/.test(id)),
    b.filter(id => /_e\d+$/.test(id)).join(', '));

console.log('\n=== cleanup ===');
for (const d of [DATE_A, DATE_B]) {
    await d1(`DELETE FROM regular_season_games WHERE date = ?`, [d]);
    const left = await rowsOn(d);
    assert(`cleanup: ${d} is empty`, left.length === 0, `${left.length} row(s) remain`);
}

console.log(`\n${failed === 0 ? 'ALL ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
