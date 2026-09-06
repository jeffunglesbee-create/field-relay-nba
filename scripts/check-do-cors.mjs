// Every response a Durable Object returns carries CORS.
//
// WHY. index.js dispatches DO routes with `return stub.fetch(request)` and adds
// nothing to the headers, so whatever the object returns is what the browser
// receives. A response without Access-Control-Allow-Origin is unreachable from
// a page, and — worse — a browser reports the miss as a CORS error rather than
// as the status it actually is. That disguise cost this repo a day: relay
// c135dcc (2026-05-31) was a 405 read as a CORS block, and 2026-09-06 was a 500
// read the same way.
//
// MEASURED 2026-09-06, before this ran: 59 responses across FIVE Durable
// Objects, two setting the header. Five, not four — the first count came from
// CLAUDE.md's bindings table rather than the filesystem, and missed BrowserDO
// entirely. The gate found it on its first run.
//
//   user-do.js      18 responses, all via a _cors() helper   <- the reference
//   ambient-do.js    9 responses, 1 (the SSE stream only)    <- fixed today
//   game-do.js      19 responses, 0
//   bracket-do.js   12 responses, 0
//   browser-do.js    1 response,  0   (bound, but not browser-reached)
//
// A RATCHET, NOT A CLIFF. Fixing all four in one pass would be an unprompted
// rewrite of two objects nobody asked about, and GameDO is mostly a WebSocket
// upgrade path where the rule reads differently. So the two covered files are
// locked and the two uncovered ones carry a recorded budget: their count may
// fall, never rise. That is the same shape as the citation ratchet in
// field-laboratory's docs check, and it means a new uncovered response in ANY
// object fails, including in the files not yet cleaned up.

import fs from 'node:fs';

const DIR = process.env.SRC_DIR || 'src';
const LOCKED = ['ambient-do.js', 'user-do.js'];
// Recorded, not aspirational: what each file measured when this gate went in.
const BUDGET = { 'game-do.js': 19, 'bracket-do.js': 12, 'browser-do.js': 1 };
//
// browser-do.js is budgeted rather than locked, on evidence. BrowserDO IS bound
// and live — wrangler.toml declares class_name = "BrowserDO" under the
// BROWSER_SESSION binding, index.js imports and re-exports it, and it is
// instantiated at index.js:18942. But no /browser route appears in the
// 187-route provenance manifest and jubilant-bassoon references it zero times:
// it is reached server-to-server, through the MCP browser tools, not from a
// page. CORS on its single _json response is therefore not load-bearing.
//
// Recorded because the first version of this comment said "unbound and
// unreferenced", which was wrong. That grep looked for BROWSER_DO; the binding
// is named BROWSER_SESSION. A name guessed from the class rather than read from
// the config — the same substitution this gate exists to catch, made while
// writing the gate.

// A response's headers can sit on the same line, the next, or ten below. Walk
// to the closing paren rather than reading a fixed window — the fixed-window
// version of this check reported three false misses on multi-line responses
// the same afternoon it was written.
function responsesWithoutCors(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('new Response')) continue;
    let chunk = '', depth = 0;
    for (let j = i; j < Math.min(lines.length, i + 25); j++) {
      chunk += lines[j] + ' ';
      depth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
      if (j > i && depth <= 0) break;
    }
    if (!/_cors\(\)|Access-Control-Allow-Origin/.test(chunk)) {
      out.push({ line: i + 1, text: lines[i].trim().slice(0, 80) });
    }
  }
  return out;
}

const failures = [];
const report = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('-do.js'))) {
  const src = fs.readFileSync(`${DIR}/${f}`, 'utf8');
  const total = (src.match(/new Response/g) || []).length;
  const bare = responsesWithoutCors(src);
  report.push(`  ${f.padEnd(16)} ${String(total).padStart(3)} response(s), ${String(bare.length).padStart(3)} without CORS`);

  if (LOCKED.includes(f)) {
    for (const b of bare) failures.push(`${f}:${b.line} — locked file, response without CORS: ${b.text}`);
  } else if (f in BUDGET) {
    if (bare.length > BUDGET[f]) {
      failures.push(`${f}: ${bare.length} responses without CORS, budget ${BUDGET[f]} — it went UP`);
    }
  } else {
    // A new Durable Object starts locked. Nobody inherits a budget by arriving.
    for (const b of bare) failures.push(`${f}:${b.line} — new Durable Object, response without CORS: ${b.text}`);
  }
}

console.log(`check-do-cors: ${report.length} Durable Object(s) in ${DIR}/`);
report.forEach((r) => console.log(r));
console.log(`  locked: ${LOCKED.join(', ')} | budgeted: ${Object.entries(BUDGET).map(([k, v]) => `${k}=${v}`).join(', ')}`);
for (const m of failures) console.log(`  FAIL ${m}`);
if (!report.length) { console.log('  no Durable Objects found — a finding, not a pass'); process.exit(1); }
process.exit(failures.length ? 1 : 0);
