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

// Classifying fields, DISCOVERED rather than assumed.
//
// The first version of this census stored id -> name and nothing else, so a
// question as basic as "how much of the tennis surface is majors versus UTR"
// had to be answered by pattern-matching 636 tournament NAMES. That produced a
// usable answer and an inferred one: 291 of them fell into an "everything else,
// probably ATP/WTA tour stops" bucket that no field in the artifact supported.
//
// `category` and `circuit` are known to exist on the tournament object nested
// inside a tennis EVENT (`grand_slam`, `challenger`, `utr`; ATP). Whether a row
// from /tennis/api/v2/tournaments/ carries the same names is a cross-boundary
// fact this session has NOT verified, and the other seven surfaces are entirely
// unknown — a hockey league has no circuit.
//
// So this takes whichever candidates are present and records WHICH it found, in
// the artifact, per surface. A field that turns out not to exist shows up as an
// empty fieldsSeen list rather than as silence, and adding a candidate later
// costs one line instead of a guess.
const CLASSIFIERS = ['category', 'circuit', 'type', 'tier', 'level', 'gender', 'surface', 'country'];

const classifiersOf = (row) => {
  const out = {};
  for (const k of CLASSIFIERS) {
    const v = row?.[k];
    if (v != null && v !== '' && typeof v !== 'object') out[k] = String(v);
  }
  return out;
};

// A stored entry is now an object. The previous baseline stored a bare string,
// and the diff below must read both — see the note on `nameOf`.
const entryOf = (row) => ({ name: labelOf(row), ...classifiersOf(row) });

// THE MIGRATION HAZARD, handled rather than discovered later. The committed
// baseline holds `{id: "Premier League"}`; this run produces
// `{id: {name: "Premier League", ...}}`. A diff comparing `before[id] !== name`
// across that boundary reports every one of 1531 competitions as renamed, and a
// reader would see a vendor catastrophe where there was a schema change on our
// side. Both shapes are read through here.
const nameOf = (entry) => (typeof entry === 'string' ? entry : entry?.name ?? '(unnamed)');
const classOf = (entry) => {
  if (typeof entry === 'string') return null;   // pre-classifier baseline: unknown, not empty
  const { name, ...rest } = entry || {};
  return Object.keys(rest).length ? rest : {};
};

(async () => {
  console.log(`=== bsd-leagues-baseline  base=${BASE}  utc=${TS} ===\n`);
  if (!TOKEN) console.log('!! BSD_API_TOKEN absent — no reading is possible.\n');

  const current = {};      // surface -> { id: {name, ...classifiers} }
  const fieldsSeen = {};   // surface -> which classifier fields the rows carried
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
      for (const row of rows) { const k = keyOf(row); if (k) found[k] = entryOf(row); }
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
      // Rule 91: which classifiers this surface actually carried, printed where
      // the count is read. An empty list is a finding, not a blank.
      const seen = [...new Set(Object.values(found).flatMap((e) => Object.keys(classOf(e) || {})))].sort();
      fieldsSeen[surface] = seen;
      const short = reported != null && n < reported ? ` (of ${reported} reported)` : '';
      console.log(`  ${surface.padEnd(12)} ${String(n).padStart(4)} competitions, ${pages} page(s)${short}`
        + `  classifiers: ${seen.length ? seen.join('/') : 'NONE'}`);
    }
  }

  const totalNow = Object.values(current).reduce((a, m) => a + Object.keys(m).length, 0);

  // ------------------------------------------------------------------ DIFF
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { /* first run */ }

  const diff = { added: {}, removed: {}, renamed: {}, recategorised: {},
                 surfacesCompared: [], surfacesSkipped: [], baselinePredatesClassifiers: [] };
  if (prev?.leagues) {
    for (const surface of Object.keys(current)) {
      const before = prev.leagues[surface];
      if (!before) { diff.surfacesSkipped.push(`${surface}: absent from baseline`); continue; }
      diff.surfacesCompared.push(surface);
      const now = current[surface];
      // If the baseline predates classifiers, its entries are bare strings.
      // Comparing names still works through nameOf; comparing CLASSIFIERS does
      // not, and must be skipped rather than reported as 636 recategorisations.
      const oldShape = Object.values(before).some((e) => typeof e === 'string');
      if (oldShape) diff.baselinePredatesClassifiers.push(surface);

      for (const [id, entry] of Object.entries(now)) {
        if (!(id in before)) {
          const c = classOf(entry);
          const tag = c && Object.keys(c).length ? ` [${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ')}]` : '';
          (diff.added[surface] ??= []).push(`${id}: ${nameOf(entry)}${tag}`);
          continue;
        }
        const wasName = nameOf(before[id]);
        const nowName = nameOf(entry);
        if (wasName !== nowName) (diff.renamed[surface] ??= []).push(`${id}: ${wasName} -> ${nowName}`);
        if (oldShape) continue;   // nothing to compare classifiers against
        const wasC = classOf(before[id]) || {};
        const nowC = classOf(entry) || {};
        for (const k of new Set([...Object.keys(wasC), ...Object.keys(nowC)])) {
          if (wasC[k] !== nowC[k]) {
            (diff.recategorised[surface] ??= [])
              .push(`${id} ${nowName}: ${k} ${wasC[k] ?? '(absent)'} -> ${nowC[k] ?? '(absent)'}`);
          }
        }
      }
      for (const [id, entry] of Object.entries(before)) {
        if (!(id in now)) (diff.removed[surface] ??= []).push(`${id}: ${nameOf(entry)}`);
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
    classifierFieldsSeen: fieldsSeen,
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
    console.log(`  added         ${n(diff.added)}`);
    console.log(`  removed       ${n(diff.removed)}`);
    console.log(`  renamed       ${n(diff.renamed)}`);
    console.log(`  recategorised ${n(diff.recategorised)}`);
    if (diff.baselinePredatesClassifiers.length) {
      console.log(`  classifiers NOT compared on ${diff.baselinePredatesClassifiers.length} surface(s)`
        + ` — the stored baseline predates them: ${diff.baselinePredatesClassifiers.join(', ')}.`
        + ` This run establishes them; the next can diff them.`);
    }
    for (const [s, list] of Object.entries(diff.added))   for (const x of list) console.log(`    + ${s}  ${x}`);
    for (const [s, list] of Object.entries(diff.removed)) for (const x of list) console.log(`    - ${s}  ${x}`);
    for (const [s, list] of Object.entries(diff.renamed)) for (const x of list) console.log(`    ~ ${s}  ${x}`);
    for (const [s, list] of Object.entries(diff.recategorised)) for (const x of list) console.log(`    # ${s}  ${x}`);
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
