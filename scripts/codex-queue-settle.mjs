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
        expectBefore: 'closed',
        want: 'open',
        // MUST be explicit. Omitting status PRESERVES the existing value, and
        // this row currently carries a deliberate 'resolved' that I set — which
        // classifies closed whatever the title says. Reversing a deliberate
        // close therefore takes a deliberate write, not a new title.
        status: 'open',
        title: 'OPEN — P16 REOPENED: I closed this wrongly. P16 is a RELAY analytics-cron feature and night_stars.degraded is still true (corrected 2026-09-10)',
        reason:
`I CLOSED THIS ROW ON A FALSE IDENTITY EARLIER TODAY. Reopening it, with the
evidence I should have gone and got before writing DONE.

The 2026-09-10 settlement claimed P16 ("retroactive drama estimation") was the
2026-07-02 client drama backfill, shipped and tuned. The shipping is true. THE
IDENTITY IS NOT. I recorded at the time that the June-20 table naming P16 "exists
nowhere in either repo" and rested the claim on a date match plus the absence of
another candidate — and scored it 94 for exactly that reason. The table was not
in the repos because it was never a repo file. It is on Drive, and asking Drive
was the step I skipped.

WHAT DRIVE SAYS, three documents, all predating the settlement:

  "FIELD — Undelivered Since June 19" (2026-06-22)
    "P16 RETROACTIVE DRAMA ESTIMATION ... Fix needed: Spec + CC-CMD FOR RELAY
     ANALYTICS CRON. Reads completed games from D1, computes drama proxy from
     margin/OT/etc. WRITES TO analytics_output. REMOVES DEGRADED FLAG."

  "FIELD — Analytics Cron Engine Spec" (2026-06-20) — this is the June-20
  document I said did not exist
    "If drama_peak data missing for >50% of games (P16 NOT RUN), fall back to
     score-differential heuristic ... Log: [NIGHT STARS] degraded mode"

  "FIELD — Deferred Items Reconciliation" (2026-06-21)
    "P16 IS the computation. GLYPH IS the display surface."

SO THEY ARE DIFFERENT FEATURES, in different layers, with different outputs:

  P16              relay analytics cron -> analytics_output, clears
                   night_stars.degraded, estimates drama from final score /
                   margin / OT for games with no live data
  drama backfill   client, replays dramaScoreLive() over ESPN historical plays
                   and POSTs drama_peak to /archive/drama

THE LIVE DONE-CONDITION IS UNMET. session_health at 2026-09-10T01:34Z:
analytics_phases.night_stars = { date: '2026-09-09', degraded: true }. P16's
whole purpose is to clear that flag. It is still true, so P16 has not run.

AND MY CORROBORATION POINTED AT THE WRONG FEATURE. I cited
/archive/drama/leaderboard returning real drama_peak values. drama_peak is what
the CLIENT backfill writes. It is evidence for the feature that shipped, and
none at all for the one that did not — which is precisely the limit I wrote down
and then failed to act on.

WHAT IS STILL TRUE from the earlier settlement, and does not need redoing:
getQualityTarget is superseded, and loadQualityCalibration is not defined
anywhere in relay src/ at HEAD, so its empty-catch residual is moot. P16 is the
sole live item on this row, as the 2026-07-13 note said all along.`,
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
// Generalised after the first RE-OPEN. The original arithmetic only counted
// closings, so a settlement moving a row back to open expected `open` to be
// unchanged and would have failed a correct write. It fails loudly rather than
// silently, but it was still wrong, and a correction is exactly when a guard
// must not be the thing in the way.
const closing = SETTLEMENTS.filter(s => s.want === 'closed').length;
const opening = SETTLEMENTS.filter(s => s.want === 'open').length;
const wantOpen = qBefore.open + opening - closing;
const wantClosed = qBefore.closed + closing - opening;
check('the queue moved by exactly the settlements, in the right direction',
    qAfter.total === qBefore.total && qAfter.undetermined === qBefore.undetermined
    && qAfter.open === wantOpen && qAfter.closed === wantClosed,
    `expected open ${wantOpen} / closed ${wantClosed}, got open ${qAfter.open} / closed ${qAfter.closed}`);

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
