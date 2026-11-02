// Judge a workflow's job-level `if:` for the `schedule` event, without running it.
//
// WHY THIS EXISTS. nfl-epa-route-probe.yml carried
//
//   if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}
//
// On a `schedule` tick the first operand is false, and the second reads a payload
// key that only a `workflow_run` event has: `null == 'success'` is false. The job
// was skipped, the run finished "skipped", and the Actions page shows that green.
// 66 of 66 scheduled runs, 2026-08-27 to 2026-11-01, executed no step. The
// dead-cron watch could not see it either, because it counted only `failure`.
//
// A parser cannot catch this: the file is valid. A runtime check cannot: the run
// is green. It is decidable from the file, because the context a scheduled run
// sees is small and fixed.
//
// THREE-VALUED. A condition is true, false, or UNDECIDED. Only "false" can fail a
// workflow. `vars.X == 'on'`, `github.ref == ...` and many other reads are values
// this file cannot know, and a check that guesses them blocks legitimate changes.
// Undecided counts as "may run", and the coverage line says how many `if:` fell
// there, so the blind spot is printed rather than assumed away (Rule 91).
//
// What a scheduled run's context holds, and what this models:
//   github.event_name            'schedule'
//   github.event.<k> for k in ABSENT_ON_SCHEDULE   null: those payload keys belong
//                                to other events (workflow_run, pull_request, ...)
//   inputs.*                     null: the inputs context is filled only for
//                                workflow_dispatch and workflow_call
//   everything else              undecided
// Operators follow GitHub's rules: `==` ignores string case; mismatched types
// are coerced to numbers (null -> 0, 'success' -> NaN); `&&` and `||` return an
// operand, not a boolean.

export const UNK = Symbol('unknown');            // nothing is known about the value
export const UNK_T = Symbol('unknown-truthy');   // unknown, but certainly truthy
export const UNK_F = Symbol('unknown-falsy');    // unknown, but certainly falsy
const DYN = Symbol('dynamic');                   // an index this file cannot resolve
const isUnk = (v) => v === UNK || v === UNK_T || v === UNK_F;

// Payload keys that only other events carry. Each is documented as event-specific;
// the list is deliberately short, because a key missing from it is merely
// undecided, while a key wrongly listed would make a healthy workflow fail.
export const ABSENT_ON_SCHEDULE = new Set([
  'workflow_run', 'inputs', 'pull_request', 'head_commit', 'commits', 'pusher',
  'release', 'issue', 'comment', 'client_payload',
]);

/** true / false when the value's truthiness is certain, null when it is not. */
export function truth(v) {
  if (v === UNK_T) return true;
  if (v === UNK_F) return false;
  if (v === UNK) return null;
  return !(v === false || v === 0 || v === '' || v === null || (typeof v === 'number' && Number.isNaN(v)));
}

// ── lexer ────────────────────────────────────────────────────────────────
const PUNCT2 = ['==', '!=', '<=', '>=', '&&', '||'];
const PUNCT1 = '()[].,!<>*';

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= src.length) throw new Error('unterminated string');
        if (src[j] === "'") {
          if (src[j + 1] === "'") { s += "'"; j += 2; continue; }
          break;
        }
        s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest);
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const two = PUNCT2.find((p) => rest.startsWith(p));
    if (two) { out.push({ t: 'p', v: two }); i += 2; continue; }
    if (PUNCT1.includes(c)) { out.push({ t: 'p', v: c }); i++; continue; }
    throw new Error(`unexpected character ${JSON.stringify(c)}`);
  }
  return out;
}

// ── parser: || < && < == != < relational < ! < . [] ───────────────────────
function parse(tokens) {
  let k = 0;
  const isP = (v) => tokens[k] !== undefined && tokens[k].t === 'p' && tokens[k].v === v;
  const eat = (v) => { if (!isP(v)) throw new Error(`expected ${v}`); k++; };
  const withPart = (n, part) => (n.t === 'path' ? { t: 'path', parts: [...n.parts, part] } : { t: 'path', parts: [DYN] });

  function or() { let l = and(); while (isP('||')) { k++; l = { t: 'or', l, r: and() }; } return l; }
  function and() { let l = eq(); while (isP('&&')) { k++; l = { t: 'and', l, r: eq() }; } return l; }
  function eq() {
    let l = rel();
    while (isP('==') || isP('!=')) { const op = tokens[k++].v; l = { t: 'cmp', op, l, r: rel() }; }
    return l;
  }
  function rel() {
    let l = unary();
    while (isP('<') || isP('<=') || isP('>') || isP('>=')) { const op = tokens[k++].v; l = { t: 'cmp', op, l, r: unary() }; }
    return l;
  }
  function unary() { if (isP('!')) { k++; return { t: 'not', x: unary() }; } return postfix(); }
  function postfix() {
    let n = primary();
    while (isP('.') || isP('[')) {
      if (isP('.')) {
        k++;
        if (isP('*')) { k++; n = withPart(n, DYN); continue; }
        const t = tokens[k];
        if (t === undefined || t.t !== 'id') throw new Error('expected a property name');
        k++;
        n = withPart(n, t.v);
      } else {
        k++;
        const inner = or();
        eat(']');
        n = withPart(n, inner.t === 'lit' && typeof inner.v === 'string' ? inner.v : DYN);
      }
    }
    return n;
  }
  function primary() {
    const t = tokens[k];
    if (t === undefined) throw new Error('unexpected end');
    if (t.t === 'num' || t.t === 'str') { k++; return { t: 'lit', v: t.v }; }
    if (t.t === 'id') {
      k++;
      if (t.v === 'true') return { t: 'lit', v: true };
      if (t.v === 'false') return { t: 'lit', v: false };
      if (t.v === 'null') return { t: 'lit', v: null };
      if (isP('(')) {
        k++;
        const args = [];
        if (!isP(')')) { args.push(or()); while (isP(',')) { k++; args.push(or()); } }
        eat(')');
        return { t: 'call', name: t.v.toLowerCase(), args };
      }
      return { t: 'path', parts: [t.v] };
    }
    if (isP('(')) { k++; const e = or(); eat(')'); return e; }
    throw new Error(`unexpected ${t.v}`);
  }
  const ast = or();
  if (k !== tokens.length) throw new Error(`unexpected ${tokens[k].v}`);
  return ast;
}

// ── evaluator ────────────────────────────────────────────────────────────
function resolve(parts, ctx) {
  if (parts.includes(DYN)) return UNK;
  const p = parts.map((x) => String(x).toLowerCase());
  if (p[0] === 'github') {
    if (p.length === 2 && p[1] === 'event_name') return ctx.eventName;
    if (ctx.eventName === 'schedule' && p.length >= 3 && p[1] === 'event' && ABSENT_ON_SCHEDULE.has(p[2])) return null;
    return UNK;
  }
  if (ctx.eventName === 'schedule' && p[0] === 'inputs' && p.length >= 2) return null;
  return UNK;
}

// GitHub's coercion: null -> 0, true -> 1, false -> 0, '' -> 0, a numeric string
// -> its number, any other string -> NaN. A string this cannot place with
// certainty (hex, 'Infinity', anything holding a digit it does not recognise)
// is UNK rather than a guess.
function toNum(v) {
  if (v === null || v === false) return 0;
  if (v === true) return 1;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v === '') return 0;
    if (/^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
    if (!/\d/.test(v) && !/infinity|nan/i.test(v)) return NaN;
  }
  return UNK;
}

function looseEq(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (a === null && b === null) return true;
  const x = toNum(a), y = toNum(b);
  if (x === UNK || y === UNK) return UNK;
  return x === y;   // NaN === NaN is false, as in GitHub
}

function compare(op, a, b) {
  if (isUnk(a) || isUnk(b)) return UNK;
  if (op === '==' || op === '!=') {
    const e = looseEq(a, b);
    if (e === UNK) return UNK;
    return op === '==' ? e : !e;
  }
  if (typeof a === 'string' && typeof b === 'string') return UNK;   // string ordering is not modelled
  const x = toNum(a), y = toNum(b);
  if (x === UNK || y === UNK) return UNK;
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

function callFn(name, args) {
  switch (name) {
    case 'always': case 'success': return true;
    case 'failure': case 'cancelled': return false;
    case 'contains': case 'startswith': case 'endswith': {
      const [a, b] = args;
      if (typeof a !== 'string' || typeof b !== 'string') return UNK;
      const x = a.toLowerCase(), y = b.toLowerCase();
      return name === 'contains' ? x.includes(y) : name === 'startswith' ? x.startsWith(y) : x.endsWith(y);
    }
    default: return UNK;   // format, join, toJSON, fromJSON, hashFiles: values this file cannot know
  }
}

function evaluate(n, ctx) {
  switch (n.t) {
    case 'lit': return n.v;
    case 'path': return resolve(n.parts, ctx);
    case 'not': { const t = truth(evaluate(n.x, ctx)); return t === null ? UNK : !t; }
    case 'and': {
      const l = evaluate(n.l, ctx), tl = truth(l);
      if (tl === false) return l;
      if (tl === true) return evaluate(n.r, ctx);
      return truth(evaluate(n.r, ctx)) === false ? UNK_F : UNK;
    }
    case 'or': {
      const l = evaluate(n.l, ctx), tl = truth(l);
      if (tl === true) return l;
      if (tl === false) return evaluate(n.r, ctx);
      return truth(evaluate(n.r, ctx)) === true ? UNK_T : UNK;
    }
    case 'cmp': return compare(n.op, evaluate(n.l, ctx), evaluate(n.r, ctx));
    case 'call': return callFn(n.name, n.args.map((a) => evaluate(a, ctx)));
    default: throw new Error(`bad node ${n.t}`);
  }
}

/** The verdict on one `if:` value as the YAML parser hands it over.
 *  verdict: true (runs), false (provably skipped), null (undecided); `why` says
 *  which of the four ways it was reached, so the coverage line can count them. */
export function judgeIf(value, ctx = { eventName: 'schedule' }) {
  if (value === undefined) return { verdict: true, why: 'no if' };
  if (typeof value === 'boolean') return { verdict: value, why: 'literal' };
  if (typeof value === 'number') return { verdict: truth(value), why: 'literal' };
  if (typeof value !== 'string') return { verdict: null, why: 'unparseable' };
  let src = value.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (wrapped && !wrapped[1].includes('${{') && !wrapped[1].includes('}}')) src = wrapped[1];
  else if (src.includes('${{')) return { verdict: null, why: 'template' };
  let v;
  try { v = evaluate(parse(tokenize(src)), ctx); }
  catch (e) { return { verdict: null, why: 'unparseable' }; }
  const t = truth(v);
  return t === null ? { verdict: null, why: 'unknown' } : { verdict: t, why: 'decided' };
}

// ── the workflow-level rule ──────────────────────────────────────────────
/** Does the parsed workflow declare a `schedule` trigger? YAML 1.1 parses the bare
 *  key `on` as the boolean true, which an object holds under 'true'. */
export function hasSchedule(doc) {
  const t = doc && (doc.on ?? doc['true']);
  if (t === undefined || t === null) return false;
  if (typeof t === 'string') return t === 'schedule';
  if (Array.isArray(t)) return t.includes('schedule');
  return typeof t === 'object' && Object.prototype.hasOwnProperty.call(t, 'schedule');
}

const hasNeeds = (job) => (Array.isArray(job.needs) ? job.needs.length > 0 : job.needs !== undefined && job.needs !== null && job.needs !== '');

/** A scheduled workflow is a finding when EVERY root job (one with no `needs`) is
 *  provably skipped on a `schedule` event. One runnable root, or one whose
 *  condition cannot be decided, is enough to clear it: the rule claims only what
 *  it can prove. Jobs downstream of a skipped root are not the question; a
 *  workflow whose roots never run has already stopped doing its work. */
export function judgeWorkflow(doc) {
  if (!hasSchedule(doc)) return { scheduled: false, roots: [], findings: [] };
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? Object.entries(doc.jobs) : [];
  const roots = jobs
    .filter(([, j]) => j && typeof j === 'object' && !hasNeeds(j))
    .map(([name, j]) => ({ name, expr: j.if, ...judgeIf(j.if) }));
  const findings = [];
  if (roots.length && roots.every((r) => r.verdict === false)) {
    const list = roots.map((r) => `${r.name} (if: ${String(r.expr).replace(/\s+/g, ' ').trim()})`).join('; ');
    findings.push(`scheduled, but every root job is provably skipped on a schedule event: ${list}. `
      + 'Each tick finishes "skipped", which the Actions page shows green, and runs no step.');
  }
  return { scheduled: true, roots, findings };
}

/** What was judged, and what was not. A check that prints only its verdict cannot
 *  be told apart from one that looked at nothing. */
export function coverageLine(results) {
  const sched = results.filter((r) => r.scheduled);
  const roots = sched.flatMap((r) => r.roots);
  const count = (f) => roots.filter(f).length;
  const noRoot = sched.filter((r) => r.roots.length === 0).length;
  return `scheduled-job check: ${sched.length} of ${results.length} workflow(s) declare a schedule`
    + (noRoot ? ` (${noRoot} with no root job, not judged)` : '')
    + `; ${roots.length} root job(s) judged on a schedule event: `
    + `${count((r) => r.verdict === true)} run, ${count((r) => r.verdict === false)} skipped, `
    + `${count((r) => r.verdict === null)} undecided `
    + `(${count((r) => r.why === 'unknown')} read a value this file cannot know, `
    + `${count((r) => r.why === 'unparseable')} did not parse, ${count((r) => r.why === 'template')} are text templates)`;
}
