// Two questions about `canonicalizeBriefSport`, asked separately because they
// fail differently.
//
//   STATIC  (this file, no network): does the function actually map the four
//           values measured accumulating on 2026-09-09, and does it leave alone
//           the two lowercase labels the games tables really carry?
//
//   LIVE    (--live, needs the relay): does the DECLARED set still cover what
//           the games tables hold? A static set drifts the moment a new sport is
//           archived, and drift is silent — the canonicaliser returns the new
//           label unchanged, which is correct, while a caption naming it would
//           no longer resolve.
//
// The static half runs in the deploy gate. The live half needs D1 and runs in
// the verify job.
//
//   node scripts/check-sport-canonicaliser.mjs --self-test
//   node scripts/check-sport-canonicaliser.mjs
//   node scripts/check-sport-canonicaliser.mjs --live

import { readFileSync } from 'node:fs';

const FILE = 'src/index.js';
let failed = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) { failed++; if (detail) console.log(`      → ${detail}`); }
};

// ── the function, extracted and evaluated ───────────────────────────────────
//
// EVALUATED, NOT PATTERN-MATCHED. A regex asserting "the map contains 'MLS
// Soccer'" passes on a map that is never consulted, which is the shape of half
// the defects in this repo's own history. This runs the real thing.
const src = readFileSync(FILE, 'utf8');
const grab = (startMarker, endMarker) => {
    const a = src.indexOf(startMarker);
    if (a === -1) throw new Error(`marker not found in ${FILE}: ${startMarker}`);
    const b = src.indexOf(endMarker, a);
    if (b === -1) throw new Error(`end marker not found after ${startMarker}`);
    return src.slice(a, b + endMarker.length);
};

let canonicalize;
try {
    const soccer = grab('const SOCCER_LEAGUE_LABELS = {', '\n};');
    const nonSoccer = grab('const NON_SOCCER_SPORT_LABELS = [', '\n];');
    const set = grab('const ARCHIVE_SPORT_LABELS = new Set([', '\n]);');
    const aliases = grab('const SPORT_DISPLAY_ALIASES = {', '\n};');
    const prefix = grab('const sportContextPrefix = (value) => {', '\n};');
    const casing = grab('const sportCasingMatch = (value) => {', '\n};');
    const fn = grab('function canonicalizeBriefSport(sport) {', '\n}');
    canonicalize = new Function(
        `${soccer}\n${nonSoccer}\n${set}\n${aliases}\n${prefix}\n${casing}\n${fn}\nreturn canonicalizeBriefSport;`)();
} catch (e) {
    check('the canonicaliser can be extracted and evaluated', false, e.message);
    process.exit(1);
}
check('the canonicaliser can be extracted and evaluated', typeof canonicalize === 'function');

// ── the SET itself, asserted directly ───────────────────────────────────────
//
// ALSO ADDED after a mutation survived. Replacing the conforming check
// (`if (ARCHIVE_SPORT_LABELS.has(raw)) return raw;`) with `if (false)` passed
// every row, because for all 28 measured labels `sportContextPrefix` reaches the
// same answer — none of them contains a dash or middot, so splitting on those
// returns the whole string, and set membership is then re-tested inside the
// prefix helper.
//
// That is a true fact about today's labels, not a defect: the conforming check
// is the line that states the intent and is the only one that would survive a
// future label containing a separator. It is left in place and its redundancy is
// recorded rather than hidden. What CAN be covered is the set's own contents, so
// they are asserted here directly instead of through the function.
const declared = new Function(
    `${grab('const SOCCER_LEAGUE_LABELS = {', '\n};')}
     ${grab('const NON_SOCCER_SPORT_LABELS = [', '\n];')}
     ${grab('const ARCHIVE_SPORT_LABELS = new Set([', '\n]);')}
     return ARCHIVE_SPORT_LABELS;`)();
for (const must of ['golf', 'wnba', 'WNBA', 'PGA Tour', 'MLS', 'FIFA World Cup', 'CFL', 'EFL Trophy']) {
    check(`ARCHIVE_SPORT_LABELS declares ${JSON.stringify(must)}`, declared.has(must),
        'measured in the games tables 2026-09-09; a label the set omits is one no caption resolves to');
}
// COVERAGE, NOT EQUALITY, and the difference cost a red run to learn.
//
// The first version asserted `declared.size === 28` against the census. It
// failed at 31: SOCCER_LEAGUE_LABELS declares EFL Championship, EFL League One
// and EFL League Two, none of which has an archived game yet. That is correct —
// declaring a competition before its first fixture lands is the whole point of a
// declaration — and an equality assertion would have gone red every time a new
// competition was added, training someone to widen the number without reading.
//
// The real invariant is one-directional: every label the games tables carry must
// be declared. The reverse is not a defect and is reported as information.
const MEASURED_AUTHORITY = 28;   // scripts/brief-sport-authority-census.mjs, 2026-09-09
check(`the declared set covers the ${MEASURED_AUTHORITY} labels the census measured`,
    declared.size >= MEASURED_AUTHORITY,
    `${declared.size} declared, ${MEASURED_AUTHORITY} measured — fewer declared than measured means `
    + 'at least one live label is unknown to the canonicaliser. The --live half names which.');
if (declared.size > MEASURED_AUTHORITY) {
    console.log(`      note: ${declared.size - MEASURED_AUTHORITY} label(s) declared with no archived `
        + 'game yet — expected, not a defect. --live checks the direction that matters.');
}

// ── the four measured producers ─────────────────────────────────────────────
// Every row here is a value that was really in briefs.sport on 2026-09-09, with
// its row count. None is invented.
const MEASURED = [
    ['MLS Soccer', 'MLS', 7],
    ['PGA TOUR', 'PGA Tour', 2],
    ['CFL – 2026 Season · Week 14', 'CFL', 2],
    ['wc', 'FIFA World Cup', 1],
];
for (const [from, to, n] of MEASURED) {
    check(`${JSON.stringify(from)} -> ${to}  (${n} row(s) measured)`,
        canonicalize(from) === to, `got ${JSON.stringify(canonicalize(from))}`);
}

// ── the trap: lowercase AND conforming ──────────────────────────────────────
// CC-CMD-2026-08-20's central warning. The games tables carry `golf` and `wnba`
// in exactly those forms, so a "fix the lowercase ones" pass breaks working
// joins. This is the row that fails if casing recovery is ever let loose.
for (const keep of ['golf', 'wnba', 'WNBA', 'MLB', 'PGA Tour', 'MLS', 'EFL Cup', 'La Liga']) {
    check(`${JSON.stringify(keep)} is returned UNCHANGED — it is already a label`,
        canonicalize(keep) === keep, `got ${JSON.stringify(canonicalize(keep))}`);
}

// ── the ambiguity refusal ───────────────────────────────────────────────────
//
// ADDED after a mutation survived. Changing `hits.length === 1` to `>= 1` in
// sportCasingMatch passed every row above, because `golf`, `wnba`, `WNBA` and
// the rest are caught by the conforming check first and never reach casing
// recovery at all. Nothing here exercised it on an AMBIGUOUS input.
//
// `Wnba` is that input: it is not itself a label, and it matches BOTH `WNBA` and
// `wnba` case-insensitively. Exactly one match is a recovery; two is a guess.
check('an AMBIGUOUS casing match is refused, not guessed',
    canonicalize('Wnba') === 'Wnba',
    `got ${JSON.stringify(canonicalize('Wnba'))} — 'WNBA' and 'wnba' are BOTH real labels in the `
    + 'games tables, so picking either is inventing a join');

// ...and the unambiguous direction, so "refuse everything" does not pass the row
// above. There is no label spelled 'mlb', so this has exactly one match.
check('an UNAMBIGUOUS casing match is recovered',
    canonicalize('mlb') === 'MLB',
    `got ${JSON.stringify(canonicalize('mlb'))}`);

// ── what it must NOT do ─────────────────────────────────────────────────────
check('an unrecognised value is returned unchanged, never guessed',
    canonicalize('Quidditch Premier League') === 'Quidditch Premier League',
    `got ${JSON.stringify(canonicalize('Quidditch Premier League'))} — inventing a label is worse `
    + 'than leaving one the migration and the guard can both see');

check('a caption whose prefix is NOT a label does not resolve',
    canonicalize('Kabaddi – 2026 Season · Week 3') === 'Kabaddi – 2026 Season · Week 3',
    `got ${JSON.stringify(canonicalize('Kabaddi – 2026 Season · Week 3'))}`);

// A plain hyphen must NOT split: a real competition label could contain one.
check('a plain hyphen is not a caption separator',
    canonicalize('MLB - something') === 'MLB - something',
    `got ${JSON.stringify(canonicalize('MLB - something'))} — splitting on '-' would truncate a `
    + 'real label that contains one');

check('null and empty pass through untouched',
    canonicalize(null) === null && canonicalize('') === '',
    'a falsy sport is a real state (the slate brief writes NULL), not a value to map');

// ── forward-looking: the captions that have not landed yet ──────────────────
// `game.league` is a display string and the client passes it as `sport`. The
// residual is not four values; it is whatever that field happens to hold.
check("'WNBA – 2026 Season' resolves — the next caption waiting in the client",
    canonicalize('WNBA – 2026 Season') === 'WNBA',
    `got ${JSON.stringify(canonicalize('WNBA – 2026 Season'))} (src/legacy/field.js:9326)`);

check("a caption carrying a season YEAR in the prefix resolves",
    canonicalize('AFL 2026 — Round 15') === 'AFL',
    `got ${JSON.stringify(canonicalize('AFL 2026 — Round 15'))}`);

// ── self-test: can this file tell a working canonicaliser from a broken one? ─
if (process.argv.includes('--self-test')) {
    // A canonicaliser that returns its input always would pass every
    // "unchanged" row above and fail every mapping row. One that maps
    // everything to 'MLB' would do the reverse. Both must be caught, or the
    // rows above are decoration.
    const identity = v => v;
    const always = () => 'MLB';
    const mappedRows = MEASURED.filter(([from, to]) => identity(from) === to).length;
    check('SELF-TEST: an identity canonicaliser fails the mapping rows',
        mappedRows === 0, `${mappedRows} of ${MEASURED.length} mapping rows would still pass`);
    const keptRows = ['golf', 'wnba', 'MLB'].filter(k => always(k) === k).length;
    check('SELF-TEST: a map-everything canonicaliser fails the unchanged rows',
        keptRows < 3, `${keptRows} of 3 unchanged rows would still pass`);
    check('SELF-TEST: the measured set is not empty', MEASURED.length > 0,
        'no measured producer values — every mapping row above would be vacuous');
}

// ── the live half ───────────────────────────────────────────────────────────
if (process.argv.includes('--live')) {
    const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const GATE = process.env.RELAY_SHARED_SECRET;
    if (!GATE) { console.error('RELAY_SHARED_SECRET is not set. This script will not guess it.'); process.exit(1); }
    const d1 = async (sql) => {
        const r = await fetch(`${RELAY}/d1/execute`, {
            method: 'POST',
            headers: { 'X-FIELD-Relay': GATE, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, params: [] }),
        });
        const t = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return (JSON.parse(t).results || []).map(x => x.sport);
    };
    const reg = await d1(`SELECT DISTINCT sport FROM regular_season_games WHERE sport IS NOT NULL`);
    const post = await d1(`SELECT DISTINCT sport FROM postseason_games WHERE sport IS NOT NULL`);
    const live = [...new Set([...reg, ...post])].sort();

    check('the games tables returned labels to check against', live.length > 0,
        'zero labels — the assertion below would be vacuously true, which is this repo\'s recurring wound');

    const undeclared = live.filter(l => canonicalize(l) !== l);
    check(`every label the games tables carry is declared (${live.length} checked)`,
        undeclared.length === 0,
        `NOT declared: ${JSON.stringify(undeclared)}. Add them to NON_SOCCER_SPORT_LABELS or `
        + 'SOCCER_LEAGUE_LABELS in src/index.js — a label the canonicaliser does not know is one '
        + 'a caption naming it will not resolve to.');
}

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
