#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-next-goal-census.mjs and scripts/check-bsd-next-goal-census-run.mjs.
//
// HALF 1 breaks a temp copy of the REAL scripts/bsd-next-goal-census.mjs the ways a count, a reason or the spend of a run can be
// wrong. A mutant is CAUGHT when the analysis check goes red on it or, failing that, the run check (the whole census against a
// stub vendor and a stub relay) does. HALF 2 breaks the checks themselves: mutations that must leave a check BLIND on a broken
// census (so its red depends on that line), and mutations that tighten a gate and must turn it red on the real census.
//
// The same discipline as scripts/mutate-bsd-next-goal-probe.mjs, whose first version was marked by its author and then beaten by
// an independent reviewer's 169 mutations: each anchor occurs exactly once and the replacement differs; a mutant that does not
// parse is NOT APPLIED (a SyntaxError would otherwise count as caught for the wrong reason); CAUGHT needs exit 1 and a FAIL line
// in the check's own output; the baseline runs first; the real files are hashed before and after and must not move.
//
// The census imports the probe by a relative path; a mutant copy lives in a temp directory, so that specifier is made absolute.
//
// Usage: node scripts/mutate-bsd-next-goal-census.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SRC = 'scripts/bsd-next-goal-census.mjs';
const CHECK = 'scripts/check-bsd-next-goal-census.mjs';
const RUN_CHECK = 'scripts/check-bsd-next-goal-census-run.mjs';
const FIX = 'scripts/fixtures/bsd-next-goal-census-synthetic.mjs';
const REAL = [SRC, CHECK, RUN_CHECK, FIX];
const PROBE_URL = JSON.stringify(pathToFileURL(path.resolve('scripts/bsd-next-goal-probe.mjs')).href);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = Object.fromEntries(REAL.map((f) => [f, sha(f)]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-ngc-'));
const strays = () => (fs.existsSync('outbox') ? fs.readdirSync('outbox').filter((f) => /^bsd-next-goal-census-/.test(f)) : []);
const strayBefore = new Set(strays());
const absolute = (text) => text.replace("'./bsd-next-goal-probe.mjs'", PROBE_URL);

// [name, anchor, replacement] or [name, [[anchor, replacement], ...]]
const SOURCE_MUTATIONS = [
  // ---- the key layout and the listing
  ['an id may be any text', '\\/(\\d+)\\/', '\\/([^/]+)\\/'],
  ['the slug may contain a slash', '^bsd\\/([^/]+)\\/', '^bsd\\/(.+)\\/'],
  ['a key with no file name is accepted', '\\/([^/]+)$/;', '\\/([^/]*)$/;'],
  ['the page cap is never reached', 'if (pages >= maxPages) return', 'if (false) return'],
  ['the cursor is not sent', "${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}", "''"],
  ['the page size is 10', '&limit=1000', '&limit=10'],
  ['the prefix is not sent', "const q = `prefix=${encodeURIComponent(prefix)}&limit=1000", "const q = `x=1&limit=1000"],
  ['a failed page counts as complete', 'return { keys, pages, complete: false, why: `list page ${pages} answered', 'return { keys, pages, complete: true, why: `list page ${pages} answered'],
  ['a page from another prefix is accepted', 'if (r.json.prefix !== prefix) return', 'if (false) return'],
  ['a truncated page with no cursor goes on', 'if (!r.json.cursor) return', 'if (false) return'],
  ['the truncated flag is ignored', 'if (!r.json.truncated) return { keys, pages, complete: true, why: null };', 'if (true) return { keys, pages, complete: true, why: null };'],
  ['the keys of a page are dropped', 'for (const k of r.json.keys) keys.push(k);', ''],
  ['a 200 without keys is a page', '!Array.isArray(r.json.keys)', 'false'],
  ['a non-200 listing is a page', "if (!r || r.status !== 200 || !isObj(r.json) || !Array.isArray(r.json.keys))", "if (!r || !isObj(r.json) || !Array.isArray(r.json.keys))"],
  // ---- one capture
  ['FT is not full time', '/^(ft|aet|ap|pen)/i', '/^(aet|ap|pen)/i'],
  ['AET is not full time', '/^(ft|aet|ap|pen)/i', '/^(ft|ap|pen)/i'],
  ['AP is not full time', '/^(ft|aet|ap|pen)/i', '/^(ft|aet|pen)/i'],
  ['PEN is not full time', '/^(ft|aet|ap|pen)/i', '/^(ft|aet|ap)/i'],
  ['full time needs no is_live flag', "&& r.is_live === false);", ');'],
  ['a live row needs a minute', 'periods.find((r) => r.is_live === true);', 'periods.find((r) => r.is_live === true && num(r.minute) !== null);'],
  ['a row with no is_live flag is a live row', 'periods.find((r) => r.is_live === true);', 'periods.find((r) => r.is_live !== false);'],
  ['a live row reads as unmarked', "state: ft ? 'full-time' : live ? 'in-play' : 'unmarked',", "state: ft ? 'full-time' : 'unmarked',"],
  ['an unmarked capture reads as in play', "state: ft ? 'full-time' : live ? 'in-play' : 'unmarked',", "state: ft ? 'full-time' : 'in-play',"],
  ['a live row outranks full time', "state: ft ? 'full-time' : live ? 'in-play' : 'unmarked',", "state: live ? 'in-play' : ft ? 'full-time' : 'unmarked',"],
  ['the live row minute is lost', 'liveRowMinute: live ? num(live.minute) : null,', 'liveRowMinute: null,'],
  ['goal minutes are not sorted', 'const goalMinutes = goals.map((g) => g.minute).sort((a, b) => a - b);', 'const goalMinutes = goals.map((g) => g.minute);'],
  ['goal minutes are sorted as text', 'const goalMinutes = goals.map((g) => g.minute).sort((a, b) => a - b);', 'const goalMinutes = goals.map((g) => g.minute).sort();'],
  ['a goal needs no minute', "r.type === 'goal' && num(r.minute) !== null", "r.type === 'goal'"],
  ['every row is a goal', "r.type === 'goal' && num(r.minute) !== null", 'num(r.minute) !== null'],
  ['the goal count is compared with !==', 'goals.length === fs_.home + fs_.away', 'goals.length !== fs_.home + fs_.away'],
  ['a missing score reads as a match', 'fs_ && fs_.home !== null && fs_.away !== null ? goals.length === fs_.home + fs_.away : null', 'fs_ ? goals.length === (fs_.home ?? 0) + (fs_.away ?? 0) : null'],
  ['the states are not tallied', 'state: tally(capList, (c) => c.state),', 'state: {},'],
  ['the live row minutes are not tallied', "liveRowMinute: tally(capList.filter((c) => c.state === 'in-play'), (c) => (c.liveRowMinute === null ? 'none' : c.liveRowMinute)),", 'liveRowMinute: {},'],
  ['every capture joins the live row tally', "tally(capList.filter((c) => c.state === 'in-play'), (c) => (c.liveRowMinute === null", "tally(capList, (c) => (c.liveRowMinute === null"],
  ['a live row with no minute is tallied by its null', "(c.liveRowMinute === null ? 'none' : c.liveRowMinute)", '(c.liveRowMinute)'],
  ['a capture that stops early is gradeable', "else if (!covers(r, cap)) reason = `the capture did not see full time and holds no goal within ${WITNESS_TOLERANCE} minute of the resolution`;", "else if (false) reason = 'x';"],
  ['the distance is tallied for every outcome', "(outcome === 'hit' || outcome === 'miss') && num(r?.resolved_minute) !== null) {\n        const d", "num(r?.resolved_minute) !== null) {\n        const d"],
  ['the distance is tallied for a call with no resolved minute', "(outcome === 'hit' || outcome === 'miss') && num(r?.resolved_minute) !== null) {\n        const d", "(outcome === 'hit' || outcome === 'miss')) {\n        const d"],
  ['the distance tally is not by state', 'if (!distance[cap.state]) distance[cap.state] = {};', 'if (!distance.all) distance.all = {};'],
  ['no goal reads as far', "d === null ? 'no goal in the capture' : d >= 3 ? '3+' : String(d)", "d === null ? '3+' : d >= 3 ? '3+' : String(d)"],
  ['far starts at two', "d >= 3 ? '3+' : String(d)", "d >= 2 ? '3+' : String(d)"],
  ['far starts at four', "d >= 3 ? '3+' : String(d)", "d >= 4 ? '3+' : String(d)"],
  ['the tolerance counts are exclusive', 'cap.fullTime || (d !== null && d <= tol)', 'cap.fullTime || (d !== null && d < tol)'],
  ['full time is not counted by tolerance', 'if (cap.fullTime || (d !== null && d <= tol)) byTolerance[tol]++;', 'if (d !== null && d <= tol) byTolerance[tol]++;'],
  ['the tolerance list loses 2', 'for (const tol of [0, 1, 2])', 'for (const tol of [0, 1])'],
  ['gradeable is not split by how it is covered', "inc(gradeableBy, cap.fullTime ? 'full time' : `a goal within ${WITNESS_TOLERANCE} minute`);", "inc(gradeableBy, 'full time');"],
  ['the gradeable note is lost', "note: `gradeable = outcome hit or miss,", "note: `x ="],
  ['the period vocabulary drops the flag', '`${p.text ?? \'(none)\'}/${p.is_live}`', "`${p.text ?? '(none)'}`"],
  ['a non-array incidents is read', 'isObj(json) && Array.isArray(json.incidents) ? json.incidents : null', 'isObj(json) ? json.incidents : null'],
  ['a failed capture has no reason', "why: isObj(json) ? 'no incidents array' : 'not an object'", "why: 'x'"],
  // ---- covers
  ['a failed capture covers', 'if (!cap || !cap.ok) return false;', 'if (!cap) return false;'],
  ['full time does not cover', 'if (cap.fullTime) return true;', ''],
  ['the tolerance is exclusive', 'return d !== null && d <= tolerance;', 'return d !== null && d < tolerance;'],
  ['the tolerance is one too wide', 'return d !== null && d <= tolerance;', 'return d !== null && d <= tolerance + 1;'],
  ['no distance covers', 'return d !== null && d <= tolerance;', 'return d === null || d <= tolerance;'],
  ['the default tolerance is two', 'export const WITNESS_TOLERANCE = 1;', 'export const WITNESS_TOLERANCE = 2;'],
  ['the distance has a sign', 'cap.goalMinutes.map((m) => Math.abs(m - rm))', 'cap.goalMinutes.map((m) => m - rm)'],
  ['the distance is to the farthest goal', 'Math.min(...cap.goalMinutes.map', 'Math.max(...cap.goalMinutes.map'],
  ['a call with no resolved minute has a distance', 'if (rm === null || !cap || !cap.ok || !cap.goalMinutes.length) return null;', 'if (!cap || !cap.ok || !cap.goalMinutes.length) return null;'],
  ['a capture with no goal has a distance', 'if (rm === null || !cap || !cap.ok || !cap.goalMinutes.length) return null;', 'if (rm === null || !cap || !cap.ok) return null;'],
  ['a failed capture has a distance', 'if (rm === null || !cap || !cap.ok || !cap.goalMinutes.length) return null;', 'if (rm === null || !cap || !cap.goalMinutes.length) return null;'],
  // ---- the ledger
  ['a duplicate id is kept', 'if (seen.has(k)) { duplicates++; continue; }', 'if (false) { duplicates++; continue; }'],
  ['duplicates are not counted', 'if (seen.has(k)) { duplicates++; continue; }', 'if (seen.has(k)) { continue; }'],
  ['a row without an id is dropped', 'if (id === undefined || id === null) { noId++; rows.push(r); continue; }', 'if (id === undefined || id === null) { noId++; continue; }'],
  ['a row without an id is not counted', 'if (id === undefined || id === null) { noId++; rows.push(r); continue; }', 'if (id === undefined || id === null) { rows.push(r); continue; }'],
  ['ids are compared as typed', 'const k = String(id);', 'const k = id;'],
  ['the month is read from the end', "s.slice(0, 7) : '(no date)'", "s.slice(-7) : '(no date)'"],
  ['an undated call is not named', "'(no date)'", "'x'"],
  ['the ledger is COMPLETE when it is not', "verdict: L.complete ? 'COMPLETE' : 'PARTIAL', why: L.complete ? null : L.why,", "verdict: 'COMPLETE', why: L.complete ? null : L.why,"],
  ['the ledger reason is lost', 'why: L.complete ? null : L.why,', 'why: null,'],
  ['the drift is the first count', 'L.reportedLast - L.reportedFirst', 'L.reportedFirst - L.reportedLast'],
  ['no drift is computed', 'drift: num(L.reportedFirst) !== null && num(L.reportedLast) !== null ?', 'drift: false ?'],
  ['distinct events count null ids', ".filter((x) => x !== 'undefined' && x !== 'null')", ''],
  ['the outcome tally reads the side', "outcomes: tally(rows, (r) => r?.outcome ?? '(absent)'),", "outcomes: tally(rows, (r) => r?.side ?? '(absent)'),"],
  ['rows without an event id are not counted', "rowsWithoutEventId: rows.filter((r) => ev(r).id === undefined || ev(r).id === null).length,", 'rowsWithoutEventId: 0,'],
  ['rows without a resolved minute are not counted', 'rowsWithoutResolvedMinute: rows.filter((r) => num(r?.resolved_minute) === null).length,', 'rowsWithoutResolvedMinute: 0,'],
  ['the oldest call is the newest', ".filter((x) => typeof x === 'string').sort()[0] ?? null,", ".filter((x) => typeof x === 'string').sort().slice(-1)[0] ?? null,"],
  ['the newest call is the oldest', ".filter((x) => typeof x === 'string').sort().slice(-1)[0] ?? null,", ".filter((x) => typeof x === 'string').sort()[0] ?? null,"],
  ['an unread ledger has no reason', "why: (ledger && ledger.why) || 'the ledger was not read'", "why: 'the ledger was not read'"],
  // ---- R2 accounting
  ['keys outside the layout are not counted', 'if (!p) { unparsed++; continue; }', 'if (!p) { continue; }'],
  ['files are not tallied', 'inc(files, p.file);', ''],
  ['an event with only stats counts as having incidents', "const withIncidents = [...byEvent.entries()].filter(([, e]) => e.files.has('incidents.json'));", 'const withIncidents = [...byEvent.entries()];'],
  ['slugs are not joined', "[...e.slugs].sort().join('+')", "[...e.slugs].sort()[0]"],
  ['an id under two slugs is not counted', '.filter((e) => e.slugs.size > 1).length,', '.filter((e) => e.slugs.size > 5).length,'],
  ['the R2 listing is COMPLETE when it is not', "verdict: r2.complete ? 'COMPLETE' : 'PARTIAL', why: r2.complete ? null : r2.why,", "verdict: 'COMPLETE', why: r2.complete ? null : r2.why,"],
  ['the R2 reason is lost', 'why: r2.complete ? null : r2.why,', 'why: null,'],
  ['the page count is dropped', 'keys: keysSeen, pages: r2.pages ?? null,', 'keys: keysSeen, pages: null,'],
  // ---- reads and captures
  ['a 404 is a failure', 'else if (rd.status === 404) missing++;', 'else if (false) missing++;'],
  ['a failed read is not counted', 'else { failed++; if (rd.blocked) blockedReads++; }', 'else { if (rd.blocked) blockedReads++; }'],
  ['a blocked read is not counted', 'if (rd.blocked) blockedReads++;', ''],
  ['a body-less 200 is parsed', 'if (rd.status === 200 && rd.json !== undefined)', 'if (rd.status === 200)'],
  ['an unreadable capture is not counted', 'else parseFail++; }', 'else { } }'],
  ['the cap is not reported', 'capped: Boolean(ctx.capped) };', 'capped: false };'],
  ['the vocabulary is not tallied', 'periodTexts: tally(capList.flatMap((c) => c.periodTexts), (t) => t),', 'periodTexts: {},'],
  ['the goal count check counts every capture', 'goalCountMatchesFinal: tally(capList.filter((c) => c.fullTime),', 'goalCountMatchesFinal: tally(capList,'],
  // ---- the calls
  ['a call with no event id is not a reason', "if (id === null) reason = 'the call has no event id';", "if (id === null) reason = 'x';"],
  ['an open call is gradeable', "else if (outcome !== 'hit' && outcome !== 'miss') reason", "else if (outcome !== 'hit' && outcome !== 'miss' && outcome !== 'open') reason"],
  ['a no-goal call is gradeable', "else if (outcome !== 'hit' && outcome !== 'miss') reason", "else if (outcome !== 'hit' && outcome !== 'miss' && outcome !== 'nogoal') reason"],
  ['a miss is not gradeable', "else if (outcome !== 'hit' && outcome !== 'miss') reason", "else if (outcome !== 'hit') reason"],
  ['a hit is not gradeable', "else if (outcome !== 'hit' && outcome !== 'miss') reason", "else if (outcome !== 'miss') reason"],
  ['an absent outcome is not named', "`outcome is ${outcome === undefined ? '(absent)' : outcome}`", '`outcome is ${outcome}`'],
  ['a call with no resolved minute is gradeable', "else if (num(r?.resolved_minute) === null) reason = 'no resolved_minute';", 'else if (false) reason = \'no resolved_minute\';'],
  ['a missing key is not a reason', "else if (!hasKey) reason = 'no incidents.json in R2 for the event';", "else if (false) reason = 'x';"],
  ['an unread capture is not a reason', "else if (!R.has(id)) reason = 'incidents.json not read (cap or deadline)';", "else if (false) reason = 'x';"],
  ['a failed read loses its status', '`incidents.json read failed (status ${R.get(id).status ?? \'none\'})`', "'incidents.json read failed'"],
  ['an unreadable capture is gradeable', 'else if (!cap.ok) reason =', 'else if (false) reason ='],
  ['covered counts every readable capture', 'if (cap && cap.ok && covers(r, cap)) covered++;', 'if (cap && cap.ok) covered++;'],
  ['the tracked test reads the wrong league', 'tracked.has(String(e.league_id))', 'tracked.has(String(e.id))'],
  ['tracked calls are counted once per event', 'if (isTracked) { inTracked++;', 'if (isTracked && !eventsTracked.has(id)) { inTracked++;'],
  ['a tracked call without a key is not counted', 'if (isTracked && !hasKey) { trackedNoKey++;', 'if (false) { trackedNoKey++;'],
  ['a key outside the tracked leagues is not counted', 'if (!isTracked && hasKey) keyUntracked++;', ''],
  ['a call with a key is not counted', 'if (hasKey) withKey++;', ''],
  ['a full-time capture is not counted', 'if (cap && cap.ok) { withCapture++; if (cap.fullTime) withFullTime++; }', 'if (cap && cap.ok) { withCapture++; }'],
  ['gradeable calls are not tallied by outcome', 'inc(gradeableByOutcome, outcome);', ''],
  ['gradeable calls are not tallied by slug', "inc(gradeableBySlug, [...key.slugs].sort().join('+'));", ''],
  ['gradeable calls are not tallied by month', 'inc(gradeableByMonth, monthOf(r?.called_at));', ''],
  ['gradeable events are not counted', 'gradeable++; eventsGradeable.add(id);', 'gradeable++;'],
  ['a reason is counted only for the first call', 'else inc(reasons, reason);', 'else if (!reasons[reason]) inc(reasons, reason);'],
  ['the tracked league list absent reads as none', 'const tracked = Array.isArray(ctx.trackedLeagueIds) ? new Set(ctx.trackedLeagueIds.map(String)) : null;', 'const tracked = new Set((ctx.trackedLeagueIds || []).map(String));'],
  // ---- ANSWERED only when nothing was left out
  ['a partial ledger is ANSWERED', "L.complete && r2 && r2.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'", "r2 && r2.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'"],
  ['a partial listing is ANSWERED', "L.complete && r2 && r2.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'", "L.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'"],
  ['a capped run is ANSWERED', "L.complete && r2 && r2.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'", "L.complete && r2 && r2.complete && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'"],
  ['a run with blocked reads is ANSWERED', "L.complete && r2 && r2.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL'", "L.complete && r2 && r2.complete && !ctx.capped ? 'ANSWERED' : 'PARTIAL'"],
  ['the reasons it is partial are not listed', "ctx.capped && 'the read cap was reached',", 'false,'],
  ['the ledger reason is not listed', "!L.complete && 'the ledger is partial',", 'false,'],
  ['the listing reason is not listed', "!(r2 && r2.complete) && 'the R2 listing is partial',", 'false,'],
  ['the deadline reason is not listed', "blockedReads > 0 && 'reads were blocked by the run deadline'", 'false'],
  // ---- the line
  ['the line leaves out the duplicates', ", ${l.duplicates ?? '?'} duplicates)`", ')`'],
  ['the line leaves out the drift', "reported ${l.reportedFirst} then ${l.reportedLast}", 'reported ${l.reportedFirst}'],
  ['the line leaves out the cap', "(CAPPED)' : ''}`", "' : ''}`"],
  ['the line leaves out the tracked clause', "(${c.inTrackedLeague} in a tracked league, ${c.withIncidentsKey} with an incidents.json, ${c.withFullTimeCapture} with a full-time capture)", ''],
  ['the line leaves out the BSD calls', '`BSD calls ${ctx.callsMade ?? \'?\'}/${ctx.callBudget ?? \'?\'}`', "'BSD calls'"],
  ['the line says COMPLETE for the listing', "(${q.verdict})`}`", '(COMPLETE)`}`'],
  // ---- main(): budget, token, stop, paging, reads, deadline, artifact
  ['the default budget is 8', 'positiveInt(process.env.CALL_BUDGET, 16)', 'positiveInt(process.env.CALL_BUDGET, 8)'],
  ['the default read cap is 15', 'positiveInt(process.env.READ_CAP, 1500)', 'positiveInt(process.env.READ_CAP, 15)'],
  ['the default deadline is 4 seconds', 'positiveInt(process.env.RUN_DEADLINE_SECONDS, 420)', 'positiveInt(process.env.RUN_DEADLINE_SECONDS, 4)'],
  ['the token is not trimmed', 'TOKEN_RAW.trim()', 'TOKEN_RAW'],
  ['whitespace in the token is allowed', '/[^\\x21-\\x7e]/.test(TOKEN)', '/[^\\x20-\\x7e]/.test(TOKEN)'],
  ['a malformed token exits 0', "refusing to send it anywhere');\n    process.exit(1);", "refusing to send it anywhere');\n    process.exit(0);"],
  ['no token still calls the vendor', "if (!TOKEN) rec.blocked = 'no BSD_API_TOKEN in env';", "if (false) rec.blocked = 'no BSD_API_TOKEN in env';"],
  ['a stop is recorded but ignored', 'else if (stopped) rec.blocked', 'else if (false) rec.blocked'],
  ['the budget is off by one', 'else if (bsdCalls >= CALL_BUDGET) rec.blocked', 'else if (bsdCalls > CALL_BUDGET) rec.blocked'],
  ['the BSD deadline is never checked', 'else if (timedOut()) rec.blocked', 'else if (false) rec.blocked'],
  ['the relay deadline is never checked', 'if (timedOut()) { rec.blocked =', 'if (false) { rec.blocked ='],
  ['BSD redirects are followed', "Accept: 'application/json' }, redirect: 'manual', signal", "Accept: 'application/json' }, redirect: 'follow', signal"],
  ['BSD redirects are errors (the stall hazard)', "Accept: 'application/json' }, redirect: 'manual', signal", "Accept: 'application/json' }, redirect: 'error', signal"],
  ['the BSD fetch has no timeout', "Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }", "Accept: 'application/json' }, redirect: 'manual' }"],
  ['the relay fetch has no timeout', "fetch(`${RELAY}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })", "fetch(`${RELAY}${path}`, { redirect: 'manual' })"],
  ['the fetch timeout is not configurable', 'const FETCH_TIMEOUT_MS = positiveInt(process.env.FETCH_TIMEOUT_SECONDS, 30) * 1000;', 'const FETCH_TIMEOUT_MS = 30 * 1000;'],
  ['the fetch timeout is in milliseconds', 'const FETCH_TIMEOUT_MS = positiveInt(process.env.FETCH_TIMEOUT_SECONDS, 30) * 1000;', 'const FETCH_TIMEOUT_MS = positiveInt(process.env.FETCH_TIMEOUT_SECONDS, 30);'],
  ['the fetch timeout is not recorded', ', fetchTimeoutSeconds: FETCH_TIMEOUT_MS / 1000 };', ' };'],
  ['relay redirects are followed', "fetch(`${RELAY}${path}`, { redirect: 'manual', ", "fetch(`${RELAY}${path}`, { redirect: 'follow', "],
  ['relay redirects are errors (the stall hazard)', "fetch(`${RELAY}${path}`, { redirect: 'manual', ", "fetch(`${RELAY}${path}`, { redirect: 'error', "],
  ['the token is not sent', 'Authorization: `Token ${TOKEN}`, Accept', 'Accept'],
  ['the token is sent to the relay', "fetch(`${RELAY}${path}`, { redirect: 'manual', ", "fetch(`${RELAY}${path}`, { headers: { Authorization: `Token ${TOKEN}` }, redirect: 'manual', "],
  ['a 429 or 401 does not stop the run', 'if (r.status === 429 || r.status === 401) stopped = String(r.status);', ''],
  ['only a 429 stops the run', 'r.status === 429 || r.status === 401', 'r.status === 429'],
  ['only a 401 stops the run', 'r.status === 429 || r.status === 401', 'r.status === 401'],
  ['the first count is not asked', "const first = await bsd('count_first', '/api/v2/next-goal/calls/?limit=1');", "const first = { blocked: 'skipped' };"],
  ['the count is read from the wrong field', 'first.status === 200 && isObj(first.json) ? num(first.json.count) : null', 'first.status === 200 && isObj(first.json) ? num(first.json.total) : null'],
  ['the page size is 100', 'const PAGE = 200;', 'const PAGE = 100;'],
  ['the pages are asked from offset 1', '`/api/v2/next-goal/calls/?limit=${PAGE}&offset=${i * PAGE}`', '`/api/v2/next-goal/calls/?limit=${PAGE}&offset=${i * PAGE + 1}`'],
  ['there is no page of slack', 'const want = Math.ceil(reportedFirst / PAGE) + 1;', 'const want = Math.ceil(reportedFirst / PAGE);'],
  ['a full page ends the paging', 'if (rows.length < PAGE) break;', 'if (rows.length <= PAGE) break;'],
  ['paging never ends early', 'if (rows.length < PAGE) break;', ''],
  ['a failed page is skipped', "if (rows === null) { stoppedWhy = `ledger page ${i} answered ${p.blocked || p.status || p.error || 'nothing'}`; break; }", 'if (rows === null) { continue; }'],
  ['the closing count is not asked', "const last = await bsd('count_last', '/api/v2/next-goal/calls/?limit=1');", "const last = { blocked: 'skipped' };"],
  ['the ledger is complete with fewer rows than reported', 'd.rows.length >= reportedFirst', 'd.rows.length >= 0'],
  ['the ledger is complete without its closing count', "!stoppedWhy && reportedLast !== null && d.rows.length >= reportedFirst", '!stoppedWhy && d.rows.length >= reportedFirst'],
  ['the listing is not asked', 'const r2 = await listAll(relay);', "const r2 = { keys: [], pages: 0, complete: false, why: 'skipped' };"],
  ['every R2 event is read', 'if (p && p.file === \'incidents.json\' && wantIds.has(p.id) && !slugOf.has(p.id))', "if (p && p.file === 'incidents.json' && !slugOf.has(p.id))"],
  ['an id under two slugs is read twice', 'wantIds.has(p.id) && !slugOf.has(p.id)', 'wantIds.has(p.id)'],
  ['other files are read', "p.file === 'incidents.json' && wantIds.has(p.id)", 'wantIds.has(p.id)'],
  ['the read goes to the wrong file', '`bsd/${slug}/${id}/incidents.json`', '`bsd/${slug}/${id}/stats.json`'],
  ['the read cap is off by one', 'if (next >= READ_CAP) { capped = true; return; }', 'if (next > READ_CAP) { capped = true; return; }'],
  ['a read answer is not recorded', 'reads.set(id, { status: rd.status ?? null, json: rd.json, error: rd.error, blocked: rd.blocked });', ''],
  ['a read loses its body', 'reads.set(id, { status: rd.status ?? null, json: rd.json,', 'reads.set(id, { status: rd.status ?? null, json: undefined,'],
  ['a read loses its blocked flag', 'error: rd.error, blocked: rd.blocked });', 'error: rd.error });'],
  ['the tracked leagues are not read from source', 'const trackedLeagueIds = fieldLeagueIdsFromSource();', 'const trackedLeagueIds = null;'],
  ['an analysis error is not caught', 'try { analysis = analyseCensus({ ledger, r2, reads, ctx }); } catch (e) {', 'try { analysis = analyseCensus({ ledger, r2, reads, ctx }); } catch (e) { throw e;'],
  ['an analysis error is not recorded', "analysisError = String(e && e.stack ? e.stack : e).split('\\n').slice(0, 4).join(' | ');", 'analysisError = null;'],
  ['a partial census advances latest', "analysis.calls.verdict === 'ANSWERED'", "analysis.calls.verdict !== 'UNKNOWN'"],
  ['latest is always written', 'if (out.reachedTarget) {', 'if (true) {'],
  ['the BSD log carries bodies', 'log.push({ key, status: rec.status ?? null, ms: rec.ms, error: rec.error });', 'log.push({ key, status: rec.status ?? null, ms: rec.ms, error: rec.error, json: rec.json });'],
  ['the outbox directory is not made', "fs.mkdirSync('outbox', { recursive: true });", ''],
  ['the per-request log lacks the count', 'console.log(`bsd ${bsdCalls}/${CALL_BUDGET} ${key} ->', 'console.log(`bsd ${key} ->'],
  ['the coverage is not printed', "console.log('\\n=== COVERAGE ===\\n' + out.coverageLine);", ''],
  ['the result line omits the gradeable count', "${c.gradeable != null ? ` | gradeable ${c.gradeable} of ${c.uniqueCalls}` : ''}", ''],
  ['the default base is mistyped', "process.env.BSD_BASE || 'https://sports.bzzoiro.com'", "process.env.BSD_BASE || 'https://sport.bzzoiro.com'"],
  ['the default relay is mistyped', "process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'", "process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev.x'"],
  ['importing the census runs it', 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {', 'if (true) {'],
];

const BROKEN_FOR_ANALYSIS = ['return d !== null && d <= tolerance;', 'return d !== null && d < tolerance;'];
const BROKEN_FOR_RUN = ['else if (bsdCalls >= CALL_BUDGET) rec.blocked', 'else if (bsdCalls > CALL_BUDGET) rec.blocked'];
const BROKEN_EXITS_AT_IMPORT = ["const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);", "process.exit(0);\nconst isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);"];

const CHECK_MUTATIONS = [
  ['blind', CHECK, 'eq never fails', 'if (stable(got) !== stable(want)) {', 'if (false) {', BROKEN_FOR_ANALYSIS],
  ['blind', CHECK, 'the exit code ignores failures', 'finished = true;\nprocess.exit(failed === 0 ? 0 : 1);', 'finished = true;\nprocess.exit(0);', BROKEN_FOR_ANALYSIS],
  ['blind', CHECK, 'an early exit is not noticed', "process.on('exit', (code) => {", "process.on('never', (code) => {", BROKEN_EXITS_AT_IMPORT],
  ['red', CHECK, 'MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 10;', 'export const MIN_SCENARIOS = 11;'],
  ['red', CHECK, 'MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 96;', 'export const MIN_ASSERTIONS = 97;'],
  ['blind', RUN_CHECK, 'the run check: eq never fails', 'if (stable(got) !== stable(want)) {', 'if (false) {', BROKEN_FOR_RUN],
  ['blind', RUN_CHECK, 'the run check: the exit code ignores failures', 'finished = true;\nprocess.exit(failed === 0 ? 0 : 1);', 'finished = true;\nprocess.exit(0);', BROKEN_FOR_RUN],
  ['red', RUN_CHECK, 'the run check: MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 16;', 'export const MIN_SCENARIOS = 17;'],
  ['red', RUN_CHECK, 'the run check: MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 66;', 'export const MIN_ASSERTIONS = 67;'],
];

const applyEdits = (text, edits, label) => {
  let out = text;
  for (const [anchor, replacement] of edits) {
    const n = out.split(anchor).length - 1;
    if (n !== 1) return { error: `NOT APPLIED: anchor matched ${n} times, not 1 (${label}): ${JSON.stringify(anchor.slice(0, 70))}` };
    if (anchor === replacement) return { error: `NOT APPLIED: replacement equals anchor (${label})` };
    out = out.replace(anchor, () => replacement);
  }
  return { text: out };
};
const exec = (checkFile, srcFile) => new Promise((resolve) => {
  const c = spawn(process.execPath, [checkFile, '--source', srcFile]);
  let stdout = '';
  c.stdout.on('data', (d) => { stdout += d; });
  c.stderr.on('data', () => {});
  const timer = setTimeout(() => c.kill('SIGKILL'), 150000);
  c.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout }); });
});
const red = (r) => r.status === 1 && /^FAIL/m.test(r.stdout);
const parses = (file) => spawnSync(process.execPath, ['--check', file]).status === 0;
async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }));
  return results;
}

const srcText = fs.readFileSync(SRC, 'utf8');
const lines = [];
let caught = 0, caughtAnalysis = 0, caughtRun = 0, notCaught = 0, notApplied = 0;

const b1 = await exec(CHECK, SRC), b2 = await exec(RUN_CHECK, SRC);
console.log(`baseline: the analysis check on the real census exits ${b1.status}, the run check ${b2.status}`);
if (b1.status !== 0 || b2.status !== 0) { console.log('FAIL  a check is already red; every mutation would be "caught" for the wrong reason'); process.exit(1); }

console.log(`\nHALF 1: the census, broken (${SOURCE_MUTATIONS.length} mutations, analysis check first, then the run check)`);
await pool(SOURCE_MUTATIONS, 3, async ([name, a, b], i) => {
  const edits = Array.isArray(a) ? a : [[a, b]];
  const r = applyEdits(srcText, edits, name);
  if (r.error) { notApplied++; lines[i] = `  ${r.error}  [${name}]`; return; }
  const f = path.join(tmp, `census-${i}.mjs`);
  fs.writeFileSync(f, absolute(r.text));
  if (!parses(f)) { notApplied++; lines[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return; }
  const x = await exec(CHECK, f);
  if (red(x)) { caught++; caughtAnalysis++; lines[i] = `  caught       ${name}  (analysis)`; return; }
  const y = await exec(RUN_CHECK, f);
  if (red(y)) { caught++; caughtRun++; lines[i] = `  caught       ${name}  (run)`; return; }
  notCaught++; lines[i] = `  NOT CAUGHT   ${name}  (analysis exit ${x.status}, run exit ${y.status})`;
});
console.log(lines.join('\n'));

console.log('\nHALF 2: the checks, broken');
const brokenFiles = new Map();
const brokenFile = (spec) => {
  if (!brokenFiles.has(spec[0])) {
    const r = applyEdits(srcText, [spec], 'broken census');
    if (r.error) { console.log(`  ${r.error}`); process.exit(1); }
    const f = path.join(tmp, `broken-${brokenFiles.size}.mjs`);
    fs.writeFileSync(f, absolute(r.text));
    brokenFiles.set(spec[0], f);
  }
  return brokenFiles.get(spec[0]);
};
const half2 = [];
await pool(CHECK_MUTATIONS, 2, async ([kind, file, name, a, b, broken], i) => {
  const r = applyEdits(fs.readFileSync(file, 'utf8'), [[a, b]], name);
  if (r.error) { notApplied++; half2[i] = `  ${r.error}  [${name}]`; return; }
  const f = path.join(tmp, `check-${i}.mjs`);
  fs.writeFileSync(f, r.text);
  if (!parses(f)) { notApplied++; half2[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return; }
  let ok, shown;
  if (kind === 'blind') {
    const real = await exec(file, brokenFile(broken));
    const mutated = await exec(f, brokenFile(broken));
    ok = red(real) && mutated.status === 0 && !red(mutated);
    shown = `real check exit ${real.status}, mutated check exit ${mutated.status} on the broken census`;
  } else {
    const mutated = await exec(f, SRC);
    ok = red(mutated);
    shown = `mutated check exit ${mutated.status} on the real census`;
  }
  if (ok) { caught++; half2[i] = `  caught       ${name}  (${kind}: ${shown})`; } else { notCaught++; half2[i] = `  NOT CAUGHT   ${name}  (${kind}: ${shown})`; }
});
console.log(half2.join('\n'));

const moved = REAL.filter((f) => sha(f) !== before[f]);
const leftover = strays().filter((f) => !strayBefore.has(f));
for (const f of leftover) fs.rmSync(path.join('outbox', f), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
const total = SOURCE_MUTATIONS.length + CHECK_MUTATIONS.length;
console.log(`\nmutations ${total}: caught ${caught} (census mutants: ${caughtAnalysis} by the analysis check, ${caughtRun} by the run check), NOT CAUGHT ${notCaught}, NOT APPLIED ${notApplied}; real files moved: ${moved.length}; stray artifacts removed: ${leftover.length}`);
if (moved.length) console.log(`FAIL  the real file(s) changed: ${moved.join(', ')}`);
process.exit(notCaught === 0 && notApplied === 0 && moved.length === 0 ? 0 : 1);
