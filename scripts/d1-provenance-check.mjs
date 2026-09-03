// The provenance instrumentation says what it is wired into. This checks it.
//
// TWO CLAIMS, BOTH MADE IN src/d1-provenance.js's own comments, neither of which
// is true by construction:
//
//   1. `D1_WRITE_SITES` is the list of sites, not a copy of it. A site added to
//      src/index.js without a line here, or a line here with no call there,
//      makes the module's comment a lie and the control's "one entry per site"
//      assertion unfalsifiable — it would pass by enumerating a shorter list.
//   2. `idScheme` separates the external writer's ids from ours. A predicate
//      asserted only against strings that already pass is not asserted at all,
//      so every bucket here carries a counterexample.
//
// Usage:  node scripts/d1-provenance-check.mjs --self-test
//         node scripts/d1-provenance-check.mjs

import { readFileSync } from 'node:fs';
import { idScheme, provenanceScheme, D1_WRITE_SITES, D1_WRITE_INDEX } from '../src/d1-provenance.js';

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
};

if (process.argv.includes('--self-test')) {
    // ── the schemes, each with a counterexample ──────────────────────────────
    // MEASURED SHAPES, not invented ones. The two dash ids were observed in
    // regular_season_games (2026-08-01 and 2026-08-31); the underscore ids are
    // what /archive/game builds, one team-name-keyed and one numeric-ESPN-keyed.
    t('the external writer\'s shape is dash', idScheme('2026-08-30-mls-stl-dal') === 'dash');
    t('...and the other observed one', idScheme('2026-08-29-mls-dc-lafc') === 'dash');
    t('our team-name key is underscore', idScheme('MLS_2026-08-29_dcunited_lafc') === 'underscore');
    t('our numeric-ESPN key is too', idScheme('MLB_2099-03-01_e999000111') === 'underscore');
    t('a golf key is underscore', idScheme('MLB_2099-03-02_testalpha_dream') === 'underscore');

    // COUNTEREXAMPLES. Each of these would be classified `dash` by a looser
    // predicate, and each is the reason the predicate is not looser.
    t('an underscore anywhere defeats dash, even after a leading date',
      idScheme('2026-08-30-mls-stl_dal') === 'underscore',
      'a leading ISO date is not sufficient — no id of ours lacks an underscore');
    t('a date with no trailing hyphen is not dash',
      idScheme('2026-08-30') === 'other');
    t('a hyphenated non-date is not dash',
      idScheme('mls-stl-dal') === 'other');
    t('a two-digit year is not a date', idScheme('26-08-30-mls-stl-dal') === 'other');
    t('absent is `none`, not `other`', idScheme(null) === 'none' && idScheme('') === 'none'
      && idScheme('   ') === 'none' && idScheme(undefined) === 'none',
      'a missing id must be its own state — bucketing it with `other` hides it');
    t('a non-string is `none`, not a crash', idScheme(12345) === 'none');

    t('DASH AND UNDERSCORE CANNOT BOTH MATCH', (() => {
        for (const s of ['2026-08-30-mls-stl-dal', 'MLS_2026-08-29_a_b', '2026-08-30-a_b', 'x'])
            if (idScheme(s) === 'dash' && s.includes('_')) return false;
        return true;
    })(), 'mutual exclusion is by construction, not by which test runs first');

    // ── control precedence ───────────────────────────────────────────────────
    t('the control header relabels an ordinary write',
      provenanceScheme('MLS_2026-08-29_dcunited_lafc', true) === 'control');
    t('...and does nothing without the header',
      provenanceScheme('MLS_2026-08-29_dcunited_lafc', false) === 'underscore');
    t('DASH OUTRANKS CONTROL — the header cannot hide the observation',
      provenanceScheme('2026-08-30-mls-stl-dal', true) === 'dash',
      'if control won here, anyone sending the header while inserting a dash row '
      + 'would relabel the exact thing this instrument exists to catch');

    t('the index literal is the one the verifier reads', D1_WRITE_INDEX === 'd1-write');

    console.log(`\n${pass}/${pass + fail} checks passed`);
    process.exit(fail ? 1 : 0);
}

// ── the static wiring check ──────────────────────────────────────────────────
const src = readFileSync('src/index.js', 'utf8');
const found = [...src.matchAll(/recordD1Write\(env, request, \{ site: '([^']+)'/g)].map(m => m[1]);

const declared = new Set(D1_WRITE_SITES);
const seen = new Set(found);

const missing = D1_WRITE_SITES.filter(s => !seen.has(s));
const extra = found.filter(s => !declared.has(s));
const dupes = found.filter((s, i) => found.indexOf(s) !== i);

t('every declared site has a call in src/index.js', missing.length === 0,
  `no call for: ${missing.join(', ')}`);
t('every call in src/index.js is declared', extra.length === 0,
  `undeclared site(s): ${[...new Set(extra)].join(', ')}`);
t('no site name is used twice', dupes.length === 0,
  `a duplicate name makes two doors indistinguishable in the data: ${[...new Set(dupes)].join(', ')}`);
t('the count matches the CC-CMD\'s approved scope of 10',
  D1_WRITE_SITES.length === 10 && found.length === 10,
  `declared ${D1_WRITE_SITES.length}, found ${found.length}`);

// EVERY SITE NAME MUST RESOLVE AGAINST HEAD. This check exists because the
// first version of the list said `/archive/drama-peak`, written from the field
// name rather than probed; the route is `/archive/drama-by-id`. A site name that
// names nothing looks identical in the data to one that names a real door, and
// the control would then assert one entry for a path that cannot be reached.
for (const site of D1_WRITE_SITES) {
    const target = site.split(':')[0];
    const ok = target.startsWith('/')
        ? src.includes(`pathname === '${target}'`)
        : src.includes(`function ${target}(`);
    t(`${site} names something that exists at HEAD`, ok,
      target.startsWith('/') ? `no route handler for ${target}` : `no function ${target}`);
}

// NO SQL, NO CREDENTIAL, NO IP may travel with a provenance call. The security
// constraints are in the CC-CMD; this is the mechanical half of them.
const provenance = readFileSync('src/d1-provenance.js', 'utf8');
t('the module reads no header but user-agent',
  (provenance.match(/headers\?\.get\(([^)]*)\)/g) || [])
      .every(h => /user-agent|CONTROL_HEADER/.test(h)),
  'every headers.get in the module must be user-agent or the control marker');
t('the module never reads an IP',
  !/cf-connecting-ip|x-forwarded-for|\.ip\b/i.test(provenance));
// A BARE VERB IS THE POINT, so the first version of this check was wrong: it
// matched `verb: 'UPDATE'` and failed on correct code. What must never travel is
// STATEMENT text — a verb bound to a target, or a prepared statement — because
// that carries row data. The predicate is the statement shape, and it is proven
// on a fixture rather than only on the file that already passes.
//
// AND IT IS SCOPED TO THE CALL'S OWN ARGUMENT, which the second version was not:
// a window of N characters after `recordD1Write(` runs past the closing paren
// into the surrounding route, where real SQL always sits — so it reported the
// correct file as carrying a statement. Parens are balanced instead, the same
// reason scripts/d1-write-sites.mjs balances them.
const STATEMENT = /INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET|SELECT\s+[\s\S]{0,80}?\sFROM|\.prepare\s*\(/i;
const callArgs = (text) => {
    const out = [];
    const re = /recordD1Write\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const open = text.indexOf('(', m.index);
        let depth = 0, quote = null, i = open;
        for (; i < text.length; i++) {
            const c = text[i], prev = text[i - 1];
            if (quote) { if (c === quote && prev !== '\\') quote = null; continue; }
            if (c === '`' || c === "'" || c === '"') { quote = c; continue; }
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (depth === 0) break; }
        }
        out.push(text.slice(open + 1, i));
    }
    return out;
};
const carriesStatement = (text) => callArgs(text).some(a => STATEMENT.test(a));

t('the statement-shape predicate TRIPS on a call that carries SQL',
  carriesStatement("recordD1Write(env, request, { site: 'x', sql: 'UPDATE regular_season_games SET a = 1' });"),
  'a predicate that never fires proves nothing about the file it passes on');
t('...and on a prepared statement passed through',
  carriesStatement('recordD1Write(env, request, { stmt: env.ARCHIVE_DB.prepare(`SELECT 1`) });'));
t('...and does NOT trip on the bare verb literal every real call carries',
  !carriesStatement("recordD1Write(env, request, { site: 'x', verb: 'UPDATE', table: 'regular_season_games', id });"));
t('no call site passes SQL text', !carriesStatement(src),
  'verb and table are literals at the call site; the statement never travels');

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
