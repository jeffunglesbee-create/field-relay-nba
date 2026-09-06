// Enumerate every competition BSD serves, and diff against the last reading.
//
// The vendor's August 2026 newsletter claimed "nine new competitions". That is
// not answerable from one reading — a count of leagues today says nothing about
// what changed — so the FIRST run of this establishes a baseline and every run
// after it answers the question by diff. Written down here because a probe
// whose first run cannot answer its own question looks broken otherwise.
//
// Covers every sport surface the schema declares a leagues or tournaments
// route for, not just football. FIELD reads BSD for football and tennis only,
// and the point of a baseline is to see the whole thing, including what is not
// used yet.
//
// Rule 91: coverage is printed with the result. A surface that failed to
// answer is named, and its leagues are absent from the diff rather than
// silently counted as removed — a 500 must never read as "they deleted a
// competition".

import fs from 'node:fs';

const BASE  = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN || '';
const TS    = new Date().toISOString();
const BASELINE = 'outbox/bsd-leagues-baseline.json';
const CALL_BUDGET = Number(process.env.CALL_BUDGET || 60);

// Read from the schema rather than listed from memory: /api/schema/ declares
// every path, and the leagues/tournaments routes are the ones this needs.
// Falls back to nothing rather than to a guess — an unavailable schema is a
// reported gap, not an excuse to invent a route list.
const SURFACES = [
  ['football',    '/api/v2/leagues/'],
  ['basketball',  '/basketball/api/v2/leagues/'],
  ['hockey',      '/hockey/api/v2/leagues/'],
  ['tennis',      '/tennis/api/v2/tournaments/'],
  ['darts',       '/darts/api/v2/tournaments/'],
  ['csgo',        '/csgo/api/v2/tournaments/'],
  ['padel',       '/padel/api/v2/tournaments/'],
  ['horseracing', '/horseracing/api/v2/tracks/'],
];

let calls = 0;
async function get(path) {
  if (!TOKEN) return { blocked: 'no BSD_API_TOKEN' };
  if (calls >= CALL_BUDGET) return { blocked: `call budget ${CALL_BUDGET} exhausted` };
  calls++;
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: r.status, bytes: text.length, json };
  } catch (e) { return { error: String(e.message || e) }; }
}

// A league's identity is its id, not its name. A rename must read as a rename,
// not as one competition removed and another added.
const keyOf = (row) => (row?.id != null ? String(row.id) : null);
const labelOf = (row) => row?.name ?? row?.tournament_name ?? row?.title ?? '(unnamed)';

(async () => {
  console.log(`=== bsd-leagues-baseline  base=${BASE}  utc=${TS} ===\n`);
  if (!TOKEN) console.log('!! BSD_API_TOKEN absent — no reading is possible.\n');

  const current = {};   // surface -> { id: name }
  const failed  = [];

  for (const [surface, firstPath] of SURFACES) {
    let path = `${firstPath}?limit=100`;
    const found = {};
    let pages = 0, reported = null, brokeOn = null;
    for (let p = 0; p < 8 && path; p++) {
      const r = await get(path);
      if (r.blocked) { brokeOn = r.blocked; break; }
      if (r.error)   { brokeOn = r.error; break; }
      if (r.status !== 200) { brokeOn = `HTTP ${r.status}`; break; }
      const rows = Array.isArray(r.json) ? r.json : (r.json?.results ?? []);
      if (!Array.isArray(rows)) { brokeOn = `unexpected shape: ${Object.keys(r.json || {}).join(',')}`; break; }
      pages++;
      if (p === 0) reported = r.json?.count ?? rows.length;
      for (const row of rows) { const k = keyOf(row); if (k) found[k] = labelOf(row); }
      const nx = r.json?.next;
      path = nx ? nx.replace(/^https?:\/\/[^/]+/, '') : null;
    }
    const n = Object.keys(found).length;
    if (brokeOn) {
      failed.push({ surface, reason: brokeOn, partial: n });
      console.log(`  ${surface.padEnd(12)} FAILED after ${n} — ${brokeOn}`);
      // Deliberately NOT written into `current`: a surface that failed must not
      // diff as "every competition removed".
    } else {
      current[surface] = found;
      const short = reported != null && n < reported ? ` (of ${reported} reported)` : '';
      console.log(`  ${surface.padEnd(12)} ${String(n).padStart(4)} competitions, ${pages} page(s)${short}`);
    }
  }

  const totalNow = Object.values(current).reduce((a, m) => a + Object.keys(m).length, 0);

  // ------------------------------------------------------------------ DIFF
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { /* first run */ }

  const diff = { added: {}, removed: {}, renamed: {}, surfacesCompared: [], surfacesSkipped: [] };
  if (prev?.leagues) {
    for (const surface of Object.keys(current)) {
      const before = prev.leagues[surface];
      if (!before) { diff.surfacesSkipped.push(`${surface}: absent from baseline`); continue; }
      diff.surfacesCompared.push(surface);
      const now = current[surface];
      for (const [id, name] of Object.entries(now)) {
        if (!(id in before)) (diff.added[surface] ??= []).push(`${id}: ${name}`);
        else if (before[id] !== name) (diff.renamed[surface] ??= []).push(`${id}: ${before[id]} -> ${name}`);
      }
      for (const [id, name] of Object.entries(before)) {
        if (!(id in now)) (diff.removed[surface] ??= []).push(`${id}: ${name}`);
      }
    }
    // A surface that failed THIS run is not compared at all.
    for (const f of failed) diff.surfacesSkipped.push(`${f.surface}: failed this run (${f.reason})`);
  }

  const out = {
    ts: TS, base: BASE, callsMade: calls, callBudget: CALL_BUDGET,
    surfacesProbed: SURFACES.length,
    surfacesAnswered: Object.keys(current).length,
    surfacesFailed: failed,
    totals: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, Object.keys(v).length])),
    total: totalNow,
    leagues: current,
    baseline: prev ? { ts: prev.ts, total: prev.total } : null,
    diff: prev ? diff : null,
  };

  console.log('\n=== SUMMARY ===');
  console.log(`coverage: ${Object.keys(current).length} of ${SURFACES.length} surfaces answered`
    + `${failed.length ? `; FAILED: ${failed.map((f) => f.surface).join(', ')}` : ''}`);
  console.log(`total competitions: ${totalNow}`);
  if (!prev) {
    console.log('\nBASELINE ESTABLISHED — no prior reading to diff against.');
    console.log('This run cannot answer "what changed"; the next one can. That is the');
    console.log('design, not a failure: a single count says nothing about a delta.');
  } else {
    const n = (o) => Object.values(o).reduce((a, v) => a + v.length, 0);
    console.log(`\nvs baseline ${prev.ts} (total ${prev.total}):`);
    console.log(`  added   ${n(diff.added)}`);
    console.log(`  removed ${n(diff.removed)}`);
    console.log(`  renamed ${n(diff.renamed)}`);
    for (const [s, list] of Object.entries(diff.added))   for (const x of list) console.log(`    + ${s}  ${x}`);
    for (const [s, list] of Object.entries(diff.removed)) for (const x of list) console.log(`    - ${s}  ${x}`);
    for (const [s, list] of Object.entries(diff.renamed)) for (const x of list) console.log(`    ~ ${s}  ${x}`);
    if (diff.surfacesSkipped.length) {
      console.log('  NOT COMPARED (their competitions are absent from the diff, not removed):');
      for (const s of diff.surfacesSkipped) console.log(`    ? ${s}`);
    }
  }

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/bsd-leagues-${stamp}.json`, JSON.stringify(out, null, 2));
  // The baseline only advances on a run that answered something. Otherwise the
  // next run diffs against a blank and reports every competition as new.
  if (Object.keys(current).length) {
    fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2));
    console.log(`\nwrote outbox/bsd-leagues-${stamp}.json and ${BASELINE}`);
  } else {
    console.log(`\nwrote outbox/bsd-leagues-${stamp}.json`);
    console.log(`   NOT advancing ${BASELINE} — no surface answered.`);
  }
  process.exit(0);
})().catch((e) => { console.error('bsd-leagues-baseline failed:', e.stack || e.message); process.exit(1); });
