// Every identifier a module CALLS from another module, it must IMPORT.
//
// WHY THIS EXISTS. On 2026-09-05 dde1dc4 added `withKvProvenance(env, 'do:X')`
// to four Durable Object constructors and the import to ONE of them. The other
// three — AmbientDO, GameDO, UserDO — referenced an identifier that does not
// exist in their module scope.
//
// A ReferenceError in a DO constructor is not a quiet failure. Cloudflare
// returns its own 500 page, error code 1101, and that page carries no CORS
// headers — so a browser reports "No Access-Control-Allow-Origin header is
// present" and the actual fault never reaches anyone's eyes. Measured today:
// /live/ambient and /ambient/state both 500/1101. The SSE stream, the live
// score WebSocket fan-out and per-user state were all dead for a day, and the
// only visible symptom was a CORS message about a header.
//
// Nothing caught it. `node --check` parses one file and cannot see across
// modules. Smoke never ran the constructor. The deploy succeeded because
// wrangler bundles an undefined identifier without complaint — it is only an
// error when the line executes, and the line executes in production.
//
// This checks the one thing that would have: a symbol used here comes from
// somewhere.

import fs from 'node:fs';
import path from 'node:path';

const SRC = process.env.SRC_DIR || 'src';

// Only names EXPORTED by a sibling module are checked. A global, a local
// definition or a builtin is not this script's business, and treating one as a
// missing import would make the check fire everywhere and get switched off.
const exportsByName = new Map();          // name -> file that exports it
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) exportsByName.set(m[1], f);
  for (const m of src.matchAll(/^export\s+(?:const|let|class)\s+(\w+)/gm)) exportsByName.set(m[1], f);
}

const failures = [];
const checked = [];
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
  const full = path.join(SRC, f);
  const src = fs.readFileSync(full, 'utf8');
  // Strip comments and strings so a name mentioned in prose is not a call.
  // The 2026-09-06 short-circuit lint in field-laboratory learned this the
  // hard way: a banned token inside the comment explaining the ban failed it.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) imported.add(name);
    }
  }
  // Defined locally counts as resolved.
  const localDefs = new Set();
  for (const m of code.matchAll(/(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) localDefs.add(m[1]);
  for (const m of code.matchAll(/(?:^|\s)(?:export\s+)?(?:const|let|var|class)\s+(\w+)/g)) localDefs.add(m[1]);

  for (const [name, owner] of exportsByName) {
    if (owner === f) continue;                       // it lives here
    if (imported.has(name) || localDefs.has(name)) continue;
    const called = new RegExp(`\\b${name}\\s*\\(`).test(code);
    if (called) failures.push(`${full}: calls ${name}() — exported by ${owner} — with no import`);
  }
  checked.push(f);
}

console.log(`check-imports-resolve: ${checked.length} module(s) in ${SRC}/, `
  + `${exportsByName.size} exported symbol(s), ${failures.length} unresolved`);
for (const m of failures) console.log(`  FAIL ${m}`);
if (!checked.length) { console.log('  no modules found — that is a finding, not a pass'); process.exit(1); }
process.exit(failures.length ? 1 : 0);
