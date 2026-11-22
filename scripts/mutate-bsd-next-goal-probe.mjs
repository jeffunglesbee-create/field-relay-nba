#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-next-goal-probe.mjs and scripts/check-bsd-next-goal-probe-run.mjs.
//
// HALF 1 breaks a temp copy of the REAL scripts/bsd-next-goal-probe.mjs the ways a verdict about a vendor, or the
// spend of a run, can be wrong. A mutant is CAUGHT when the analysis check goes red on it, or, failing that, the
// run check (the whole probe against a stub vendor) does. HALF 2 breaks the checks themselves: mutations that must
// leave a check BLIND on a broken probe (so its red depends on that line), and mutations that tighten a gate and
// must turn it red on the real probe (so the gate binds).
//
// WRITTEN FROM A REVIEW, NOT FROM THE AUTHOR'S OWN CHECK. The first version of this harness had 46 mutations, all
// caught. An independent reviewer then wrote 169 of their own against the same checks and 135 survived: the author
// had marked their own work. The mutations below are the author's 46 rewritten for the new probe plus every cluster
// the reviewer found, and the checks were extended until the survivors were killed or shown equivalent.
//
// Discipline: each anchor must occur exactly once in the file it mutates and the replacement must differ from it;
// a mutant that does not parse is NOT APPLIED (a SyntaxError would otherwise count as caught for the wrong reason);
// CAUGHT requires exit 1 and a FAIL line in the check's own output. The baseline runs first (a check that is
// already red would "catch" everything). The real files are hashed before and after and must not move, and any
// artifact a mutant's probe wrote into outbox/ is removed.
//
// Usage: node scripts/mutate-bsd-next-goal-probe.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const SRC = 'scripts/bsd-next-goal-probe.mjs';
const CHECK = 'scripts/check-bsd-next-goal-probe.mjs';
const RUN_CHECK = 'scripts/check-bsd-next-goal-probe-run.mjs';
const FIX = 'scripts/fixtures/bsd-next-goal-synthetic.mjs';
const REAL = [SRC, CHECK, RUN_CHECK, FIX];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = Object.fromEntries(REAL.map((f) => [f, sha(f)]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-ngp-'));
const strays = () => (fs.existsSync('outbox') ? fs.readdirSync('outbox').filter((f) => /^bsd-next-goal-probe-/.test(f)) : []);
const strayBefore = new Set(strays());

// [name, anchor, replacement] or [name, [[anchor, replacement], ...]]
const SOURCE_MUTATIONS = [
  // ---- the token guard
  ['the guard ignores the JSON-escaped form', 'JSON.stringify(token).slice(1, -1), ', ''],
  ['the guard ignores the URL-encoded form', 'encodeURIComponent(token), token.slice(0, Math.min(token.length, 12))', 'token.slice(0, Math.min(token.length, 12))'],
  ['the guard ignores a truncated echo', ', token.slice(0, Math.min(token.length, 12))];', '];'],
  ['the guard never refuses', 'forms.some((f) => body.includes(f))', 'false'],
  ['the guard floor is 4 characters', 'token.length < 8) return;', 'token.length < 4) return;'],
  ['the guard assumes a string', "typeof token !== 'string' || token.length < 8", 'token.length < 8'],
  ['the token guard is gone from main', 'refuseIfTokenInside(body, TOKEN);', ''],
  // ---- small helpers
  ['a team object with a name is not read', "isObj(v) && typeof v.name === 'string' ? v.name : null)", 'null)'],
  ['a fraction of exactly 1 reads as a percent', "return n.length ? (Math.max(...n) <= 1 ? 'fraction (<=1)' : 'percent (>1)') : null;", "return n.length ? (Math.max(...n) < 1 ? 'fraction (<=1)' : 'percent (>1)') : null;"],
  ['a range drops its count', '{ min: Math.min(...n), max: Math.max(...n), n: n.length }', '{ min: Math.min(...n), max: Math.max(...n) }'],
  ['field counts stop at the top level', 'function fieldCounts(rows, depthLimit = 5) {', 'function fieldCounts(rows, depthLimit = 0) {'],
  ['field counts count a field once', 'acc[p] = (acc[p] || 0) + 1;', 'acc[p] = 1;'],
  ['a row dates by its earliest value', 'return d.length ? d[d.length - 1] : null;', 'return d.length ? d[0] : null;'],
  ['the date scan does not look inside objects', 'else if (isObj(v)) Object.values(v).forEach((x) => dateLikes(x, acc));', ''],
  ['a bare array is not an events/live shape', "if (Array.isArray(j)) return { rows: j, shape: 'array' };", ''],
  ['{events} is not an events/live shape', 'isObj(j) && Array.isArray(j.events)', 'false'],
  ['{results} is not an events/live shape', 'isObj(j) && Array.isArray(j.results)', 'false'],
  ['a non-200 events/live is read', "if (!rec || rec.status !== 200 || rec.json == null) return { rows: null, shape: null };", "if (!rec || rec.json == null) return { rows: null, shape: null };"],
  ['a non-200 next-goal list is read', 'rec && rec.status === 200 && isObj(rec.json) && Array.isArray(rec.json.results)', 'rec && isObj(rec.json) && Array.isArray(rec.json.results)'],
  // ---- what an events/live row is
  ['FT is not a finished period', '/^(finished|ended|ft|full.?time|aet|after)/i', '/^(finished|ended|full.?time|aet|after)/i'],
  ['AET is not a finished period', '|aet|after)/i', '|after)/i'],
  ['ended is not finished', '/^(finished|ended|ft|', '/^(finished|ft|'],
  ['the period does not decide finished', "if (FINISHED_RE.test(s) || FINISHED_RE.test(p)) return 'finished';", "if (FINISHED_RE.test(s)) return 'finished';"],
  ['postponed is not not-started', '|postponed|', '|'],
  ['abandoned is not not-started', 'cancel|abandon|suspend', 'cancel|suspend'],
  ['a half in the status is not in play', '/in.?progress|live|half|extra|penalt/i.test(s)', '/in.?progress|live|extra|penalt/i.test(s)'],
  ['extra time is not in play', 'live|half|extra|penalt/i.test(s)', 'live|half|penalt/i.test(s)'],
  ['a period alone does not put a match in play', "|| /half|extra|penalt|1st|2nd/i.test(p)) return 'inplay';", ") return 'inplay';"],
  ['an unknown vocabulary is called in play', "return 'other';", "return 'inplay';"],
  ['halftime by status is not recognised', "|| /half.?time/i.test(String(r?.status ?? ''))", ''],
  ['HT is not halftime', "/half.?time|^ht$/i.test(String(r?.period ?? ''))", "/half.?time/i.test(String(r?.period ?? ''))"],
  // ---- the pickers
  ['the no-read pick takes a finished row', "&& liveClass(r) === 'inplay' && !isHalftime(r))", '&& !isHalftime(r))'],
  ['the no-read pick takes a halftime match', "&& liveClass(r) === 'inplay' && !isHalftime(r))", "&& liveClass(r) === 'inplay')"],
  ['the no-read pick does not prefer minute 10+', 'cand.find((r) => (num(r.current_minute) ?? -1) >= 10) ||', ''],
  ['minute 10 is not 10+ for the pick', '(num(r.current_minute) ?? -1) >= 10) ||', '(num(r.current_minute) ?? -1) > 10) ||'],
  ['the second pick takes an unknown minute', 'cand.find((r) => num(r.current_minute) !== null) || null', 'cand[0] || null'],
  ['there is no second pick', '|| cand.find((r) => num(r.current_minute) !== null) || null;', '|| null;'],
  ['the finished pick takes any row', "r?.id != null && liveClass(r) === 'finished')", 'r?.id != null)'],
  ['the finished pick skips the id check', "r?.id != null && liveClass(r) === 'finished')", "liveClass(r) === 'finished')"],
  ['the league control is not above the maximum', '(nums.length ? Math.max(...nums) : 0) + 100000', '(nums.length ? Math.max(...nums) : 0) + 1'],
  ['the least common league is picked', 'const top = Object.entries(tally(ids)).sort((a, b) => b[1] - a[1])[0][0];', 'const top = Object.entries(tally(ids)).sort((a, b) => a[1] - b[1])[0][0];'],
  ['an empty league id is a league', "(v) => v !== null && v !== undefined && v !== ''", '(v) => v !== null && v !== undefined'],
  // ---- the gate
  ['a status with a body error is called a request error', 'if (rec.status != null) {', 'if (rec.status != null && !rec.error) {'],
  ['the body error is dropped', 'if (rec.error) out.bodyError = rec.error;', ''],
  ['a 403 is no longer GATED', "s === 402 || s === 403 ? 'GATED'", "s === 402 ? 'GATED'"],
  ['a 402 is no longer GATED', "s === 402 || s === 403 ? 'GATED'", "s === 403 ? 'GATED'"],
  ['a 403 reads as OPEN', "s === 200 ? 'OPEN'", "s === 200 || s === 403 ? 'OPEN'"],
  ['a 401 is no longer TOKEN_REFUSED', "s === 401 ? 'TOKEN_REFUSED'", "s === 4010 ? 'TOKEN_REFUSED'"],
  ['a 404 is no longer ABSENT', "s === 404 ? 'ABSENT'", "s === 4040 ? 'ABSENT'"],
  ['a 429 is no longer RATE_LIMITED', "s === 429 ? 'RATE_LIMITED'", "s === 4290 ? 'RATE_LIMITED'"],
  ['a 500 is not an upstream error', "s >= 500 ? 'UPSTREAM_ERROR'", "s > 500 ? 'UPSTREAM_ERROR'"],
  ['the status is not kept', 'const out = { status: s, verdict, bodyKeys:', 'const out = { verdict, bodyKeys:'],
  ['the vendor code is not kept', 'out.code = str(body?.code ?? body?.error?.code);', 'out.code = null;'],
  ['the vendor detail is not kept', 'out.detail = str(body?.detail ?? body?.message ?? body?.error?.message ?? body?.error);', 'out.detail = null;'],
  ['a non-JSON body is dropped', 'if (rec.nonJson) out.nonJson = str(rec.nonJson, 120);', ''],
  ['a blocked call loses its reason', "if (rec.blocked) return { verdict: 'UNKNOWN', why: rec.blocked };", "if (rec.blocked) return { verdict: 'UNKNOWN', why: 'blocked' };"],
  ['a request error loses its reason', 'why: `request error: ${rec.error}`', "why: 'request error'"],
  ['an absent record is not called not-called', "why: 'not called'", "why: 'none'"],
  ['ABSENT is not a definite answer', "['OPEN', 'GATED', 'ABSENT'].includes(g.verdict)", "['OPEN', 'GATED'].includes(g.verdict)"],
  ['UNKNOWN is a definite answer', "['OPEN', 'GATED', 'ABSENT'].includes(g.verdict)", "['OPEN', 'GATED', 'ABSENT', 'UNKNOWN'].includes(g.verdict)"],
  // ---- the shape of a read
  ['the probability tolerance is wide', 'Math.abs(total - 1) <= 0.011) sumOk++', 'Math.abs(total - 1) <= 0.5) sumOk++'],
  ['the sum leaves out no_goal', 'const total = h + a + (g === null ? 0 : g);', 'const total = h + a;'],
  ['a null no_goal is not counted', 'if (p.no_goal === null) noGoalNull++;', ''],
  ['confidence is never equal to the leader probability', 'Math.abs(conf - lp) <= 0.0101) confEqLeader++', 'Math.abs(conf - lp) < 0) confEqLeader++'],
  ['the confidence tolerance is wide', 'Math.abs(conf - lp) <= 0.0101', 'Math.abs(conf - lp) <= 0.5'],
  ['is_call is judged with > instead of >=', 'const wouldCall = conf >= th;', 'const wouldCall = conf > th;'],
  ['a paused call is not explained', 'else if (!r.is_call && r.call_paused === true && wouldCall) callPausedExplained++;', ''],
  ['any would-be call that is not flagged is called paused', '!r.is_call && r.call_paused === true && wouldCall', '!r.is_call && wouldCall'],
  ['rounding is not tolerated', 'else if (Math.abs(conf - th) <= 0.0101) callWithinRounding++;', ''],
  ['the rounding tolerance is wide', 'Math.abs(conf - th) <= 0.0101', 'Math.abs(conf - th) <= 0.5'],
  ['a non-boolean is_call is compared', "typeof r?.is_call !== 'boolean') callUnknown++;", 'false) callUnknown++;'],
  ['the age is negated', '(nowMs - t) / 1000', '(t - nowMs) / 1000'],
  ['an age is computed with no clock', 'const ageSec = nowMs && gen.length ?', 'const ageSec = gen.length ?'],
  ['the evidence keys are unsorted', 'Object.keys(fieldCounts(rows.map((r) => r?.evidence || {}))).sort()', 'Object.keys(fieldCounts(rows.map((r) => r?.evidence || {})))'],
  ['a percent track-record accuracy is not told apart', "acc.every((v) => v > 1) ? 'percent (>1)'", "false ? 'percent (>1)'"],
  ['mixed accuracy scales read as a fraction', "acc.every((v) => v <= 1) ? 'fraction (<=1)'", "true ? 'fraction (<=1)'"],
  ['distinct track records are not folded', 'const trDistinct = [...new Set(tr)];', 'const trDistinct = tr;'],
  ['the first track record is not kept', 'trackRecordFirst: trDistinct[0] ? JSON.parse(trDistinct[0]) : null,', 'trackRecordFirst: null,'],
  ['momentum 15m reads the 5m value', 'momentum15m: minmax(rows.map((r) => r?.evidence?.momentum_15m)),', 'momentum15m: minmax(rows.map((r) => r?.evidence?.momentum_5m)),'],
  ['shots away reads home', 'shotsAway10m: minmax(rows.map((r) => r?.evidence?.shots_away_10m)),', 'shotsAway10m: minmax(rows.map((r) => r?.evidence?.shots_home_10m)),'],
  ['null minutes since a goal are not counted', 'rows.filter((r) => r?.minutes_since_goal === null).length', '0'],
  ['the leader tally reads is_call', "leader: tally(rows, (r) => r?.leader ?? '(absent)'),", "leader: tally(rows, (r) => r?.is_call ?? '(absent)'),"],
  ['the call_paused tally reads is_call', "callPaused: tally(rows, (r) => r?.call_paused ?? '(absent)'),", "callPaused: tally(rows, (r) => r?.is_call ?? '(absent)'),"],
  ['the event status tally is dropped', "eventStatus: tally(ev, (e) => e.status ?? '(absent)'),", 'eventStatus: {},'],
  ['the threshold values are dropped', "callThresholdValues: tally(rows, (r) => r?.call_threshold ?? '(absent)'),", 'callThresholdValues: {},'],
  ['the probability scale reads confidence', 'probabilityScale: scaleOf(probs.flatMap((p) => [p.home, p.away, p.no_goal])),', 'probabilityScale: scaleOf(rows.map((r) => r?.confidence)),'],
  ['the confidence scale reads the threshold', 'confidenceScale: scaleOf(rows.map((r) => r?.confidence)),', 'confidenceScale: scaleOf(rows.map((r) => r?.call_threshold)),'],
  // ---- analyse: gate, truncation, idSpace, leagues
  ['the age is measured against events/live', 'const nowMs = Date.parse(raw.ng_list?.at) || null;', 'const nowMs = Date.parse(raw.live?.at) || null;'],
  ['the events/live classes are not tallied', 'byClass: tally(lv, liveClass),', 'byClass: {},'],
  ['the events/live vocabulary is not recorded', 'statusPeriod: tally(lv, ', 'statusPeriod: tally([], '],
  ['a list with a next page is not truncated', 'raw.ng_list.json.next != null ||', 'false ||'],
  ['a missing next page counts as truncated', 'raw.ng_list.json.next != null ||', 'raw.ng_list.json.next !== null ||'],
  ['a count above the rows read is not truncated', 'raw.ng_list.json.count > ng.length', 'false'],
  ['a count equal to the rows read is truncated', 'raw.ng_list.json.count > ng.length', 'raw.ng_list.json.count >= ng.length'],
  ['the truncation block is dropped', 'A.truncated = { reportedCount: raw.ng_list.json.count ?? null, rowsRead: ng.length, nextPage: raw.ng_list.json.next ?? null, partial };', 'A.truncated = {};'],
  ['an empty list is read for its shape', 'if (ng.length === 0) {', 'if (false) {'],
  ['a 200 without results has the wrong reason', "'next-goal returned 200 without a results array'", "'x'"],
  ['a closed gate has no name in the reason', '`next-goal gate is ${A.gate.verdict}`', "'next-goal gate'"],
  ['ids are not compared by name', 'else if (kh[0] === kh[1] && ka[0] === ka[1]) agree++;', 'else if (true) agree++;'],
  ['only the home name is compared', 'kh[0] === kh[1] && ka[0] === ka[1]', 'kh[0] === kh[1]'],
  ['only the away name is compared', 'kh[0] === kh[1] && ka[0] === ka[1]', 'ka[0] === ka[1]'],
  ['an empty name is not unknown', 'if (!kh[0] || !kh[1] || !ka[0] || !ka[1]) nameUnknown++;', 'if (false) nameUnknown++;'],
  ['an empty away name is not unknown', '!kh[0] || !kh[1] || !ka[0] || !ka[1]', '!kh[0] || !kh[1]'],
  ['an empty home name is not unknown', '!kh[0] || !kh[1] || !ka[0] || !ka[1]', '!ka[0] || !ka[1]'],
  ['the disagreements are not capped', 'if (disagreements.length < 3) disagreements.push(', 'if (true) disagreements.push('],
  ['no match reads as the same id space', "matched === 0 ? 'NOT_JOINED'", "matched === 0 ? 'SAME_ID_SPACE'"],
  ['a collision is not reported', "disagree > 0 ? 'ID_COLLISION'", "disagree > 99 ? 'ID_COLLISION'"],
  ['unknown names read as the same space', ": agree === 0 ? 'UNKNOWN' : 'SAME_ID_SPACE',", ": 'SAME_ID_SPACE',"],
  ['team ids are never compared', 'if (String(l.home_team_id) === String(e.home_team_id)) teamIdAgree++; else teamIdDisagree++;', 'teamIdAgree++;'],
  ['a missing team id is compared', 'if (l.home_team_id != null && e.home_team_id != null) {', 'if (true) {'],
  ['id types are not recorded', 'idTypes: tally(ng, (r) => typeof r?.event?.id),', 'idTypes: {},'],
  ['a partial id space is not marked', 'partial: matched < ng.length || partial,', 'partial: false,'],
  ['the matched count is the row count', 'matchedInEventsLive: matched, nameAgree: agree', 'matchedInEventsLive: ng.length, nameAgree: agree'],
  ['league names are not kept', 'byLeague[k] = byLeague[k] || { league_name: e.league_name ?? null, rows: 0 };', 'byLeague[k] = byLeague[k] || { league_name: null, rows: 0 };'],
  ['tracked rows count the untracked', 'rowsInFieldTrackedLeagues: tracked ? ng.filter((r) => tracked.has(', 'rowsInFieldTrackedLeagues: tracked ? ng.filter((r) => !tracked.has('],
  ['tracked ids are unsorted', '[...tracked].sort((a, b) => a - b)', '[...tracked]'],
  ['a partial list answers its leagues', "verdict: partial ? 'PARTIAL' : 'ANSWERED', distinct:", "verdict: 'ANSWERED', distinct:"],
  // ---- coverage
  ['a read for a finished match is not counted', "readsForRowsNotInPlay: rows.filter((x) => x.c !== 'inplay' && x.read).length,", 'readsForRowsNotInPlay: 0,'],
  ['next-goal rows missing from events/live are not counted', 'nextGoalRowsNotInEventsLive: ng.filter((r) => !liveIds.has(String(r?.event?.id))).length,', 'nextGoalRowsNotInEventsLive: 0,'],
  ['halftime is counted as playing', 'const playing = inplay.filter((x) => !x.ht);', 'const playing = inplay;'],
  ['minute 10 is not 10+', 'x.m !== null && x.m >= 10);', 'x.m !== null && x.m > 10);'],
  ['an unknown minute is 10+', 'x.m !== null && x.m >= 10);', '(x.m === null || x.m >= 10));'],
  ['minute 10 is before 10', 'x.m !== null && x.m < 10);', 'x.m !== null && x.m < 11);'],
  ['the minute bucket boundary moves', "(x.m < 15 ? '10-14' : '15+')", "(x.m < 5 ? '10-14' : '15+')"],
  ['the gap ignores reads', 'const gap = at10.filter((x) => !x.read);', 'const gap = at10;'],
  ['the gap by period reads the status', "withoutReadByPeriod: tally(gap, (x) => x.r?.period ?? '(absent)'),", "withoutReadByPeriod: tally(gap, (x) => x.r?.status ?? '(absent)'),"],
  ['websocket_plus has no default', "const ws = (x) => x.r?.websocket_plus ?? '(absent)';", 'const ws = (x) => x.r?.websocket_plus;'],
  ['the gap by league drops the name', "`${x.r?.league_id ?? '?'}:${x.r?.league_name ?? ''}`", "`${x.r?.league_id ?? '?'}`"],
  ['reads by websocket_plus count every match', 'withReadByWebsocketPlus: tally(at10.filter((x) => x.read), ws),', 'withReadByWebsocketPlus: tally(at10, ws),'],
  ['before minute 10 has no read count', 'withRead: before10.filter((x) => x.read).length', 'withRead: 0'],
  ['an unknown minute has no read count', 'withRead: unknownMinute.filter((x) => x.read).length', 'withRead: 0'],
  ['halftime has no read count', 'withRead: inplay.filter((x) => x.ht && x.read).length', 'withRead: 0'],
  ['classes are not tallied', 'byClass: tally(rows, (x) => x.c),', 'byClass: {},'],
  ['liveRows is not the row count', 'liveRows: lv.length,', 'liveRows: 0,'],
  ['a truncated list answers its coverage', "Object.assign({ verdict: partial ? 'PARTIAL' : 'ANSWERED', listTruncated: partial }, coverageOf(lv, ng))", "Object.assign({ verdict: 'ANSWERED', listTruncated: partial }, coverageOf(lv, ng))"],
  ['an empty list gets no coverage', "A.coverage = lv === null ? unknown('events/live was not read')", "A.coverage = lv === null || ng.length === 0 ? unknown('events/live was not read')"],
  // ---- filters
  ['calls_only: a plain non-call is not a failure', "plainNonCallsInFiltered > 0 ? 'NOT_HONOURED'", "false ? 'NOT_HONOURED'"],
  ['calls_only: an empty answer is not inconsistent', "co.length === 0 && unfilteredCalls > 0 ? 'INCONSISTENT'", "false ? 'INCONSISTENT'"],
  ['calls_only: a slate with no calls reads as honoured', ': unfilteredCalls === 0 || !listHadNonCalls ?', ': !listHadNonCalls ?'],
  ['calls_only: a slate of only calls reads as honoured', ': unfilteredCalls === 0 || !listHadNonCalls ?', ': unfilteredCalls === 0 ?'],
  ['calls_only: a paused row is a plain non-call', 'co.filter((r) => !isCall(r) && r?.call_paused !== true).length', 'co.filter((r) => !isCall(r)).length'],
  ['calls_only: paused rows are not counted', 'const pausedInFiltered = co.filter((r) => !isCall(r) && r?.call_paused === true).length;', 'const pausedInFiltered = 0;'],
  ['calls_only: unfiltered calls are every row', 'const unfilteredCalls = ng.filter(isCall).length;', 'const unfilteredCalls = ng.length;'],
  ['calls_only: a block loses its reason', "unknown(raw.ng_calls_only?.blocked || `calls_only call status ${raw.ng_calls_only?.status ?? 'none'}`)", "unknown('calls_only not answered')"],
  ['league_id: honoured without a control', "allL && ctl.length === 0 ? 'HONOURED'", "allL ? 'HONOURED'"],
  ['league_id: honoured with rows from another league', "allL && ctl.length === 0 ? 'HONOURED'", "ctl.length === 0 ? 'HONOURED'"],
  ['league_id: an emptied filter reads as honoured', "lg.length === 0 ? 'EMPTY_FOR_A_LEAGUE_WITH_READS'", "false ? 'EMPTY_FOR_A_LEAGUE_WITH_READS'"],
  ['league_id: an ignored filter is never detected', "ctl.length >= ng.length ? 'NOT_HONOURED'", "false ? 'NOT_HONOURED'"],
  ['league_id: ignoring needs strictly more rows', "ctl.length >= ng.length ? 'NOT_HONOURED'", "ctl.length > ng.length ? 'NOT_HONOURED'"],
  ['league_id: no league on the rows is not noticed', 'if (!pickLeague(ng)) A.filterLeagueId', 'if (false) A.filterLeagueId'],
  ['league_id: the league used is lost', "const L = String(raw.ng_league?.leagueUsed ?? '');", "const L = '';"],
  ['league_id: the control id is not recorded', 'controlLeagueId: raw.ng_league_control?.leagueUsed ?? null,', 'controlLeagueId: null,'],
  // ---- one match and the no-read answers
  ['one match: extra keys are not listed', 'extraKeysVersusList: lk ? ok.filter((k) => !lk.includes(k)) : null,', 'extraKeysVersusList: null,'],
  ['one match: missing keys are not listed', 'missingKeysVersusList: lk ? lk.filter((k) => !ok.includes(k)) : null,', 'missingKeysVersusList: null,'],
  ['one match: compared with the first row', 'ng.find((r) => String(r?.event?.id) === String(one.id))', 'ng[0]'],
  ['no-read: the answer is not used', 'A.noReadInPlay = raw.ng_noread_pick != null ? reasonOf(raw.ng_noread)', 'A.noReadInPlay = false ? reasonOf(raw.ng_noread)'],
  ['no-read: the closed-gate reason is false', 'unknown(`next-goal not read: ${A.gate.verdict}`)', "unknown('every in-play event already had a read')"],
  ['no-read: the unread-live reason is lost', ": lv === null ? unknown('events/live was not read')", ": lv === null ? unknown('x')"],
  ['no-read: a non-200 is not an answer', "if (rec.status !== 200 || !isObj(rec.json)) return { verdict: 'ANSWERED', status: rec.status ?? null, nonStandard: true,", "if (false) return { verdict: 'ANSWERED', status: rec.status ?? null, nonStandard: true,"],
  ['finished: the not-requested reason is lost', ": !fl ? unknown('not requested: next-goal was not read')", ": !fl ? unknown('x')"],
  ['finished: the blocked reason is lost', 'unknown(`finished list blocked: ${fl.blocked}`)', "unknown('finished list blocked')"],
  ['finished: the status reason is lost', "unknown(`finished list answered status ${fl.status ?? 'none'}`)", "unknown('finished list answered')"],
  ['finished: the vocabulary seen is not named', "(status/period seen: ${Object.keys(A.finishedList.statusPeriod).join(', ') || 'none'})", '(status/period seen)'],
  ['finished: the pick is not recorded', "statusPeriod: tally(fr, (r) => `${r?.status ?? '(absent)'}/${r?.period ?? '(absent)'}`), picked: raw.ng_finished_pick ?? null }", "statusPeriod: tally(fr, (r) => `${r?.status ?? '(absent)'}/${r?.period ?? '(absent)'}`), picked: null }"],
  // ---- rate-limit headers
  ['rate-limit headers are never matched', '/ratelimit|retry-after/i.test(k)', '/zzz/i.test(k)'],
  ['retry-after is not matched', '/ratelimit|retry-after/i.test(k)', '/ratelimit/i.test(k)'],
  ['a call that never answered is counted', 'if (!isObj(rec) || rec.status == null) continue;', 'if (!isObj(rec)) continue;'],
  ['a null entry is read as a record', 'if (!isObj(rec) || rec.status == null) continue;', 'if (rec.status == null) continue;'],
  // ---- the ledger
  ['the count span is not measured', 'L.countsSpanSeconds = countAts.length > 1 ? Math.round((Math.max(...countAts) - Math.min(...countAts)) / 1000) : null;', 'L.countsSpanSeconds = null;'],
  ['the count span leaves out the open count', "['calls_since', 'calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear', 'calls_open']", "['calls_since', 'calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear']"],
  ['the page row count is the dated count', 'rows: pageRows.length, fieldCounts: fieldCounts(pageRows),', 'rows: dated.length, fieldCounts: fieldCounts(pageRows),'],
  ['the outcome tally reads the side', "outcome: tally(pageRows, (r) => r?.outcome ?? '(absent)'), side:", "outcome: tally(pageRows, (r) => r?.side ?? '(absent)'), side:"],
  ['the oldest and newest dates are swapped', 'oldestRowDate: dated.length ? dated[0] : null, newestRowDate: dated.length ? dated[dated.length - 1] : null,', 'oldestRowDate: dated.length ? dated[dated.length - 1] : null, newestRowDate: dated.length ? dated[0] : null,'],
  ['newest-first is inverted', "L.lastOffsetRowDate < p.oldestRowDate ? 'newest-first'", "L.lastOffsetRowDate > p.oldestRowDate ? 'newest-first'"],
  ['oldest-first is inverted', "L.lastOffsetRowDate > p.newestRowDate ? 'oldest-first'", "L.lastOffsetRowDate < p.newestRowDate ? 'oldest-first'"],
  ['the ledger order is guessed without dates', "!p || !p.oldestRowDate || !L.lastOffsetRowDate ? 'unknown'", "false ? 'unknown'"],
  ['an empty page gets a summary', 'if (pageRows && pageRows.length) {', 'if (pageRows) {'],
  ['the last-offset row is not read', 'if (last && last.length) {', 'if (false) {'],
  ['the last-offset keys are not kept', 'L.lastOffsetRowKeys = Object.keys(last[0] || {});', ''],
  ['the window count is the all-time count', 'countSince: cnt(raw.calls_since), since:', 'countSince: cnt(raw.calls_all), since:'],
  ['hit reads miss', 'outcomes: { hit: cnt(raw.calls_hit), miss: cnt(raw.calls_miss),', 'outcomes: { hit: cnt(raw.calls_miss), miss: cnt(raw.calls_hit),'],
  ['the all-time count is the window count', 'countAllTime: cnt(raw.calls_all),', 'countAllTime: cnt(raw.calls_since),'],
  ['a non-numeric count is a count', 'num(rec.json.count) !== null ? rec.json.count : null', 'rec.json.count !== undefined ? rec.json.count : null'],
  ['the sum leaves out open', 'const sum = o.hit + o.miss + o.nogoal + o.unclear + o.open;', 'const sum = o.hit + o.miss + o.nogoal + o.unclear;'],
  ['the partition difference is reversed', 'partitionDifference: sum - L.countSince,', 'partitionDifference: L.countSince - sum,'],
  ['one equal outcome reads as an ignored filter', 'Object.values(o).every((v) => v === L.countSince)', 'Object.values(o).some((v) => v === L.countSince)'],
  ['an empty ledger reads as an ignored filter', 'L.countSince > 0 && Object.values(o)', 'Object.values(o)'],
  ['an ignored outcome filter is not detected', "filterIgnored ? 'OUTCOME_FILTER_IGNORED'", "false ? 'OUTCOME_FILTER_IGNORED'"],
  ['a partition mismatch is called an answer', "sum === L.countSince ? 'ANSWERED' : 'PARTITION_MISMATCH'", "'ANSWERED'"],
  ['the misses are left out of the first denominator', 'hit_over_hit_miss: [o.hit, o.hit + o.miss],', 'hit_over_hit_miss: [o.hit, o.hit],'],
  ['no-goal is left out of its denominator', 'hit_over_hit_miss_nogoal: [o.hit, o.hit + o.miss + o.nogoal],', 'hit_over_hit_miss_nogoal: [o.hit, o.hit + o.miss],'],
  ['unclear is left out of its denominator', 'hit_over_hit_miss_nogoal_unclear: [o.hit, o.hit + o.miss + o.nogoal + o.unclear],', 'hit_over_hit_miss_nogoal_unclear: [o.hit, o.hit + o.miss + o.nogoal],'],
  ['the window denominator is the hits', 'hit_over_all_calls_since: [o.hit, L.countSince],', 'hit_over_all_calls_since: [o.hit, o.hit],'],
  ['the closest definition is the farthest', '.sort((a, b) => Math.abs(a[1].deltaVersusVendorAccuracy) - Math.abs(b[1].deltaVersusVendorAccuracy))[0];', '.sort((a, b) => Math.abs(b[1].deltaVersusVendorAccuracy) - Math.abs(a[1].deltaVersusVendorAccuracy))[0];'],
  ['the delta is against the wrong claim', 'Math.round((n / d - claim.accuracy) * 10000) / 10000', 'Math.round((n / d - claim.bestFixedGuess) * 10000) / 10000'],
  ['the graded delta is against the wrong claim', 'deltaVersusVendorGradedCalls: d - claim.gradedCalls }', 'deltaVersusVendorGradedCalls: d - claim.callsAt80Plus }'],
  ['accuracy is rounded to 2 places', 'Math.round((n / d) * 10000) / 10000 : null,', 'Math.round((n / d) * 100) / 100 : null,'],
  ['the claim is not the one the caller gives', 'const claim = ctx.vendorClaims || VENDOR_CLAIMS;', 'const claim = VENDOR_CLAIMS;'],
  ['the vendor claim is not attached', '      vendorClaim: claim,\n', ''],
  ['the line leaves out the gate', "(gate ${A.gate.verdict}${A.gate.status ? ' ' + A.gate.status : ''})", '(gate)'],
  ['the line leaves out the calls used', "`calls ${ctx.callsMade ?? '?'}/${ctx.callBudget ?? '?'}`", "'calls'"],
  ['the line leaves out the ledger', '`ledger: ${L.countSince ?? \'n/a\'} calls since', '`ledger: n/a calls since'],
  ['the line counts events/live rows as in play', '`events/live: ${lv.length} rows, ${c.inPlay} in play,', '`events/live: ${lv.length} rows, ${lv.length} in play,'],
  ['the line says nothing of a truncated list', '${partial ? ` (TRUNCATED: ${A.truncated.reportedCount ?? \'?\'} reported, next page not read)` : \'\'}', "${''}"],
  // ---- main(): budget, token, stop, deadline, dates, calls
  ['an integer below 1 is a budget', 'Number.isInteger(n) && n >= 1 ? n : dflt', 'Number.isInteger(n) && n >= 0 ? n : dflt'],
  ['a non-integer is a budget', 'Number.isInteger(n) && n >= 1 ? n : dflt', 'n >= 1 ? n : dflt'],
  ['the default budget is 12', 'positiveInt(process.env.CALL_BUDGET, 24)', 'positiveInt(process.env.CALL_BUDGET, 12)'],
  ['the default deadline is 4 seconds', 'positiveInt(process.env.RUN_DEADLINE_SECONDS, 400)', 'positiveInt(process.env.RUN_DEADLINE_SECONDS, 4)'],
  ['the token is not trimmed', 'TOKEN_RAW.trim()', 'TOKEN_RAW'],
  ['whitespace in the token is allowed', '/[^\\x21-\\x7e]/.test(TOKEN)', '/[^\\x20-\\x7e]/.test(TOKEN)'],
  ['a malformed token exits 0', "refusing to send it anywhere');\n    process.exit(1);", "refusing to send it anywhere');\n    process.exit(0);"],
  ['no token still calls the vendor', "if (!TOKEN) rec.blocked = 'no BSD_API_TOKEN in env';", "if (false) rec.blocked = 'no BSD_API_TOKEN in env';"],
  ['a stop is recorded but ignored', 'else if (stopped) rec.blocked', 'else if (false) rec.blocked'],
  ['the budget is off by one', 'else if (calls >= CALL_BUDGET) rec.blocked', 'else if (calls > CALL_BUDGET) rec.blocked'],
  ['the deadline is never checked', 'else if (Date.now() - START > DEADLINE_MS) rec.blocked', 'else if (false) rec.blocked'],
  ['redirects are followed', "redirect: 'error', ", ''],
  ['the token is not sent', 'Authorization: `Token ${TOKEN}`, Accept', 'Accept'],
  ['JSON is not requested', "Authorization: `Token ${TOKEN}`, Accept: 'application/json' }", 'Authorization: `Token ${TOKEN}` }'],
  ['a 429 or 401 does not stop the run', 'if (r.status === 429 || r.status === 401) stopped = String(r.status);', ''],
  ['only a 429 stops the run', 'r.status === 429 || r.status === 401', 'r.status === 429'],
  ['only a 401 stops the run', 'r.status === 429 || r.status === 401', 'r.status === 401'],
  ['the stop is set after the body is read', [['      if (r.status === 429 || r.status === 401) stopped = String(r.status);\n', ''], ['      rec.bytes = text.length;\n', '      rec.bytes = text.length;\n      if (r.status === 429 || r.status === 401) stopped = String(r.status);\n']]],
  ['response headers are not captured', 'if (SHOWN_HEADERS.test(k)) rec.headers[k] = v;', ''],
  ['ratelimit is not a shown header', '/^(ratelimit|x-ratelimit|retry-after|', '/^(x-ratelimit|retry-after|'],
  ['x-ratelimit is not a shown header', '/^(ratelimit|x-ratelimit|retry-after|', '/^(ratelimit|retry-after|'],
  ['retry-after is not a shown header', '|x-ratelimit|retry-after|x-cache-status', '|x-ratelimit|x-cache-status'],
  ['the 90-day window is 91 days', 'VENDOR_CLAIMS.windowDays * 86400000', '(VENDOR_CLAIMS.windowDays + 1) * 86400000'],
  ['yesterday is two days ago', 'const yesterday = new Date(Date.parse(TS) - 86400000)', 'const yesterday = new Date(Date.parse(TS) - 2 * 86400000)'],
  ['the finished list is skipped', "await get('finished_list', `/api/v2/events/?date_from=${yesterday}&date_to=${yesterday}&limit=50`);", ''],
  ['the finished list ends on another day', 'date_to=${yesterday}&limit=50', 'date_to=${d90}&limit=50'],
  ['calls_only is asked without the limit', "'/api/v2/next-goal/?calls_only=true&limit=200'", "'/api/v2/next-goal/?calls_only=true'"],
  ['the league control is the league', '`/api/v2/next-goal/?league_id=${pick.control}&limit=200`', '`/api/v2/next-goal/?league_id=${pick.league}&limit=200`'],
  ['the one-match call uses the last row', 'const first = ng[0]?.event?.id;', 'const first = ng[ng.length - 1]?.event?.id;'],
  ['a row without an id gets a one-match call', "if (first != null) await get('ng_one'", "await get('ng_one'"],
  ['the no-read pick needs list rows', 'const noRead = pickNoRead(lv, ng);', 'const noRead = ng.length ? pickNoRead(lv, ng) : null;'],
  ['a closed ledger is still paged', 'if (raw.calls_since.status === 200) {', 'if (true) {'],
  ['the last-offset call is one past the end', 'offset=${total - 1}', 'offset=${total}'],
  ['a one-row ledger gets a last-offset call', 'if (total && total > 1)', 'if (total && total >= 1)'],
  ['unclear is not counted', "['hit', 'miss', 'nogoal', 'unclear', 'open']", "['hit', 'miss', 'nogoal', 'open']"],
  ['a closed gate still lists finished events', 'if (ng !== null) {', 'if (true) {'],
  ['an analysis error is not caught', 'try { analysis = analyse(raw, ctx); } catch (e) {', 'try { analysis = analyse(raw, ctx); } catch (e) { throw e;'],
  ['an analysis error is not recorded', "analysisError = String(e && e.stack ? e.stack : e).split('\\n').slice(0, 4).join(' | ');", 'analysisError = null;'],
  ['an analysis error still advances latest', 'reachedTarget: !analysisError && (', 'reachedTarget: ('],
  ['only the list decides latest', 'definiteGate(analysis.gate) || definiteGate(analysis.gateCalls)', 'definiteGate(analysis.gate)'],
  ['only the ledger decides latest', 'definiteGate(analysis.gate) || definiteGate(analysis.gateCalls)', 'definiteGate(analysis.gateCalls)'],
  ['any 200 decides latest', 'reachedTarget: !analysisError && (definiteGate(analysis.gate) || definiteGate(analysis.gateCalls)),', 'reachedTarget: Object.values(raw).some((r) => isObj(r) && r.status === 200),'],
  ['latest is always written', 'if (out.reachedTarget) {', 'if (true) {'],
  ['samples are not size-limited', 't.length <= 20000 ? row : { omitted:', 'true ? row : { omitted:'],
  ['the sample limit is huge', 't.length <= 20000', 't.length <= 20000000'],
  ['an unserialisable sample is fatal', "catch (e) { return { omitted: 'the row could not be serialised' }; }", 'catch (e) { throw e; }'],
  ['the outbox directory is not made', "fs.mkdirSync('outbox', { recursive: true });", ''],
  ['the per-call log lacks the count', 'console.log(`call ${calls}/${CALL_BUDGET} ${key} -> ', 'console.log(`call ${key} -> '],
  ['the coverage is not printed', "console.log('\\n=== COVERAGE ===\\n' + out.coverageLine);", ''],
  ['the verdicts omit the id space', '` idSpace=${pick(\'idSpace\')}', "` idSpace=x"],
  ['the default base is mistyped', "process.env.BSD_BASE || 'https://sports.bzzoiro.com'", "process.env.BSD_BASE || 'https://sport.bzzoiro.com'"],
  ['importing the probe runs it', 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {', 'if (true) {'],
];

const BROKEN_FOR_ANALYSIS = ["s === 402 || s === 403 ? 'GATED'", "s === 402 ? 'GATED'"];
const BROKEN_FOR_RUN = ['else if (calls >= CALL_BUDGET) rec.blocked', 'else if (calls > CALL_BUDGET) rec.blocked'];
const BROKEN_IMPORT_RUNS_MAIN = ['if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {', 'if (true) {'];

// kind: 'blind' = the mutated check must PASS the broken probe the real check fails; 'red' = it must FAIL the real probe
const CHECK_MUTATIONS = [
  ['blind', CHECK, 'eq never fails', 'if (stable(got) !== stable(want)) {', 'if (false) {', BROKEN_FOR_ANALYSIS],
  ['blind', CHECK, 'the exit code ignores failures', 'finished = true;\nprocess.exit(failed === 0 ? 0 : 1);', 'finished = true;\nprocess.exit(0);', BROKEN_FOR_ANALYSIS],
  ['blind', CHECK, 'an early exit is not noticed', "process.on('exit', (code) => {", "process.on('never', (code) => {", BROKEN_IMPORT_RUNS_MAIN],
  ['red', CHECK, 'MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 19;', 'export const MIN_SCENARIOS = 20;'],
  ['red', CHECK, 'MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 241;', 'export const MIN_ASSERTIONS = 242;'],
  ['blind', RUN_CHECK, 'the run check: eq never fails', 'if (stable(got) !== stable(want)) {', 'if (false) {', BROKEN_FOR_RUN],
  ['blind', RUN_CHECK, 'the run check: the exit code ignores failures', 'finished = true;\nprocess.exit(failed === 0 ? 0 : 1);', 'finished = true;\nprocess.exit(0);', BROKEN_FOR_RUN],
  ['red', RUN_CHECK, 'the run check: MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 22;', 'export const MIN_SCENARIOS = 23;'],
  ['red', RUN_CHECK, 'the run check: MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 102;', 'export const MIN_ASSERTIONS = 103;'],
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
console.log(`baseline: the analysis check on the real probe exits ${b1.status}, the run check ${b2.status}`);
if (b1.status !== 0 || b2.status !== 0) { console.log('FAIL  a check is already red; every mutation would be "caught" for the wrong reason'); process.exit(1); }

console.log(`\nHALF 1: the probe, broken (${SOURCE_MUTATIONS.length} mutations, analysis check first, then the run check)`);
await pool(SOURCE_MUTATIONS, 3, async ([name, a, b], i) => {
  const edits = Array.isArray(a) ? a : [[a, b]];
  const r = applyEdits(srcText, edits, name);
  if (r.error) { notApplied++; lines[i] = `  ${r.error}  [${name}]`; return; }
  const f = path.join(tmp, `probe-${i}.mjs`);
  fs.writeFileSync(f, r.text);
  if (!parses(f)) { notApplied++; lines[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return; }
  const x = await exec(CHECK, f);
  if (red(x)) { caught++; caughtAnalysis++; lines[i] = `  caught       ${name}  (analysis)`; return; }
  const y = await exec(RUN_CHECK, f);
  if (red(y)) { caught++; caughtRun++; lines[i] = `  caught       ${name}  (run)`; return; }
  notCaught++; lines[i] = `  NOT CAUGHT   ${name}  (analysis exit ${x.status}, run exit ${y.status})`;
});
console.log(lines.join('\n'));

console.log('\nHALF 2: the checks, broken');
const mk = (broken) => { const r = applyEdits(srcText, [broken], 'broken probe'); if (r.error) { console.log(`  ${r.error}`); process.exit(1); } return r.text; };
const brokenFiles = new Map();
const brokenFile = (spec) => { const key = spec[0]; if (!brokenFiles.has(key)) { const f = path.join(tmp, `broken-${brokenFiles.size}.mjs`); fs.writeFileSync(f, mk(spec)); brokenFiles.set(key, f); } return brokenFiles.get(key); };
const half2 = [];
await pool(CHECK_MUTATIONS, 2, async ([kind, file, name, a, b, broken], i) => {
  const text = fs.readFileSync(file, 'utf8');
  const r = applyEdits(text, [[a, b]], name);
  if (r.error) { notApplied++; half2[i] = `  ${r.error}  [${name}]`; return; }
  const f = path.join(tmp, `check-${i}.mjs`);
  fs.writeFileSync(f, r.text);
  if (!parses(f)) { notApplied++; half2[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return; }
  let ok, shown;
  if (kind === 'blind') {
    const real = await exec(file, brokenFile(broken));
    const mutated = await exec(f, brokenFile(broken));
    ok = red(real) && mutated.status === 0 && !red(mutated);
    shown = `real check exit ${real.status}, mutated check exit ${mutated.status} on the broken probe`;
  } else {
    const mutated = await exec(f, SRC);
    ok = red(mutated);
    shown = `mutated check exit ${mutated.status} on the real probe`;
  }
  if (ok) { caught++; half2[i] = `  caught       ${name}  (${kind}: ${shown})`; } else { notCaught++; half2[i] = `  NOT CAUGHT   ${name}  (${kind}: ${shown})`; }
});
console.log(half2.join('\n'));

const moved = REAL.filter((f) => sha(f) !== before[f]);
const leftover = strays().filter((f) => !strayBefore.has(f));
for (const f of leftover) fs.rmSync(path.join('outbox', f), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
const total = SOURCE_MUTATIONS.length + CHECK_MUTATIONS.length;
console.log(`\nmutations ${total}: caught ${caught} (probe mutants: ${caughtAnalysis} by the analysis check, ${caughtRun} by the run check), NOT CAUGHT ${notCaught}, NOT APPLIED ${notApplied}; real files moved: ${moved.length}; stray artifacts removed: ${leftover.length}`);
if (moved.length) console.log(`FAIL  the real file(s) changed: ${moved.join(', ')}`);
process.exit(notCaught === 0 && notApplied === 0 && moved.length === 0 ? 0 : 1);
