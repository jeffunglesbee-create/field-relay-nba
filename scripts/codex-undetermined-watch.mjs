// The undetermined bucket refills. This is the standing check that it hasn't.
//
// WHY THIS EXISTS
//
// 716391d made session_health partition the cc-cmd queue three ways, and on
// 2026-09-10 the ten `undetermined` rows were adjudicated to zero. Zero is not a
// stable state. Every new queue row whose title leads with something other than
// PENDING / OPEN / BLOCKED / DONE / RESOLVED / SUPERSEDED / CLOSED / WITHDRAWN /
// MERGED / EXECUTED lands straight back in the bucket, and nothing stops one
// being written that way — the classifier reports the problem, it cannot prevent
// it.
//
// Ten rows accumulated over roughly two months before anyone counted them. The
// cost of each is not the row: it is that a session reading the queue at start
// gets a number that silently omits them.
//
// IT REPORTS AND IT FAILS LOUDLY. A red weekly run is the signal. It writes
// nothing to D1 — adjudicating a row is a judgement, and a judgement is the
// owner's, never a cron's.
//
// Rule 91: the coverage is printed beside the verdict. The instrument partitions
// every row, so the denominator is the whole table and the run says so.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MCP = process.env.FIELD_MCP_SECRET;
const SELF_TEST = process.argv.includes('--self-test');

let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`); } };

/** The verdict, separated from the fetch so it can be tested without a network. */
export function verdict(q) {
    if (!q || typeof q !== 'object') return { ok: false, reason: 'no cc_cmd_queue block in session_health' };
    if (typeof q.undetermined !== 'number') return { ok: false, reason: 'cc_cmd_queue carries no undetermined count — the instrument regressed' };
    if (q.open + q.undetermined + q.closed !== q.total) {
        return { ok: false, reason: `the partition does not account for every row: ${q.open} + ${q.undetermined} + ${q.closed} !== ${q.total}` };
    }
    if (q.undetermined > 0) {
        const names = (q.undetermined_items || []).map(x => `  ${x.key}\n      ${x.title}`).join('\n');
        return { ok: false, reason: `${q.undetermined} row(s) state no disposition and carry no status:\n${names}` };
    }
    return { ok: true, reason: `0 of ${q.total} rows are undetermined` };
}

if (SELF_TEST) {
    check('a clean partition passes',
        verdict({ total: 10, open: 3, undetermined: 0, closed: 7 }).ok);

    // MUTATION: the whole point. If this passed, the watch would be decorative.
    check('MUTATION: a non-zero undetermined count FAILS',
        verdict({ total: 10, open: 3, undetermined: 1, closed: 6,
                  undetermined_items: [{ key: 'k', title: 'no disposition' }] }).ok === false,
        'the watch cannot detect the one thing it exists to detect');

    check('...and names the offending row rather than only counting it',
        verdict({ total: 10, open: 3, undetermined: 1, closed: 6,
                  undetermined_items: [{ key: 'the-key', title: 't' }] }).reason.includes('the-key'),
        'a count with no names cannot be acted on');

    // MUTATION: an instrument that stops reporting `undetermined` would otherwise
    // read as "zero undetermined" — absence looking like success.
    //
    // THIS TEST WAS WIDENED AFTER ITS MUTATION SURVIVED. The first version used a
    // MISSING field, and deleting the typeof guard still failed the row — because
    // 3 + undefined + 7 is NaN and the arithmetic check catches it regardless. The
    // typeof guard was therefore untested by its own test. `null` is the
    // discriminating case: it coerces to 0, sums to exactly `total`, sails through
    // the arithmetic, and ONLY the typeof guard stops it.
    check('MUTATION: a NULL undetermined fails — it sums correctly and only the type check catches it',
        verdict({ total: 10, open: 3, undetermined: null, closed: 7 }).ok === false,
        'a regressed instrument that emitted null would report healthy forever, and the arithmetic would agree');
    check('...and a missing field fails too',
        verdict({ total: 10, open: 3, closed: 7 }).ok === false,
        'caught by the arithmetic rather than the type check, but it must still fail');

    check('MUTATION: arithmetic that does not close FAILS even at undetermined 0',
        verdict({ total: 10, open: 3, undetermined: 0, closed: 6 }).ok === false,
        'rows could go missing entirely while the bucket read clean');

    check('MUTATION: an absent queue block fails', verdict(null).ok === false);

    console.log(`\n${failed === 0 ? 'SELF-TEST PASS' : `${failed} FAILING`}`);
    process.exit(failed === 0 ? 0 : 1);
}

if (!MCP) { console.error('FIELD_MCP_SECRET is not set. This script will not guess it.'); process.exit(1); }

const r = await fetch(`${RELAY}/mcp`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MCP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
                           params: { name: 'session_health', arguments: {} } }),
});
const text = await r.text();
if (!r.ok) { console.error(`HTTP ${r.status}: ${text.slice(0, 400)}`); process.exit(1); }
const q = JSON.parse(JSON.parse(text).result.content[0].text).cc_cmd_queue;

const v = verdict(q);
console.log(`checked ${q?.total ?? '?'} of ${q?.total ?? '?'} cc-cmd-queue rows — the instrument partitions every row, so the denominator is the whole table\n`);
console.log(JSON.stringify({ total: q?.total, open: q?.open, undetermined: q?.undetermined, closed: q?.closed }, null, 2));
console.log('');
check('no queue row is undetermined', v.ok, v.reason);
if (v.ok) console.log(`      ${v.reason}`);

if (!v.ok) {
    console.log('\nAdjudicating a row is a judgement and belongs to the queue owner, not to this');
    console.log('cron. Read each row\'s BODY — the title is what made it undetermined — and give');
    console.log('it a leading disposition word, or set a deliberate status. The 2026-09-10 pass');
    console.log('is the worked example: outbox/cc-session-2026-09-10-queue-adjudication.md');
}
process.exit(failed === 0 ? 0 : 1);
