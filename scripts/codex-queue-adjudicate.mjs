// Adjudicate the ten `undetermined` cc-cmd-queue rows — 2026-09-10.
//
// WHY THIS EXISTS
//
// 716391d made session_health report three counts instead of one, and the third
// — `undetermined` — names the rows whose title states no disposition and whose
// status nobody set. Ten rows landed there. That bucket is the queue's real
// health defect, not a residual: it is what keeps a bad title visible.
//
// This script records the owner's adjudication of those ten. Every verdict below
// was reached by reading the row's BODY (the title is what made it undetermined)
// and, where the body made a checkable claim, by re-probing that claim at HEAD
// today. Five verdicts changed as a result — see the reason field on each.
//
// WHY IT ROUND-TRIPS THE CONTENT INSTEAD OF RESTATING IT
//
// codex_write is an upsert: it takes title, content and status together, so
// changing a title means supplying the body too. Retyping a 2,000-character body
// is an invitation to corrupt it silently. This reads each row and writes the
// SAME content object straight back, so the body never passes through a
// transcription step. codex_write's history guard (`content IS NOT ?`) sees the
// content unchanged and writes no codex_history row — only title and status move.
//
// It also writes a pre-image of all ten rows to outbox/ BEFORE any write, so the
// change is reversible from a committed file and not only from codex_history.
//
// MODES
//   --plan   read, assert the anchor, write the pre-image. NO writes to D1.
//   --apply  everything --plan does, then the ten writes, then re-read and verify.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MCP = process.env.FIELD_MCP_SECRET;
const APPLY = process.argv.includes('--apply');
const PLAN = process.argv.includes('--plan');
const SELF_TEST = process.argv.includes('--self-test');

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

// The classifier from src/index.js, reproduced here for ONE purpose only: to
// assert that each key is `undetermined` BEFORE it is touched. If a row already
// classifies, this script is aimed at the wrong record and must not write.
const CLOSED_WORDS = ['DONE', 'RESOLVED', 'SUPERSEDED', 'CLOSED', 'WITHDRAWN', 'MERGED', 'EXECUTED'];
const OPEN_WORDS = ['PENDING', 'OPEN', 'BLOCKED'];
const firstWord = (t) => String(t || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '');
const classify = (r) => {
    if (r.status === 'resolved' || r.status === 'done') return 'closed';
    const w = firstWord(r.title);
    if (CLOSED_WORDS.includes(w)) return 'closed';
    if (OPEN_WORDS.includes(w)) return 'open';
    return 'undetermined';
};

const A = '(adjudicated 2026-09-10)';
const VERDICTS = [
    { key: 'CC-CMD-2026-07-07-worth-watching-display.md', want: 'closed', status: 'resolved',
      title: `DONE — v2 executed: ranked rows folded into Tonight's Pick, tier-0 ELIMINATION badge live ${A}`,
      reason: 'PROBE CHANGED THE VERDICT. The note recorded a correction made "before execution" and never said whether v2 ran. It did: jubilant-bassoon src/legacy/field.js carries "// 5. Tonight\'s Pick", the tier-0-only ELIMINATION badge, and a comment restating v2\'s naming-collision fix verbatim.' },

    { key: 'CC-CMD-2026-07-09-enqueue-context-gap.md', want: 'closed', status: 'resolved',
      title: `DONE — relay TASKS 3-4 shipped 0952d28 the same day; enqueue carries home/away/scores/matchupNote at HEAD ${A}`,
      reason: 'PROBE OVERTURNED THE TITLE. It reads "TASK 3-4 (relay) still pending" and was stale within hours: field-relay-nba outbox/cc-enqueue-context-gap-relay-2026-07-09.md records both executed and live-verified on 2026-07-09, and src/index.js still binds all five fields into JOURNALISM_QUEUE.send. A client session reported the relay repo\'s state from a distance — the source-versus-copy substitution.' },

    { key: 'datamuse-relay-proxy', want: 'closed', status: 'resolved',
      title: `DONE — both sides live and verified: relay 664a039, client 8ede35e ${A}`,
      reason: 'The body already says "Both sides complete and verified live as of 2026-07-12" with commits, a real fetch response, and end-to-end scores. Nothing was undetermined but the leading word.' },

    { key: 'bucketc-inverse-problem-confirmed', want: 'closed', status: 'resolved',
      title: `DONE — investigation complete (2 reclassified C->B, telemetry reinstated); the residual is a standing check, refile as a rule ${A}`,
      reason: 'The work finished: 2 genuine misclassifications found and reclassified, telemetry reinstated, suites run, plus a separate real ReferenceError fixed. What remains is a STANDING INSTRUCTION for future clusters, which never completes — a rule miscategorised as a queue entry. Closing it as a queue item; it should be refiled under category "rule".' },

    { key: 'journalismbrief-endpoint-correction', want: 'closed', status: 'resolved',
      title: `DONE — both corrections applied, surviving reason documented; the standing lesson should be refiled as a rule ${A}`,
      reason: 'The body says "Both now fixed" and states what survives (/journalism/brief ignores ?date=, so /analytics/newspaper/{date} is the right target). No residual work. Like bucketc, it carries a STANDING LESSON that belongs under "rule", not in a work queue.' },

    { key: 'CC-CMD-2026-07-07-espn-cache-date-qualification.md', want: 'open', status: null,
      title: `BLOCKED — the doc self-declares "not an execution-ready CC-CMD"; needs deliberate review and staging before dispatch ${A}`,
      reason: 'Held BY DESIGN and the hold still stands. The document\'s own header reads "Status: NOT for tonight. This is a scoping document... Do not dispatch this with an execution one-liner until it\'s been reviewed and staged deliberately." 74 espnScores references, a dozen-plus unqualified read sites.' },

    { key: 'p15b-p16-getqualitytarget', want: 'open', status: null,
      title: `OPEN — only P16 survives: getQualityTarget resolved, and loadQualityCalibration no longer exists so its empty-catch residual is moot ${A}`,
      reason: 'PROBE RETIRED ONE OF TWO RESIDUALS. loadQualityCalibration is not defined anywhere in relay src/ at HEAD — only referenced in comments — so its empty final catch cannot still be a gap. P16 (retroactive drama estimation) could NOT be settled from the record and is stated as the one live question rather than guessed: a "Retroactive Drama Backfill" shipped in the client on 2026-07-02, eleven days before this note called P16 unbuilt, so either they are different features or the note was wrong.' },

    { key: 'brief-archive-health-audit', want: 'open', status: null,
      title: `OPEN — compound/client and series_preview/stakes archival still unexamined; the backfill stall was already dispatched a7ce4d0 ${A}`,
      reason: 'The body names its own residual: "Not yet investigated: compound/client (5 rows total, silent since July 10) and the near-zero series_preview/stakes client archival (1 row each, ever) -- flagging for a future pass, not dispatched this turn."' },

    { key: 'relay-empty-catches-sweep', want: 'open', status: null,
      title: `OPEN — 70 functionally-empty catch bodies measured across relay src/ on 2026-09-10 by an independent count ${A}`,
      reason: 'RE-MEASURED TODAY rather than inherited. An independent regex count over relay src/*.js finds 70 catch bodies that are empty once comments are stripped (bracket-do 11, game-do 10, ambient-do 9, context-assembler 9, index 9, analytics-engine 7, wp-resolver 5, others 1-3). That is a DIFFERENT INSTRUMENT from the tree-sitter tool that produced the 118/~95 figures, so it does not refute them — but it is decisively greater than zero, which is the only question adjudication has to answer.' },

    { key: '2026-07-16-drama-gateway-and-amnesty-zone-held', want: 'open', status: null,
      title: `BLOCKED — held set is 2 not 4: relay leaderboard shipped 2026-07-20, bottom-sheet CLOSED 2026-09-04; card-face + arc-poster await product sequencing ${A}`,
      reason: 'PROBE HALVED THE HOLD. The note says the relay CC-CMD "still needs dispatching" — /archive/drama/leaderboard is live in relay src/index.js and in the MCP probe allow-list, its comment dated 2026-07-20, one day after this note was last updated. And amnesty-bottom-sheet carries "Status: CLOSED 2026-09-04" in its own doc. Two genuinely remain, held on a product-sequencing decision that is the owner\'s.' },
];

let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`); } };

// ---------------------------------------------------------------------------
// SELF-TEST (Rule 90). These assertions exist to fail. Two of the three below
// were written by breaking the thing first and watching the check go red; the
// third is the mutation that proved the second has teeth at all.
// ---------------------------------------------------------------------------
if (SELF_TEST) {
    check('every verdict title classifies as its own verdict says',
        VERDICTS.every(v => classify({ title: v.title, status: v.status ?? 'open' }) === v.want),
        VERDICTS.filter(v => classify({ title: v.title, status: v.status ?? 'open' }) !== v.want)
                .map(v => `${v.key} -> ${classify({ title: v.title, status: v.status ?? 'open' })}`).join('; '));

    check('all ten keys are distinct — no row is adjudicated twice',
        new Set(VERDICTS.map(v => v.key)).size === VERDICTS.length,
        'a duplicate key would mean one write silently overwrites another');

    check('every verdict carries a reason, and it is not a restatement of the title',
        VERDICTS.every(v => v.reason && v.reason.length > 80 && v.reason !== v.title),
        'a verdict without stated evidence is the defect this queue exists to surface');

    check('the split is 5 closed / 5 open, as adjudicated',
        VERDICTS.filter(v => v.want === 'closed').length === 5
        && VERDICTS.filter(v => v.want === 'open').length === 5,
        `${VERDICTS.filter(v => v.want === 'closed').length} closed / ${VERDICTS.filter(v => v.want === 'open').length} open`);

    // MUTATION: a title that states no disposition must NOT satisfy an 'open'
    // verdict. Without this, the check above passes on any title at all whose
    // verdict happens to be 'undetermined', and a prefix typo ships silently.
    check('MUTATION: a dispositionless title does not satisfy an open verdict',
        classify({ title: 'Adjudicated 2026-09-10 — still going', status: 'open' }) !== 'open',
        'the title check has no teeth: it would accept a title that classifies as undetermined');

    // MUTATION: status must be able to close a row on its own, and must NOT be
    // able to open one — 'open' is the ALTER TABLE default and carries nothing.
    check('MUTATION: a deliberate resolved status closes a DONE-less title',
        classify({ title: 'no leading disposition here', status: 'resolved' }) === 'closed',
        'the status asymmetry is gone; five closed verdicts rely on it');
    check('MUTATION: a default open status cannot open a dispositionless title',
        classify({ title: 'no leading disposition here', status: 'open' }) === 'undetermined',
        "'open' is a DEFAULT, not a judgement — if it classified as open, every untouched row would look adjudicated");

    console.log(`\n${failed === 0 ? 'SELF-TEST PASS' : `${failed} FAILING`}`);
    process.exit(failed === 0 ? 0 : 1);
}

if (!MCP) { console.error('FIELD_MCP_SECRET is not set. This script will not guess it.'); process.exit(1); }
if (!APPLY && !PLAN) { console.error('pass --plan, --apply or --self-test'); process.exit(1); }

console.log(`mode: ${APPLY ? 'APPLY' : 'PLAN (no writes)'}`);
console.log(`adjudicating ${VERDICTS.length} of the 10 undetermined rows\n`);

// ---- read every row first, and assert the anchor ----
const before = new Map();
for (const v of VERDICTS) {
    const row = await call('codex_read', { key: v.key });
    if (row.error) { check(`${v.key} exists`, false, row.error); continue; }
    before.set(v.key, row);
}
check('all ten rows were read', before.size === VERDICTS.length, `read ${before.size}`);
if (before.size !== VERDICTS.length) process.exit(1);

for (const v of VERDICTS) {
    const r = before.get(v.key);
    check(`ANCHOR ${v.key} is undetermined before the write`,
        classify(r) === 'undetermined',
        `classifies as ${classify(r)} already — status=${r.status} firstWord=${firstWord(r.title)}. `
        + 'This script is aimed at the wrong record; refusing to write.');
}
if (failed) { console.log('\nanchor assertions failed — NOT writing'); process.exit(1); }

// The new title must itself classify the way the verdict says, or the write is
// a no-op wearing a new sentence.
for (const v of VERDICTS) {
    check(`the new title for ${v.key} classifies as ${v.want}`,
        classify({ title: v.title, status: v.status ?? 'open' }) === v.want,
        `new title classifies as ${classify({ title: v.title, status: v.status ?? 'open' })}`);
}
if (failed) { console.log('\nverdict titles do not classify as intended — NOT writing'); process.exit(1); }

// ---- pre-image, written before anything is touched ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const preimage = `outbox/codex-queue-adjudicate-preimage-${stamp}.json`;
const { writeFileSync } = await import('node:fs');
writeFileSync(preimage, JSON.stringify({
    taken_at: new Date().toISOString(),
    why: 'pre-image of the ten undetermined cc-cmd-queue rows, taken before adjudication wrote titles and statuses. Restores are possible from this file alone, independently of codex_history.',
    rows: VERDICTS.map(v => before.get(v.key)),
}, null, 2));
console.log(`\npre-image written: ${preimage}`);

for (const v of VERDICTS) {
    const r = before.get(v.key);
    console.log(`\n--- ${v.key}`);
    console.log(`    was : [${classify(r)}] ${r.title}`);
    console.log(`    now : [${v.want}] ${v.title}`);
    console.log(`    why : ${v.reason}`);
}

if (!APPLY) { console.log(`\n${failed === 0 ? 'PLAN OK — no writes made' : 'PLAN FAILED'}`); process.exit(failed === 0 ? 0 : 1); }

// ---- apply ----
console.log('\n=== APPLYING ===');
for (const v of VERDICTS) {
    const r = before.get(v.key);
    const args = { key: v.key, category: r.category, title: v.title, content: r.content };
    if (v.status) args.status = v.status;          // omitting preserves the existing status
    await call('codex_write', args);
    console.log(`  wrote ${v.key}`);
}

// ---- verify by re-reading, not by trusting the writes ----
console.log('');
for (const v of VERDICTS) {
    const r = await call('codex_read', { key: v.key });
    const okTitle = r.title === v.title;
    const okClass = classify(r) === v.want;
    const okBody = r.content === before.get(v.key).content;
    check(`${v.key} → ${v.want}`, okTitle && okClass && okBody,
        `title match=${okTitle} class=${classify(r)} bodyUnchanged=${okBody}`);
}

// ---- the done condition is the live instrument, not this script ----
const health = await call('session_health', {});
const q = health.cc_cmd_queue;
console.log('\n--- cc_cmd_queue after adjudication ---');
console.log(JSON.stringify({ total: q.total, open: q.open, undetermined: q.undetermined,
                             closed: q.closed, returned: q.returned, truncated: q.truncated }, null, 2));
check('undetermined is now zero', q.undetermined === 0, `still ${q.undetermined}`);
check('the three counts still account for every row',
    q.open + q.undetermined + q.closed === q.total,
    `${q.open} + ${q.undetermined} + ${q.closed} !== ${q.total}`);

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
