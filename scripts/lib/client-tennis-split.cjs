// Replay jubilant-bassoon's tennis Draw-tab decision, taken FROM THE CLIENT, against what the relay serves.
//
// WHAT THIS REPLACED. tennis-tier-ladders.mjs used to read two static name lists out of the client
// (_TENNIS_DRAW_NO_BRACKET and the keys of _TENNIS_DRAW_NAMED_RANK) and compare them with how many
// main-draw matches the draw route held for the LATEST season of each named event. That comparison is
// calendar-blind: every named event's main-draw count moves between 0 and n inside a year, so no static
// admit/exclude list is right all year and the check went red on 2026-11-09 (WTA Finals), 11-16 (ATP Finals)
// and 11-23 (Davis Cup), each time for a different event and each time correct about that week. It was also
// wrong about the client: it said an admitted event with no draw "would offer an empty bracket", and the
// client renders one sentence instead. docs/CC-CMD-2026-11-24-tennis-client-split-drift.md has the series.
//
// WHAT THIS DOES INSTEAD. It extracts the client's own decision function from the page text, runs it, and
// checks the DECISION against the relay for a particular day, so there is no list to go stale:
//
//   I1  never offer a Draw tab for an event that has no main-draw match that day
//   I2  whenever a real main-draw event is on the card, offer SOME Draw tab (which event is chosen when several are
//       drawable is not checked: the picker returns one, so no per-event rule could hold for a busy card)
//
// "On the card" is what /bsd/tennis/matches/by-date serves for the day (what the client fetches). "Has a
// main-draw match that day" is the draw route's nodes dated that day, singles only. Those are two routes
// reading one vendor feed through two code paths, so the check can disagree with the client only when
// the client's decision is wrong or the vocabulary on one side moved.
//
// THE VOCABULARY. The client decides per ROW by the row's round_name, so it carries its own list of the seven
// main-draw names, and a day's card only ever exercises the names that happen to be played that day: the pins
// show 'Round of 16', 'Quarterfinals' and a blank name, which leaves four of the seven free to be deleted or
// mistyped from the client with every day still green. So the replay also checks the vocabulary itself, against
// the relay's own draw payload and nothing written here:
//
//   V1  for each round of the complete edition named in VOCABULARY_EDITION (a payload whose rounds run from
//       index 0 to its Final without a gap, so it carries every name the relay's ORDER holds), a card row bearing
//       that round_name must be offered a Draw tab
//   V2  for each key of roundsOutsideMainDraw in ANY draw payload the replay read (qualifying names, and the blank
//       name round-robin and tie rows carry), a card row bearing it must be offered none
//
// No list of names is kept in this file: a fifth copy of the vocabulary would be one more place to drift. If the
// edition stops carrying the whole ladder the check says so as a harness error, it does not run on a shorter list.
//
// WHAT THE REPLAY CANNOT SEE (REPLAY_CANNOT_SEE, printed with every result): it replays the picker over by-date rows
// only. The nav link is decided by _tennisRevealDrawNav over by-date rows merged with the live feed, then tier-
// filtered, and none of that is run; neither is which event wins when several are drawable; and I2's universe is
// the events the client's own tier filter admits, so a tier dropped from that filter is seen only where a pin or a
// payload shows it.
//
// WHAT COUNTS AS THE CLIENT. Two reads, as before.
//   DEPLOYED  the page a reader loads. It decides the verdict.
//   SOURCE    src/legacy/field.js on main. Where it decides differently from DEPLOYED on a day both are
//             replayed over, that is a client change that has not shipped, which is its own finding.
// index.html is not read: its script block is generated from field.js by scripts/sync-source.mjs.
//
// EXTRACTION. A fixed list of ANCHORS (declaration names) is read out of the text, each located by name and
// cut at the first end point that V8 compiles as a complete statement. Brace matching by hand would have
// to understand regex literals, template strings and comments; asking the parser avoids writing that
// scanner. Anchors that exist in only one client version are OPTIONAL
// (_TENNIS_DRAW_NO_BRACKET goes away with the run-time fix, _TENNIS_MAIN_DRAW_ROUNDS and
// _tennisRowInMainDraw arrive with it). A REQUIRED anchor that is missing, ambiguous or incomplete throws,
// and so does a declaration the picker references that was not extracted: the extracted program would
// otherwise run with a hole in it and answer for a client that is not the one on the page.
//
// REFUSAL IS NOT AGREEMENT (Rule 99). Every failure here throws or is recorded as a harness error. An
// unreadable client, a pin that no longer reproduces, a day of the trailing window that could not be read
// (after the caller's one re-read), a vocabulary edition that cannot ground the vocabulary and a run that
// performed zero checks all end with a non-zero exit in the caller. A green that means "I could not
// look" is the one outcome worse than red.
//
// SANDBOX. The text is untrusted data. It runs in node:vm with a bare global (no process, require, fetch or
// timers: nothing from this process is reachable), code generation from strings off (that, and the absence of any
// host object, is what stops this.constructor.constructor("return process")()), a time limit on every call that
// covers promise jobs too (microtaskMode afterEvaluate: without it a job queued by a declaration ran outside the
// limit and hung the host at its next await), and rows passed in and picks passed out as JSON strings so no host
// object crosses over. A declaration that mentions import(), a promise or async code is refused by name before
// anything runs (ASYNC_CONSTRUCT): the replay calls these declarations synchronously and has no use for them, and a
// promise rejected inside the context is an unhandled rejection in THIS process, which kills it with no artifact
// (vm's importModuleDynamically callback does not prevent that on Node 22). A computed spelling of a promise
// constructor evades the text scan and is stopped by the time limit if it loops; one that merely rejects still
// ends the process, loudly, which fails closed. node:vm is not a security boundary and this is not claimed to be
// one: it keeps a malformed or hostile page from reading the filesystem or the network by accident, and the
// self-test asserts those properties, in child processes, rather than assuming them.

'use strict';
const vm = require('node:vm');

const CLIENT_REPO = 'jeffunglesbee-create/jubilant-bassoon';
const CLIENT_SOURCE_PATH = 'src/legacy/field.js';
const CLIENT_DEPLOYED_URL = 'https://jubilant-bassoon.jeffunglesbee.workers.dev/';
const CLIENT_SOURCE_URL =
  `https://raw.githubusercontent.com/${CLIENT_REPO}/main/${CLIENT_SOURCE_PATH}`;

// ── what is read out of the client ───────────────────────────────────────────
// Verified against jubilant-bassoon origin/main 1606d7af (src/legacy/field.js and the esbuild + strip-comments
// output of scripts/build-bundle.mjs) on 2026-11-26. The fixed client adds _TENNIS_MAIN_DRAW_ROUNDS and
// _tennisRowInMainDraw and deletes _TENNIS_DRAW_NO_BRACKET (the interface agreed for the client fix).
const ANCHORS = [
  { name: 'TENNIS_TIERS', kind: 'const', required: true },
  { name: 'TENNIS_NAMED', kind: 'const', required: true },
  { name: '_TENNIS_DRAW_TIER_RANK', kind: 'const', required: true },
  { name: '_TENNIS_DRAW_NAMED_RANK', kind: 'const', required: true },
  { name: '_tennisTierAllowed', kind: 'function', required: true },
  { name: '_tennisDrawPick', kind: 'function', required: true },
  { name: '_TENNIS_DRAW_NO_BRACKET', kind: 'const', required: false },
  { name: '_TENNIS_MAIN_DRAW_ROUNDS', kind: 'const', required: false },
  { name: '_tennisRowInMainDraw', kind: 'function', required: false },
];

// A declaration the picker names that is not in ANCHORS is a hole in the extracted program. The families
// are the client's own naming for module-level tennis declarations; a local variable never matches them.
const TENNIS_DECLARATION = /(?<![.\w$])(?:_?TENNIS_[A-Z0-9_]+|_tennis[A-Z][A-Za-z0-9]*)(?![\w$])/g;

// What an extracted declaration may not contain (comments stripped): a dynamic import(), import.meta, a promise or
// async code. See SANDBOX above for why a refusal and not a guard around them.
const ASYNC_CONSTRUCT = /(?<![\w$.])import\s*[(.]|(?<![\w$.])(?:Promise|async|await)(?![\w$])/;

const MAX_SNIPPET_CHARS = 12000;
const EXEC_TIMEOUT_MS = 2000;
// A relay or client read that threw, or answered 5xx, is made once more after this pause. Never a 4xx.
const RETRY_PAUSE_MS = 2000;

// The same singles filter _tennisDrawPick applies to the rows it ranks and tennis-tier-ladders.mjs applies to
// its census. It bounds which events are read for the replay; it is not a verdict on any of them.
const SINGLES_EXCLUDE = /Doubles|Boys|Girls|Wheelchair|Quad/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compiles(code) {
  try { new vm.Script(code); return true; }
  catch (_e) { return false; }
}

/** Index of the declaration, null when it is absent, a throw when the name is declared twice. */
function findAnchor(text, spec, where) {
  const re = spec.kind === 'function'
    ? new RegExp(`(?<![\\w$.])function\\s+${escapeRe(spec.name)}\\s*\\(`, 'g')
    : new RegExp(`(?<![\\w$.])(?:const|let|var)\\s+${escapeRe(spec.name)}\\s*=`, 'g');
  const hits = [...text.matchAll(re)];
  if (hits.length > 1) {
    throw new Error(`${where}: ${spec.kind} ${spec.name} is declared ${hits.length} times — the loader `
                  + `cannot say which one the page runs`);
  }
  return hits.length ? hits[0].index : null;
}

/** The statement starting at `start`, ended at the first `}` (functions) or `;` (consts) that makes it compile. */
function sliceStatement(text, start, spec, where) {
  const limit = Math.min(text.length, start + MAX_SNIPPET_CHARS);
  const end = spec.kind === 'function' ? '}' : ';';
  let i = text.indexOf(end, start);
  while (i !== -1 && i < limit) {
    const cand = text.slice(start, i + 1);
    if (compiles(cand)) return cand;
    i = text.indexOf(end, i + 1);
  }
  throw new Error(`${where}: ${spec.kind} ${spec.name} has no syntactically complete form within`
                + ` ${MAX_SNIPPET_CHARS} characters of its declaration`);
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

/** A fresh global with nothing in it. No host object is reachable from it and code generation from strings is off,
 *  and `microtaskMode: 'afterEvaluate'` puts the promise jobs a call queues inside that call's time limit. */
function makeSandbox() {
  return vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false },
                                                 microtaskMode: 'afterEvaluate' });
}

function runIn(ctx, code, timeoutMs) {
  return vm.runInContext(code, ctx, { timeout: timeoutMs, filename: 'tennis-client-extract.js' });
}

/** What a sandbox can reach that it should not. Empty for makeSandbox(); the self-test aims it at a leaky one too. */
function sandboxLeaks(ctx) {
  const leaks = [];
  for (const g of ['process', 'require', 'fetch', 'document', 'window', 'globalThis.process', 'Buffer']) {
    const t = runIn(ctx, `typeof ${g}`, EXEC_TIMEOUT_MS);
    if (t !== 'undefined') leaks.push(`${g} is ${t}`);
  }
  let reached;
  try { reached = runIn(ctx, 'typeof this.constructor.constructor("return process")()', EXEC_TIMEOUT_MS); }
  catch (_e) { reached = 'blocked'; }
  if (reached !== 'blocked') leaks.push(`this.constructor.constructor reaches a process: ${reached}`);
  return leaks;
}

// Rows used to prove the extracted functions are the right shape before any day is replayed. They assert
// STRUCTURE (a boolean mask, a null-or-tournament pick, doubles and utr never offered), not that a main-draw row
// must be picked: a client that hides it is a finding for the replay to name as I2, not a reason to refuse to load.
const CONTROL_SLAM = { id: 1, tournament: { id: 910001, name: 'Control Open', category: 'grand_slam' },
                       is_doubles: false, round_name: 'Round of 128', status: 'scheduled' };
const CONTROL_UTR = { id: 2, tournament: { id: 910002, name: 'Control UTR', category: 'utr' },
                      is_doubles: false, round_name: 'Round of 32', status: 'scheduled' };
const CONTROL_DOUBLES = { id: 3, tournament: { id: 910001, name: 'Control Open', category: 'grand_slam' },
                          is_doubles: true, round_name: 'Round of 128', status: 'scheduled' };

/**
 * Extract the tennis decision from page text. Returns { where, anchorsPresent, anchorsAbsent, bytes,
 * allowed(rows) -> boolean[], pick(rows) -> {id,name,category,rank,count} | null }, or throws saying
 * which anchor failed and why. `where` names the text so the message is actionable.
 */
function loadClient(text, where, opts = {}) {
  const timeoutMs = opts.timeoutMs === undefined ? EXEC_TIMEOUT_MS : opts.timeoutMs;
  if (typeof text !== 'string' || !text.length) {
    throw new Error(`${where}: nothing to read (${typeof text}, ${text ? text.length : 0} chars)`);
  }
  const found = [];
  const absent = [];
  for (const spec of ANCHORS) {
    const start = findAnchor(text, spec, where);
    if (start === null) {
      if (spec.required) throw new Error(`${where}: required anchor ${spec.kind} ${spec.name} not found`);
      absent.push(spec.name);
      continue;
    }
    found.push({ name: spec.name, kind: spec.kind, start, snippet: sliceStatement(text, start, spec, where) });
  }

  // Every tennis declaration a snippet names must have been extracted too.
  const have = new Set(found.map((f) => f.name));
  for (const f of found) {
    const refs = [...stripComments(f.snippet).matchAll(TENNIS_DECLARATION)].map((m) => m[0]);
    const missing = [...new Set(refs)].filter((r) => !have.has(r));
    if (missing.length) {
      throw new Error(`${where}: ${f.name} references ${JSON.stringify(missing)}, which is not an extracted`
                    + ` anchor — the loader reads a fixed list; add the declaration to ANCHORS or the client`
                    + ` has moved the decision somewhere this cannot follow`);
    }
  }

  for (const f of found) {
    const hit = ASYNC_CONSTRUCT.exec(stripComments(f.snippet));
    if (hit) {
      throw new Error(`${where}: ${f.name} mentions ${JSON.stringify(hit[0])} — the replay calls the extracted declarations`
                    + ` synchronously and its sandbox does not run promise code (a promise rejected inside it would end`
                    + ` this process), so a page that moves the decision into one is refused, not run`);
    }
  }

  // Original order: a const initializer that reads another const must still see it.
  found.sort((a, b) => a.start - b.start);
  const ctx = makeSandbox();
  try { runIn(ctx, found.map((f) => f.snippet).join('\n'), timeoutMs); }
  catch (e) { throw new Error(`${where}: the extracted declarations did not evaluate: ${e.message}`); }
  for (const f of found.filter((x) => x.kind === 'function')) {
    const t = runIn(ctx, `typeof ${f.name}`, timeoutMs);
    if (t !== 'function') throw new Error(`${where}: ${f.name} evaluated to ${t}, not a function`);
  }

  const call = (label, expr, input) => {
    ctx.__in = JSON.stringify(input);
    try { return runIn(ctx, expr, timeoutMs); }
    catch (e) { throw new Error(`${where}: ${label} threw on the replayed rows: ${e.message}`); }
  };
  const client = {
    where, bytes: text.length,
    anchorsPresent: found.map((f) => f.name),
    anchorsAbsent: absent,
    allowed(rows) {
      const out = call('_tennisTierAllowed', 'JSON.stringify(JSON.parse(__in).map((r) => _tennisTierAllowed(r)))', rows);
      const mask = typeof out === 'string' ? JSON.parse(out) : null;
      if (!Array.isArray(mask) || mask.length !== rows.length || !mask.every((b) => typeof b === 'boolean')) {
        throw new Error(`${where}: _tennisTierAllowed did not return a boolean for every row (${out})`);
      }
      return mask;
    },
    pick(rows) {
      const out = call('_tennisDrawPick', 'JSON.stringify(_tennisDrawPick(JSON.parse(__in)))', rows);
      if (typeof out !== 'string') throw new Error(`${where}: _tennisDrawPick returned ${typeof out}, not null or a tournament`);
      const p = JSON.parse(out);
      if (p !== null && (typeof p !== 'object' || p.id === undefined || p.id === null)) {
        throw new Error(`${where}: _tennisDrawPick returned ${out}, which is neither null nor a tournament`);
      }
      return p;
    },
  };

  const mask = client.allowed([CONTROL_SLAM, CONTROL_UTR, CONTROL_DOUBLES]);
  if (JSON.stringify(mask) !== '[true,false,true]') {
    throw new Error(`${where}: control failed — _tennisTierAllowed gave ${JSON.stringify(mask)} for`
                  + ` [slam, utr, slam doubles], expected [true,false,true]`);
  }
  if (client.pick([CONTROL_UTR]) !== null) throw new Error(`${where}: control failed — a utr row was offered a Draw tab`);
  const withDoubles = client.pick([CONTROL_SLAM, CONTROL_DOUBLES]);
  if (withDoubles !== null && withDoubles.count !== 1) {
    throw new Error(`${where}: control failed — a doubles row was counted as a singles match (${JSON.stringify(withDoubles)})`);
  }
  return client;
}

/** What goes in the artifact for a loaded (or refused) client. */
function describeClient(c) {
  return c ? { where: c.where, bytes: c.bytes, anchorsPresent: c.anchorsPresent, anchorsAbsent: c.anchorsAbsent } : null;
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One more read of the SAME thing when `read` threw or answered 5xx, after `pauseMs`. A 4xx is the answer and is
 *  returned as it came: retrying one would only spend a rate limit or repeat a refusal. Bounded: the second read's
 *  answer (or its throw) stands, and there is no third. This is a retry of one read, never a fall back to another
 *  source. `read` returns something with a numeric `status` (a Response, or the { status } the detector's get() builds). */
async function readOnceMore(read, { sleep = sleepMs, pauseMs = RETRY_PAUSE_MS } = {}) {
  const transient = (r) => typeof r?.status === 'number' && r.status >= 500;
  let first;
  try { first = await read(); } catch (e) { first = e; }
  if (!(first instanceof Error) && !transient(first)) return first;
  await sleep(pauseMs);
  return read();
}

/** Both readings of the client, each loaded or refused with a reason. There is deliberately NO fall back from
 *  one to the other. `fetchImpl` exists so the refusal paths can be exercised without a network; `opts.sleep` and
 *  `opts.pauseMs` do the same for the one re-read of a transient failure (see readOnceMore).
 *
 *  Unauthenticated: jubilant-bassoon is public (verified 2026-10-07 by `gh api repos/jeffunglesbee-create/
 *  jubilant-bassoon` -> "visibility": "public"), so no secret is added for this. If it is ever made private
 *  the source read fails loudly here instead of quietly parsing an error page — an error page contains no
 *  anchor, so loadClient throws. */
async function readClient(fetchImpl = fetch, opts = {}) {
  const reading = { deployed: null, source: null, refusals: [] };
  const targets = {
    deployed: { url: CLIENT_DEPLOYED_URL, where: `DEPLOYED ${CLIENT_DEPLOYED_URL}` },
    source: { url: CLIENT_SOURCE_URL, where: `SOURCE ${CLIENT_REPO}:${CLIENT_SOURCE_PATH}@main` },
  };
  for (const [key, { url, where }] of Object.entries(targets)) {
    let text = null;
    try {
      const r = await readOnceMore(async () => {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(60000),
                                           headers: { 'User-Agent': 'field-relay-tennis-tier-ladders' } });
        return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
      }, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = r.text;
    } catch (e) {
      reading.refusals.push(`${where}: could not read — ${e.message}`);
      continue;
    }
    try { reading[key] = loadClient(text, where); }
    catch (e) { reading.refusals.push(e.message); }
  }
  return reading;
}

// ── the replay ───────────────────────────────────────────────────────────────
// PINNED DAYS. Four classes, each carrying what it is expected to show and what that expectation rests on.
// A pin that no longer reproduces is a harness-integrity error, never a skipped day: the trailing window ages
// out within a week, so the pins are the only protection that lasts (and they are why "0 checks" cannot
// happen while the relay still serves these dates).
//
// BASIS (Rule 73). The draw-route side of each pin was read through probe_relay_route on 2026-11-26. The CARD side
// (that the day's rows carry the event with these round names) was NOT readable from that session — the probe
// shows the first ~12 KB of a card and the events sit later in the UTC day — so the first dispatch on a runner is
// what confirms it, and a pin that does not reproduce fails there by name.
const PINNED_DAYS = [
  { id: 'named-main-draw', date: '2026-11-25', tid: 446, name: 'Davis Cup', drawn: true,
    basis: 'draw 446/2026 read 2026-11-26: Quarterfinals nodes dated 2026-11-24, 11-25 (Italy v Korea), 11-26 x2;'
         + ' semifinal 11-27. Card rows on 11-25 with round_name Quarterfinals: unread, runner confirms.' },
  { id: 'named-round-robin', date: '2026-11-16', tid: 209, name: 'ATP Finals', drawn: false,
    basis: 'draw 209/2026 read 2026-11-26: nodes dated 2026-11-21 x2 and 11-22 only, so no main-draw node on 11-16.'
         + ' Round-robin rows on the 11-16 card with a blank round_name: inferred from roundsOutsideMainDraw {"":12}, runner confirms.' },
  { id: 'tier-draw', date: '2026-09-07', tid: 135, name: 'US Open, Men', drawn: true,
    basis: 'draw 135/2026 read 2026-11-26: Round of 16 nodes dated 2026-09-07 (18:05, 20:40, 21:45Z). The 2026-09-07 card'
         + ' read the same day shows US Open, Women (136) Round of 16 at 01:30Z; the men\'s rows are later in the day, runner confirms.' },
  { id: 'empty-day', date: '2025-12-22', tid: null, name: null, drawn: null, candidates: 0,
    basis: 'card read in full 2026-11-26: 16 rows, count=declaredCount=16, truncated=false, every row category utr (UTR PTT Saitama).' },
];
const TRAILING_DAYS = 7;
// The trailing window is only evidence when most of it was read. An unread trailing day is counted and named (the
// coverage line and the detector's output list it); a window with fewer days read than this is BLIND and the run fails
// for it. One vendor fault on one date must not hold a scheduled run red for the seven days that date stays in the
// window, and a run that read almost nothing must not be green: this number is the line between the two.
const TRAILING_MIN_READ = 5;

// THE EDITION THE ROUND VOCABULARY IS READ FROM. A complete 128-draw slam: its payload's `rounds` run from index 0
// (Round of 128) to the Final with no gap, so it carries every name the relay's ORDER holds. Nothing here lists
// those names; they come out of the payload, and a payload that is not a whole ladder is a harness error. The names
// OUTSIDE the main draw are not read from this edition alone: every draw payload the replay reads carries
// roundsOutsideMainDraw, and the blank name only the round-robin and tie events carry arrives from their payloads.
// BASIS (Rule 73). draw 135/2026 read 2026-11-26 through probe_relay_route: complete true; rounds Round of 128 ..
// Final at indices 0..6; tournament {id 135, name "US Open, Men", category grand_slam}; roundsOutsideMainDraw
// {Qualification Round 1: 66, Qualification Round 2: 32, Qualification Final: 16}. In the same session 209/2026
// carried {"": 12} and 446/2026 {"": 339, Qualification Final: 7, Qualification Round 1: 13}.
const VOCABULARY_EDITION = { tid: 135, season: '2026', name: 'US Open, Men' };

// Printed with every result (Rule 91): what a green here does not cover.
const REPLAY_CANNOT_SEE = 'by-date rows only, so the nav link, _tennisRevealDrawNav and the live feed are not replayed; which event'
  + ' is chosen when several are drawable is not checked; events the client\'s own tier filter drops are seen only where a pin or a payload shows them';

const dayBefore = (isoDate, k) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - k * 86400000).toISOString().slice(0, 10);

async function safeGet(relayGet, path) {
  try { return await relayGet(path); }
  catch (e) { return { status: 0, why: e.message }; }
}

/** Candidates: tournaments with an allowed singles row on the card, as the client's own predicate decides. */
function candidatesOf(client, rows) {
  const mask = client.allowed(rows);
  const cands = new Map();
  rows.forEach((row, i) => {
    const t = row?.tournament;
    if (!mask[i] || !t?.id || row.is_doubles) return;
    if (SINGLES_EXCLUDE.test(typeof t.name === 'string' ? t.name : '')) return;
    if (!cands.has(t.id)) cands.set(t.id, { id: t.id, name: t.name, category: t.category, rows: 0 });
    cands.get(t.id).rows++;
  });
  return cands;
}

/**
 * Replay the client over a corpus of days. `relayGet(path)` returns { status, json } and may throw.
 * `deployed` is required (it decides); `source` is replayed over the same cards for agreement only.
 */
async function runReplay({ relayGet, deployed, source = null, today, pins = PINNED_DAYS, trailing = TRAILING_DAYS,
                          vocabulary = VOCABULARY_EDITION }) {
  if (!deployed) throw new Error('runReplay: no deployed client — a client that was refused cannot be replayed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`runReplay: today must be YYYY-MM-DD, got ${today}`);

  const days = new Map();
  for (const p of pins) days.set(p.date, { date: p.date, pin: p, window: 'pinned' });
  const window = [];
  for (let k = 0; k < trailing; k++) {
    const d = dayBefore(today, k);
    window.push(d);
    if (!days.has(d)) days.set(d, { date: d, pin: null, window: 'trailing' });
  }

  const report = { window: { from: window[window.length - 1], to: window[0], trailing }, pins: [], days: [],
                   violations: [], harness: [], unreadDays: [], truthUnread: [], sourceDiffs: [] };
  const truth = new Map();   // "tid:season" -> { state, daysDrawn:Set, why }
  const truthOf = async (tid, season) => {
    const key = `${tid}:${season}`;
    if (truth.has(key)) return truth.get(key);
    const r = await safeGet(relayGet, `/bsd/tennis/draw?tournament=${tid}&season=${season}`);
    let t;
    if (r.status === 200 && r.json && Array.isArray(r.json.nodes)) {
      const out = r.json.roundsOutsideMainDraw;
      const statusOf = new Map();
      for (const n of r.json.nodes) if (!statusOf.has(n.round)) statusOf.set(n.round, n.status);
      t = { state: 'read', truncated: r.json.truncated === true, complete: r.json.complete === true,
            rounds: Array.isArray(r.json.rounds) ? r.json.rounds.map((x) => ({ round: x.round, index: x.index })) : null,
            outside: out && typeof out === 'object' ? Object.keys(out) : null,
            tournament: r.json.tournament && typeof r.json.tournament === 'object' ? r.json.tournament : null,
            statusOf,
            daysDrawn: new Set(r.json.nodes.filter((n) => !n.isDoubles && typeof n.date === 'string')
                                           .map((n) => n.date.slice(0, 10))) };
    } else if (r.status === 404 && r.json && r.json.error === 'no matches for that tournament and season') {
      t = { state: 'absent-edition', truncated: false, daysDrawn: new Set() };
    } else {
      t = { state: 'unread', why: r.status ? `HTTP ${r.status}` : r.why };
      report.truthUnread.push({ tid, season, why: t.why });
    }
    truth.set(key, t);
    return t;
  };
  // 'drawn' | 'undrawn' | 'unread' for one tournament on one day.
  const stateOn = (t, date) => {
    if (t.state === 'unread') return 'unread';
    if (t.daysDrawn.has(date)) return 'drawn';
    return t.truncated ? 'unread' : 'undrawn';
  };

  let i1Checks = 0, i2Checks = 0, daysWithCandidates = 0, daysWithDrawable = 0, rowsOffDay = 0;
  let i1Skipped = 0, i2Skipped = 0, truncatedCards = 0;
  for (const day of [...days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const card = await safeGet(relayGet, `/bsd/tennis/matches/by-date?date=${day.date}`);
    const rows = card.status === 200 && card.json && Array.isArray(card.json.results) ? card.json.results : null;
    if (rows === null) {
      const why = card.status ? `HTTP ${card.status}` : card.why;
      report.unreadDays.push({ date: day.date, why });
      // A PINNED day that cannot be read is a harness error naming the pin: the pin is the control and a control nobody
      // can read proves nothing. An unread TRAILING day is counted, printed and named in the coverage line, and the
      // run is red only when fewer than TRAILING_MIN_READ of the window were read (blind): a vendor fault on one date
      // must not hold a scheduled run red for the seven days that date stays in the window.
      if (day.pin) report.harness.push(`pin ${day.pin.id} (${day.date}): the card could not be read — ${why}`);
      continue;
    }
    if (card.json.truncated === true) truncatedCards++;
    const season = day.date.slice(0, 4);
    const off = rows.filter((r) => typeof r?.match_date !== 'string' || r.match_date.slice(0, 10) !== day.date).length;
    rowsOffDay += off;
    const cands = candidatesOf(deployed, rows);
    const pick = deployed.pick(rows);
    const states = new Map();
    for (const c of cands.values()) states.set(c.id, stateOn(await truthOf(c.id, season), day.date));
    if (pick && !states.has(pick.id)) states.set(pick.id, stateOn(await truthOf(pick.id, season), day.date));
    const drawable = [...cands.keys()].filter((id) => states.get(id) === 'drawn');
    const unreadIds = [...cands.keys()].filter((id) => states.get(id) === 'unread');

    const rec = { date: day.date, window: day.window, pin: day.pin ? day.pin.id : null, rows: rows.length,
                  truncated: card.json.truncated === true, rowsOffDay: off,
                  candidates: [...cands.values()].map((c) => `${c.id} ${c.name} (${c.category}) x${c.rows}`),
                  pick: pick ? `${pick.id} ${pick.name}` : null, drawable, unread: unreadIds, i1: 'n/a', i2: 'n/a' };
    const flag = (invariant, tid, name, text) => {
      report.violations.push({ invariant, date: day.date, window: day.window, pin: rec.pin, tid, name, text });
    };

    if (cands.size) daysWithCandidates++;
    if (drawable.length) daysWithDrawable++;

    // I1: a tab that is offered must have a main-draw match behind it that day.
    if (pick) {
      const s = states.get(pick.id);
      if (s === 'unread') { rec.i1 = 'skipped (truth unread)'; i1Skipped++; }
      else {
        i1Checks++;
        if (s === 'drawn') rec.i1 = 'ok';
        else {
          rec.i1 = 'VIOLATION';
          flag('I1', pick.id, pick.name, `I1 ${day.date} ${pick.name} (${pick.id}): the client offers a Draw tab for it, but the`
            + ` draw route has no main-draw match for it that day — the tab opens on a message, not a bracket`);
        }
      }
    }
    // I2: a real main-draw event on the card must yield an offer.
    if (drawable.length) {
      i2Checks++;
      if (pick) rec.i2 = 'ok';
      else {
        rec.i2 = 'VIOLATION';
        for (const id of drawable) {
          const hidden = cands.get(id);
          flag('I2', hidden.id, hidden.name, `I2 ${day.date} ${hidden.name} (${hidden.id}): the draw route has a main-draw match`
            + ` for it that day and it is on the card, but the client offers no Draw tab — a real draw nobody can reach`);
        }
      }
    } else if (pick === null && unreadIds.length) { rec.i2 = 'skipped (truth unread)'; i2Skipped++; }

    if (source) {
      const sp = source.pick(rows);
      const a = pick ? pick.id : null, b = sp ? sp.id : null;
      if (a !== b) report.sourceDiffs.push({ date: day.date, deployed: a, source: b });
    }

    // The pin must reproduce what it was chosen to show, or the harness is blind and says so.
    if (day.pin) {
      const p = day.pin;
      const problems = [];
      if (p.tid !== null) {
        if (!cands.has(p.tid)) problems.push(`${p.name} (${p.tid}) is not among the allowed singles events on the card`);
        else if (p.drawn !== undefined) {
          const s = states.get(p.tid);
          const want = p.drawn ? 'drawn' : 'undrawn';
          if (s !== want) problems.push(`${p.name} (${p.tid}) reads ${s} on the draw route, the pin expects ${want}`);
        }
      }
      if (p.candidates !== undefined && cands.size !== p.candidates) {
        problems.push(`expected ${p.candidates} allowed singles events on the card, read ${cands.size}`);
      }
      report.pins.push({ id: p.id, date: p.date, tid: p.tid, name: p.name, expectDrawn: p.drawn, basis: p.basis,
                         reproduced: problems.length === 0, problems });
      problems.forEach((x) => report.harness.push(`pin ${p.id} (${p.date}) does not reproduce: ${x}`));
    }
    report.days.push(rec);
  }

  if (i1Checks + i2Checks === 0) {
    report.harness.push('zero checks ran: no day produced an I1 or an I2 check, so nothing was tested — this is not a "no drift"');
  }

  // The trailing window: how much of it was read at all.
  const unreadDates = new Set(report.unreadDays.map((u) => u.date));
  const trailingRead = window.filter((d) => !unreadDates.has(d)).length;
  if (trailingRead < TRAILING_MIN_READ) {
    const names = report.unreadDays.filter((u) => window.includes(u.date)).map((u) => `${u.date} (${u.why})`).join(', ');
    report.harness.push(`trailing window blind: read ${trailingRead} of ${trailing} days (${report.window.from}..${report.window.to}),`
                      + ` at least ${TRAILING_MIN_READ} are needed for a verdict; unread: ${names}`);
  }

  // The round vocabulary, read out of the relay's own payloads (see VOCABULARY_EDITION).
  const vocab = { edition: { tid: vocabulary.tid, season: vocabulary.season, name: vocabulary.name },
                  main: [], outside: [], mainChecks: 0, outsideChecks: 0 };
  report.vocabulary = vocab;
  const vlabel = `vocabulary edition ${vocabulary.tid}/${vocabulary.season}`;
  const vt = await truthOf(vocabulary.tid, vocabulary.season);
  const flagV = (invariant, round, tour, text) => {
    report.violations.push({ invariant, date: null, window: 'vocabulary', pin: null, tid: tour.id, name: tour.name, round, text });
  };
  if (vt.state !== 'read') {
    report.harness.push(`${vlabel} could not be read (${vt.why}) — the round vocabulary is not grounded this run`);
  } else if (vt.truncated) {
    report.harness.push(`${vlabel} could not be read in full (the route truncated it) — the round vocabulary is not grounded this run`);
  } else if (!(vt.complete === true && Array.isArray(vt.rounds) && vt.rounds.length > 0 && vt.rounds.every((x, i) => x.index === i))) {
    report.harness.push(`${vlabel} is not a complete draw carrying the whole ladder (complete=${vt.complete}, round indices`
                      + ` ${JSON.stringify(Array.isArray(vt.rounds) ? vt.rounds.map((x) => x.index) : null)}) — it cannot ground the round vocabulary`);
  } else if (vt.tournament === null || vt.tournament.id === undefined || vt.tournament.id === null) {
    report.harness.push(`${vlabel} carries no tournament to build a card row from`);
  } else {
    const tour = vt.tournament;
    const rowFor = (round, status) => ({ id: 1, tournament: tour, is_doubles: false, round_name: round, status });
    for (const { round } of vt.rounds) {
      vocab.main.push(round);
      if (!vt.statusOf.has(round)) { report.harness.push(`${vlabel}: round ${JSON.stringify(round)} has no node to take a status from`); continue; }
      const pick = deployed.pick([rowFor(round, vt.statusOf.get(round))]);
      vocab.mainChecks++;
      if (!pick || pick.id !== tour.id) {
        flagV('V1', round, tour, `V1 vocabulary ${round}: the relay serves ${JSON.stringify(round)} as a main-draw round (the complete ${vocabulary.season}`
          + ` ${tour.name} edition), and the client offers no Draw tab for a row carrying it — a real draw nobody can reach`);
      }
    }
    const outside = new Set();
    for (const t of truth.values()) {
      if (t.state === 'read' && t.outside) for (const k of t.outside) outside.add(k);
    }
    vocab.outside = [...outside].sort();
    for (const name of vocab.outside) {
      // The relay files a null round_name under '(absent)'.
      const pick = deployed.pick([rowFor(name === '(absent)' ? null : name, 'finished')]);
      vocab.outsideChecks++;
      if (pick !== null) {
        flagV('V2', name, tour, `V2 vocabulary ${name === '' ? '(blank)' : name}: the relay serves ${JSON.stringify(name)} OUTSIDE the main draw`
          + ` (roundsOutsideMainDraw), and the client offers a Draw tab for a row carrying it — a tab that opens on a message, not a bracket`);
      }
    }
    if (vocab.outsideChecks === 0) {
      report.harness.push('no round outside the main draw appears in any draw payload read — a card row that is not a main-draw round'
                        + ' (qualifying, round-robin) cannot be checked this run');
    }
  }

  let sourceAgrees = null;
  if (source && report.days.length) sourceAgrees = report.sourceDiffs.length === 0;
  report.sourceAgreesWithDeployed = sourceAgrees;
  const pinsOk = report.pins.filter((p) => p.reproduced).length;
  report.coverage = { daysExamined: report.days.length, daysRequested: days.size, daysWithCandidates, daysWithDrawable,
                      i1Checks, i2Checks, i1Skipped, i2Skipped, pinsReproduced: pinsOk, pinsTotal: pins.length,
                      trailingRead, trailingTotal: trailing, vocabMainChecks: vocab.mainChecks, vocabOutsideChecks: vocab.outsideChecks,
                      unreadDays: report.unreadDays.length, truthUnread: report.truthUnread.length, truncatedCards, rowsOffDay,
                      cannotSee: REPLAY_CANNOT_SEE };
  report.coverageLine = `checked ${report.days.length} days, ${daysWithDrawable} with a drawable event, ${i1Checks} I1 checks,`
    + ` ${i2Checks} I2 checks; ${daysWithCandidates} had a candidate; pins reproduced ${pinsOk} of ${pins.length};`
    + ` trailing window: ${trailingRead} of ${trailing} read;`
    + ` vocabulary: ${vocab.mainChecks} main-draw name(s) offered, ${vocab.outsideChecks} outside name(s) refused;`
    + ` ${report.unreadDays.length} day(s) and ${report.truthUnread.length} draw read(s) unread; ${truncatedCards} card(s) truncated;`
    + ` skipped checks: I1 ${i1Skipped}, I2 ${i2Skipped}. NOT SEEN: ${REPLAY_CANNOT_SEE}`;
  return report;
}

module.exports = { loadClient, readClient, readOnceMore, describeClient, runReplay, candidatesOf, makeSandbox, sandboxLeaks,
                   ANCHORS, PINNED_DAYS, TRAILING_DAYS, TRAILING_MIN_READ, VOCABULARY_EDITION, REPLAY_CANNOT_SEE,
                   RETRY_PAUSE_MS, SINGLES_EXCLUDE, dayBefore,
                   CLIENT_REPO, CLIENT_SOURCE_PATH, CLIENT_DEPLOYED_URL, CLIENT_SOURCE_URL };
