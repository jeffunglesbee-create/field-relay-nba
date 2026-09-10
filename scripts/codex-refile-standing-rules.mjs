// Refile two standing instructions out of the cc-cmd-queue and into `rule`.
//
// WHY
//
// Adjudicating the ten undetermined queue rows on 2026-09-10 found that two of
// them were never queue entries. `bucketc-inverse-problem-confirmed` and
// `journalismbrief-endpoint-correction` each have finished work AND a STANDING
// INSTRUCTION as their residual — "carry this check into the next Tier C
// cluster", "apply the negative-result rule to your own conclusions".
//
// A standing instruction never completes. It therefore can never leave a work
// queue, and a row that can never close sits in `undetermined` or `open` forever
// no matter how good the classifier is. That is a CATEGORY error, not a
// disposition problem.
//
// THE INSTRUCTION IS EXTRACTED, NEVER RETYPED. Each rule's body is lifted from
// its source row's content by a literal marker, and the script asserts the
// marker occurs EXACTLY ONCE before using it. Paraphrasing a standing rule while
// refiling it would be inventing a rule and attributing it to a past session.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MCP = process.env.FIELD_MCP_SECRET;
const APPLY = process.argv.includes('--apply');
const PLAN = process.argv.includes('--plan');
const SELF_TEST = process.argv.includes('--self-test');

let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`); } };

const REFILINGS = [
    {
        from: 'bucketc-inverse-problem-confirmed',
        key: 'rule-bucket-c-sibling-citations-recheck',
        title: 'RULE — a Bucket C "sibling citation" is a claim to re-check, not a reason to skip',
        marker: 'Standing instruction for whatever Tier C cluster is drafted next:',
        why: 'Confirmed real once (2 genuine misclassifications found via Cluster 3), so it is not theoretical. It applies to every future cluster, which is what makes it a rule rather than a task.',
    },
    {
        from: 'journalismbrief-endpoint-correction',
        key: 'rule-negative-results-apply-to-your-own-conclusions',
        title: 'RULE — the negative-result rule binds your OWN conclusions, at the moment you write them',
        marker: 'STANDING LESSON, third-order this time:',
        why: 'The originating incident is the sharpest possible case: a grep-based negative was accepted IN THE SAME EDIT that added the rule against accepting grep-based negatives, and the false example was then codified into that rule. Writing a rule is not following it.',
    },
];

/** The standing instruction, verbatim, from `marker` to the end of the body. */
export function extract(content, marker) {
    const hits = content.split(marker).length - 1;
    if (hits !== 1) return { error: `marker occurs ${hits} times, must be exactly 1` };
    return { text: (marker + content.slice(content.indexOf(marker) + marker.length)).trim() };
}

const bodyFor = (r, src) => `${r.title}

REFILED 2026-09-10 from the cc-cmd-queue entry \`${r.from}\`, which is now
closed. That row held finished work plus this standing instruction as its
residual. A standing instruction never completes, so it can never leave a work
queue — it was miscategorised, not mis-adjudicated.

WHY IT IS A RULE: ${r.why}

The text below is extracted VERBATIM from \`${r.from}\`'s body by a literal
marker, not paraphrased. The source row remains readable in full.

---

${extract(src.content, r.marker).text}`;

// ---------------------------------------------------------------------------
// SELF-TEST (Rule 90) — the extractor is the only piece that can silently
// produce something plausible and wrong, so it is what gets broken on purpose.
// ---------------------------------------------------------------------------
if (SELF_TEST) {
    const BODY = 'preamble one.\n\nSTANDING LESSON, third-order this time: do the thing.\nAnd keep doing it.\n';
    const got = extract(BODY, 'STANDING LESSON, third-order this time:');
    check('the extract starts AT the marker and runs to the end',
        got.text === 'STANDING LESSON, third-order this time: do the thing.\nAnd keep doing it.',
        JSON.stringify(got));

    check('MUTATION: a marker that is absent is refused, not silently empty',
        extract(BODY, 'NO SUCH MARKER').error?.includes('0 times'),
        'an absent marker produced text instead of an error — the rule body would ship empty');

    check('MUTATION: a marker appearing twice is refused, not resolved to the first',
        extract('x MARK y MARK z', 'MARK').error?.includes('2 times'),
        'an ambiguous marker silently picked one occurrence, which is the stale-citation defect again');

    check('the extract never returns the preamble',
        !got.text.includes('preamble one'),
        'text before the marker leaked into the rule body');

    check('both refilings target category rule, and neither key collides with its source',
        REFILINGS.every(r => r.key !== r.from && r.key.startsWith('rule-')),
        'a refiled key that equals its source would overwrite the source row');

    check('both keys are distinct', new Set(REFILINGS.map(r => r.key)).size === REFILINGS.length);

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

// The queue counts BEFORE. A rule row must not change them — that is the whole
// point of the refiling, and it is checkable rather than assumed.
const qBefore = (await call('session_health', {})).cc_cmd_queue;
console.log(`queue before: total ${qBefore.total} open ${qBefore.open} undetermined ${qBefore.undetermined} closed ${qBefore.closed}\n`);

const planned = [];
for (const r of REFILINGS) {
    const src = await call('codex_read', { key: r.from });
    check(`source ${r.from} was read`, !src.error, src.error);
    if (src.error) continue;

    const ex = extract(src.content, r.marker);
    check(`the standing instruction in ${r.from} is found exactly once`, !ex.error, ex.error);
    if (ex.error) continue;

    const existing = await call('codex_read', { key: r.key });
    check(`${r.key} does not already exist as something else`,
        !!existing.error || existing.category === 'rule',
        `key is taken by a ${existing.category} row — refusing to overwrite`);

    const content = bodyFor(r, src);
    check(`${r.key}'s body contains the extract VERBATIM`,
        content.includes(ex.text) && ex.text.length > 100,
        `extract length ${ex.text.length}`);
    planned.push({ r, content, ex });
}
if (failed) { console.log('\nrefusing to write'); process.exit(1); }

for (const p of planned) {
    console.log(`\n--- ${p.r.key}   (from ${p.r.from})`);
    console.log(`    ${p.ex.text.slice(0, 220).replace(/\n/g, ' ')}…`);
}

if (!APPLY) { console.log('\nPLAN OK — no writes made'); process.exit(0); }

console.log('\n=== APPLYING ===');
for (const p of planned) {
    await call('codex_write', { key: p.r.key, category: 'rule', title: p.r.title, content: p.content });
    console.log(`  wrote ${p.r.key}`);
}

console.log('');
for (const p of planned) {
    const back = await call('codex_read', { key: p.r.key });
    check(`${p.r.key} reads back as a rule with the verbatim instruction`,
        back.category === 'rule' && back.title === p.r.title && back.content.includes(p.ex.text),
        `category=${back.category} titleMatch=${back.title === p.r.title} hasExtract=${back.content?.includes(p.ex.text)}`);
}

// THE POINT OF THE REFILING, ASSERTED: a rule is not queue work.
const qAfter = (await call('session_health', {})).cc_cmd_queue;
console.log(`\nqueue after: total ${qAfter.total} open ${qAfter.open} undetermined ${qAfter.undetermined} closed ${qAfter.closed}`);
check('the two new rule rows did NOT enter the cc-cmd queue',
    qAfter.total === qBefore.total && qAfter.open === qBefore.open
    && qAfter.undetermined === qBefore.undetermined && qAfter.closed === qBefore.closed,
    `queue moved: ${JSON.stringify(qBefore)} -> ${JSON.stringify(qAfter)}. A standing rule counted as work is the exact defect this refiling exists to remove.`);

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
