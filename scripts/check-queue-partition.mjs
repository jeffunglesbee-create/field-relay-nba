// The CC-CMD queue partition, evaluated against the rows it was derived from.
//
// CC-CMD-2026-09-07-session-health-queue-coverage. The instrument's failure was
// reporting a number as fact. So the thing to guard is not "does it return 15" —
// it is whether the three counts still ADD UP and still land every row by a rule.
//
// THE ARITHMETIC IS THE TEETH. open + undetermined + closed must equal total. A
// classifier that dropped a row, double-counted one, or quietly folded
// `undetermined` into `closed` breaks that sum and cannot break it silently.
//
//   node scripts/check-queue-partition.mjs --self-test
//   node scripts/check-queue-partition.mjs --live

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) { failed++; if (detail) console.log(`      → ${detail}`); }
};

// ── extract the real classifier, do not re-implement it ─────────────────────
// A second copy in this file would be a second rule, and the two would agree
// until the day they did not.
const src = readFileSync('src/index.js', 'utf8');
const grab = (a, b) => {
    const i = src.indexOf(a);
    if (i === -1) throw new Error(`marker not found in src/index.js: ${a}`);
    const j = src.indexOf(b, i);
    if (j === -1) throw new Error(`end marker not found after ${a}`);
    return src.slice(i, j + b.length);
};

let classify, firstWord;
try {
    const built = new Function(`
        ${grab("const CLOSED_WORDS = [", "'WITHDRAWN', 'MERGED', 'EXECUTED'];")}
        ${grab("const OPEN_WORDS = [", "'BLOCKED'];")}
        ${grab("const firstWord = (t) =>", ".replace(/[^A-Z]/g, '');")}
        ${grab("const classify = (r) => {", "\n                            };")}
        return { classify, firstWord, CLOSED_WORDS, OPEN_WORDS };`)();
    ({ classify, firstWord } = built);
    check('the classifier extracts and evaluates from src/index.js', typeof classify === 'function');
} catch (e) {
    check('the classifier extracts and evaluates from src/index.js', false, e.message);
    process.exit(1);
}

// ── the vocabulary, against titles that really exist ────────────────────────
// Every row below was read from the live table on 2026-09-09. None is invented.
const REAL = [
    // deliberate status closes it even though the leading word does not
    { key: 'cf/2026-07-02/soccer-player-identity-shipped', status: 'resolved',
      title: 'Soccer player identity resolution shipped — soccer_player type added', want: 'closed' },
    // 'open' is a DEFAULT and must NOT close, and must not open either
    { key: 'relay-empty-catches-sweep', status: 'open',
      title: 'CORRECTED -- true relay empty-catch total is 118, not 50', want: 'undetermined' },
    { key: 'playground-weatherpoll-wrong-endpoint', status: 'open',
      title: 'OPEN — WeatherPoll: wrong endpoint; fix is direct Open-Meteo', want: 'open' },
    { key: 'queue-deadcode-and-ambiguous', status: 'open',
      title: 'PENDING -- dead-code removal HALF LANDED, no execution record', want: 'open' },
    { key: 'cliche-freshness-scoring', status: 'open',
      title: 'BLOCKED -- premise empirically disproven; hasCliche() left unchanged', want: 'open' },
    { key: 'datamuse-relay-proxy', status: 'open',
      title: 'TASK 1 DONE (field-relay-nba) / TASK 2 DONE (jubilant-bassoon)', want: 'undetermined' },
    { key: 'a-done-row', status: 'open',
      title: 'DONE -- something that shipped', want: 'closed' },
    // 'DONE,' is a real leading token in the table; punctuation must not split it off
    { key: 'a-done-comma-row', status: 'open',
      title: 'DONE, verified live 2026-08-02', want: 'closed' },
    { key: 'a-status-done-row', status: 'done',
      title: 'TASKS 1-2 landed, 3-4 unknown', want: 'closed' },
];
for (const r of REAL) {
    check(`${r.key} → ${r.want}`, classify(r) === r.want,
        `got ${classify(r)} (status=${r.status}, first word=${firstWord(r.title)})`);
}

// ── THE ARITHMETIC ──────────────────────────────────────────────────────────
const counts = REAL.reduce((a, r) => { a[classify(r)] = (a[classify(r)] || 0) + 1; return a; }, {});
const summed = (counts.open || 0) + (counts.undetermined || 0) + (counts.closed || 0);
check('open + undetermined + closed accounts for every row',
    summed === REAL.length,
    `${summed} classified, ${REAL.length} rows — a partition that loses a row reports a smaller queue`);

check('the classifier returns only the three declared buckets',
    Object.keys(counts).every(k => ['open', 'undetermined', 'closed'].includes(k)),
    `saw ${JSON.stringify(Object.keys(counts))}`);

// `undetermined` must be non-empty on real data, or the bucket is decorative and
// the instrument is back to claiming it can classify everything.
check('undetermined is REACHED on real rows, not a bucket nothing lands in',
    (counts.undetermined || 0) > 0,
    'no row classified undetermined — if this ever passes with 0 on the live table, the '
    + 'vocabulary has silently absorbed the unclassifiable, which is the old defect');

// ── self-test: can this file tell a working partition from a broken one? ────
if (process.argv.includes('--self-test')) {
    const alwaysClosed = () => 'closed';
    const alwaysOpen = () => 'open';
    const wrong = REAL.filter(r => alwaysClosed(r) !== r.want).length;
    check('SELF-TEST: an always-closed classifier fails the rows', wrong > 0,
        'every expectation would still pass — the rows are decoration');
    const wrong2 = REAL.filter(r => alwaysOpen(r) !== r.want).length;
    check('SELF-TEST: an always-open classifier fails the rows', wrong2 > 0);
    check('SELF-TEST: the expectations cover all three buckets',
        new Set(REAL.map(r => r.want)).size === 3,
        'a fixture set missing a bucket cannot catch that bucket collapsing into another');
}

// ── live: the partition against the whole table ─────────────────────────────
if (process.argv.includes('--live')) {
    const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const GATE = process.env.RELAY_SHARED_SECRET;
    if (!GATE) { console.error('RELAY_SHARED_SECRET is not set. This script will not guess it.'); process.exit(1); }
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': GATE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `SELECT key, title, status FROM codex WHERE category = 'cc-cmd-queue'`, params: [] }),
    });
    const rows = (JSON.parse(await r.text()).results) || [];
    check('the live table returned rows to partition', rows.length > 0,
        'zero rows — every assertion below would be vacuously true');

    const live = rows.reduce((a, x) => { a[classify(x)] = (a[classify(x)] || 0) + 1; return a; }, {});
    const total = (live.open || 0) + (live.undetermined || 0) + (live.closed || 0);
    check(`the live partition accounts for every row (${rows.length})`, total === rows.length,
        `${total} classified of ${rows.length}`);
    console.log(`      live: open ${live.open || 0}  undetermined ${live.undetermined || 0}  closed ${live.closed || 0}`);
}

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
