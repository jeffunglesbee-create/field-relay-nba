// Move one cc-cmd-queue row's disposition, with the same safety the 2026-09-10
// adjudication used — and generic, so the next settlement does not need a new
// script.
//
// WHY IT IS NOT codex-queue-adjudicate.mjs
//
// That script's anchor requires every target to classify as `undetermined`
// before the write, which is exactly right for the ten-row pass it was built
// for and useless afterwards: once a row is adjudicated it is `open` or
// `closed`, and settling it again must assert a DIFFERENT before-state. So the
// expected prior classification is declared per settlement and checked, rather
// than hardcoded.
//
// Same three properties as the adjudication:
//   - the body is round-tripped, never retyped (codex_write is an upsert)
//   - a pre-image is written to outbox/ before any write
//   - the result is verified by RE-READING, then by the live instrument

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MCP = process.env.FIELD_MCP_SECRET;
const APPLY = process.argv.includes('--apply');
const PLAN = process.argv.includes('--plan');
const SELF_TEST = process.argv.includes('--self-test');

let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`); } };

const CLOSED_WORDS = ['DONE', 'RESOLVED', 'SUPERSEDED', 'CLOSED', 'WITHDRAWN', 'MERGED', 'EXECUTED'];
const OPEN_WORDS = ['PENDING', 'OPEN', 'BLOCKED'];
const firstWord = (t) => String(t || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '');
export const classify = (r) => {
    if (r.status === 'resolved' || r.status === 'done') return 'closed';
    const w = firstWord(r.title);
    if (CLOSED_WORDS.includes(w)) return 'closed';
    if (OPEN_WORDS.includes(w)) return 'open';
    return 'undetermined';
};

export const SETTLEMENTS = [
    {
        key: 'p15b-p16-getqualitytarget',
        expectBefore: 'open',
        want: 'closed',
        status: 'resolved',
        title: 'DONE — P16 settled: retroactive drama estimation SHIPPED 2026-07-02 as the drama backfill, and was tuned after shipping (settled 2026-09-10)',
        reason:
`The 2026-07-13 note says P16 "confirmed still genuinely unbuilt". It is built,
and was already running when that sentence was written.

WHAT P16 IS. The note places it 6th of 6 in a "June 20 health-monitoring table".
That table exists nowhere in either repo — searched both — so the identity is
established from subject and date rather than by reading it. Both halves of the
drama-backfill pair name the same defect and the same date:

  jubilant-bassoon docs/CC-CMD-2026-07-02-drama-backfill-client.md
    "Retroactive Drama Backfill ... structurally, not accidentally, degraded
     since at least 2026-06-20"
  field-relay-nba docs/CC-CMD-2026-07-02-drama-backfill-discovery.md
    "silently, structurally degraded since at least 2026-06-20 with zero visible
     indication anywhere (buried in session_health's night_stars.degraded)"

June 20 is the date of the table P16 was ranked in, and no other
retroactive-drama work exists in either repo. Same feature.

IT SHIPPED, AND IT WAS TUNED AFTER SHIPPING — which is stronger evidence than
shipping alone, because tuning means somebody watched it run:

  field.js:35096  the backfill block, citing CC-CMD-2026-07-02
  field.js:35297  fetch(\`\${relayBase}/archive/drama-missing?limit=20\`)
  field.js:42195  called on the boot path, best-effort, never blocks boot
                  "Cap raised 3 -> 20 games per session: verified 2026-07-02
                   that the original cap of 3 wasn't keeping pace with the real
                   backlog (128 -> 137 missing games since shipping)"

LIVE ARTIFACT. GET /archive/drama/leaderboard?sport=MLB&limit=5 returns five
games with real drama_peak values (100, 100, 100, 100, 99) and dense
several-hundred-sample drama_arc series, dated 2026-05-25 through 2026-08-07.

WHAT THAT ARTIFACT DOES AND DOES NOT PROVE. It proves the pipeline produces and
stores real arcs. It does NOT prove any individual arc came from the backfill
rather than from a live session, and this settlement does not claim it did —
the mechanism is established from the code and its post-ship tuning, and the
leaderboard is corroboration, not the proof.

The row's other two residuals were already retired on 2026-09-10: getQualityTarget
is superseded, and loadQualityCalibration is not defined anywhere in relay src/ at
HEAD. With P16 settled, nothing is left open on this row.`,
    },
];

if (SELF_TEST) {
    check('every settlement declares the before-state it expects',
        SETTLEMENTS.every(s => ['open', 'closed', 'undetermined'].includes(s.expectBefore)),
        'without a declared before-state the anchor cannot be checked at all');
    check('every new title classifies as its own verdict says',
        SETTLEMENTS.every(s => classify({ title: s.title, status: s.status ?? 'open' }) === s.want),
        SETTLEMENTS.map(s => `${s.key} -> ${classify({ title: s.title, status: s.status ?? 'open' })}`).join('; '));
    check('a settlement never claims the state it is already in',
        SETTLEMENTS.every(s => s.expectBefore !== s.want),
        'a no-op settlement would report success having changed nothing');
    check('every settlement carries evidence, not just a verdict',
        SETTLEMENTS.every(s => s.reason && s.reason.length > 300));

    // MUTATION: the anchor is the only thing standing between this and writing
    // to a row somebody else already moved.
    check('MUTATION: a dispositionless title cannot satisfy a closed verdict',
        classify({ title: 'settled, probably', status: 'open' }) !== 'closed',
        'the title check has no teeth');
    check('MUTATION: an open-word title cannot satisfy a closed verdict',
        classify({ title: 'OPEN — still going', status: 'open' }) !== 'closed');
    check('a deliberate resolved status closes regardless of leading word',
        classify({ title: 'anything at all', status: 'resolved' }) === 'closed');

    console.log(`\n${failed === 0 ? 'SELF-TEST PASS' : `${failed} FAILING`}`);
    process.exit(failed === 0 ? 0 : 1);
}

if (!MCP) { console.error('FIELD_MCP_SECRET is not set. This script will not guess it.'); process.exit(1); }
if (!APPLY && !PLAN) { console.error('pass --plan, --apply or --self-test'); process.exit(1); }

const call = async (name, args) => {
    const r = await fetch(`${RELAY}/mcp`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${MCP}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${name}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error).slice(0, 300)}`);
    return JSON.parse(body.result.content[0].text);
};

console.log(`mode: ${APPLY ? 'APPLY' : 'PLAN (no writes)'}\n`);
const qBefore = (await call('session_health', {})).cc_cmd_queue;
console.log(`queue before: total ${qBefore.total} open ${qBefore.open} undetermined ${qBefore.undetermined} closed ${qBefore.closed}\n`);

const before = new Map();
for (const s of SETTLEMENTS) {
    const row = await call('codex_read', { key: s.key });
    check(`${s.key} was read`, !row.error, row.error);
    if (row.error) continue;
    before.set(s.key, row);
    check(`ANCHOR ${s.key} classifies as ${s.expectBefore} before the write`,
        classify(row) === s.expectBefore,
        `classifies as ${classify(row)} — somebody moved it since this settlement was written. Refusing.`);
    check(`the new title for ${s.key} classifies as ${s.want}`,
        classify({ title: s.title, status: s.status ?? 'open' }) === s.want);
}
if (failed) { console.log('\nrefusing to write'); process.exit(1); }

const { writeFileSync } = await import('node:fs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const pre = `outbox/codex-queue-settle-preimage-${stamp}.json`;
writeFileSync(pre, JSON.stringify({ taken_at: new Date().toISOString(),
    rows: SETTLEMENTS.map(s => before.get(s.key)) }, null, 2));
console.log(`\npre-image written: ${pre}`);

for (const s of SETTLEMENTS) {
    console.log(`\n--- ${s.key}`);
    console.log(`    was : [${classify(before.get(s.key))}] ${before.get(s.key).title}`);
    console.log(`    now : [${s.want}] ${s.title}\n`);
    console.log(s.reason.split('\n').map(l => `    ${l}`).join('\n'));
}

if (!APPLY) { console.log('\nPLAN OK — no writes made'); process.exit(0); }

console.log('\n=== APPLYING ===');
for (const s of SETTLEMENTS) {
    const r = before.get(s.key);
    const args = { key: s.key, category: r.category, title: s.title, content: r.content };
    if (s.status) args.status = s.status;
    await call('codex_write', args);
    console.log(`  wrote ${s.key}`);
}

console.log('');
for (const s of SETTLEMENTS) {
    const r = await call('codex_read', { key: s.key });
    check(`${s.key} → ${s.want}`,
        r.title === s.title && classify(r) === s.want && r.content === before.get(s.key).content,
        `titleMatch=${r.title === s.title} class=${classify(r)} bodyUnchanged=${r.content === before.get(s.key).content}`);
}

const qAfter = (await call('session_health', {})).cc_cmd_queue;
console.log(`\nqueue after: total ${qAfter.total} open ${qAfter.open} undetermined ${qAfter.undetermined} closed ${qAfter.closed}`);
const closing = SETTLEMENTS.filter(s => s.want === 'closed').length;
check('the queue moved by exactly the number of settlements, in the right direction',
    qAfter.total === qBefore.total && qAfter.undetermined === qBefore.undetermined
    && qAfter.open === qBefore.open - closing && qAfter.closed === qBefore.closed + closing,
    `expected open ${qBefore.open - closing} / closed ${qBefore.closed + closing}, got open ${qAfter.open} / closed ${qAfter.closed}`);

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
