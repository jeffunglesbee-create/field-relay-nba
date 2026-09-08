// CC-CMD-2026-09-07-codex-write-nondestructive-and-recovery — the Task 0b
// follow-up, automated.
//
// WHAT IT WATCHES FOR. Task 0b could not read `field-archive`'s Time Travel
// retention window: the CLOUDFLARE_API_TOKEN authenticates (the same token
// deployed the worker minutes earlier, run 34264096616) and is refused on the
// D1 endpoint with `Authentication error [code: 10000]`. So the window is
// UNMEASURED — not absent, not present. Task 2's own gate is "0a failed AND 0b
// confirms a window", and an unmeasured window confirms nothing, so the
// side-restore never started.
//
// The one thing that unblocks it is a human action: minting a token with D1
// read permission. This watches for that and says, once, which of two terminal
// answers arrived — leaving nothing for a person to remember to re-check.
//
// WHAT IT WILL NEVER DO. It does not run the side-restore, and it must not be
// extended to. Task 2 exports production data into a scratch database; standing
// operations against production D1 are authorised case by case, never wired to a
// cron by the session that noticed they were possible. It also never runs
// `time-travel restore` — forbidden by the CC-CMD, which explains why: Time
// Travel rewinds the ENTIRE database, and 60 deployed routes read or write
// d1:ARCHIVE_DB, several on */5 and */15 crons.
//
//   node scripts/timetravel-window-watch.mjs --self-test
//   node scripts/timetravel-window-watch.mjs

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

/// The moment the 26 bodies were destroyed. A window that does not reach back
/// past this instant cannot recover them, whatever else it covers.
export const INCIDENT_ISO = '2026-09-08T03:11:00Z';

const DB = 'field-archive';
const STATUS_FILE = 'outbox/timetravel-window-watch-status.json';

// ── the classifier ──────────────────────────────────────────────────────────
//
// PURE, so the self-test can feed it the real captured output rather than a
// mock of it. Everything this file claims to detect is exercised below against
// text that actually came off a runner.
//
// WHAT IT DELIBERATELY DOES NOT KNOW: the exact shape wrangler prints on
// SUCCESS. No run in this repo's history has ever seen one — the permission has
// never existed — so any format written here would be invented, and an invented
// parser that finds nothing reports "unparseable" while an invented parser that
// finds the wrong thing reports a window that was never measured. The second is
// far worse, so this looks for an ISO-8601 timestamp anywhere in the output and
// reports UNPARSEABLE with the raw text committed when it finds none. A human
// reading a committed transcript is a worse outcome than a correct parse and a
// much better one than a confident wrong answer.
export const classify = (combinedOutput, incidentIso = INCIDENT_ISO) => {
  const text = String(combinedOutput || '');

  // Measured on 2026-09-08, verbatim from the runner. Both halves are required:
  // "failed" alone appears in npm noise, and code 10000 is Cloudflare's own
  // authentication class.
  if (/Authentication error \[code: 10000\]/.test(text)
      || (/A request to the Cloudflare API/.test(text) && /d1\/database/.test(text))) {
    return {
      state: 'AUTH_REFUSED',
      verdict: 'PENDING — the token still lacks D1 permission, so the retention window is '
             + 'unmeasured. Task 2 stays blocked. Nothing has changed and nothing is wrong.',
      terminal: false,
    };
  }

  // Any ISO-8601 instant in the output. Timestamps in the two comment lines this
  // script's own workflow writes are stripped by the caller before we get here.
  const stamps = [...text.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g)]
    .map(m => m[0])
    .map(s => (s.endsWith('Z') ? s : `${s}Z`))
    .filter(s => !Number.isNaN(Date.parse(s)));

  if (stamps.length === 0) {
    return {
      state: 'UNPARSEABLE',
      verdict: 'UNPARSEABLE — the command produced no Cloudflare auth error and no ISO-8601 '
             + 'instant. The raw output is committed beside this file; read it rather than '
             + 'trusting a parser that was never shown a successful run.',
      terminal: false,
    };
  }

  // The EARLIEST instant is the one that decides it. A success message naming
  // both ends of the window would otherwise be judged on whichever end the regex
  // happened to reach first.
  const earliest = stamps.map(s => Date.parse(s)).sort((a, b) => a - b)[0];
  const incident = Date.parse(incidentIso);
  const earliestIso = new Date(earliest).toISOString();

  return earliest <= incident
    ? {
        state: 'WINDOW_COVERS',
        earliest: earliestIso,
        verdict: `UNBLOCKED — the earliest bookmark is ${earliestIso}, which is at or before `
               + `the ${incidentIso} incident. Task 2 is runnable exactly as written: export at `
               + 'a pre-incident bookmark into a SCRATCH database, never in place. That is a '
               + 'human decision to take, not this watch\'s to make.',
        terminal: true,
      }
    : {
        state: 'WINDOW_TOO_SHORT',
        earliest: earliestIso,
        verdict: `GONE — the earliest bookmark is ${earliestIso}, after the ${incidentIso} `
               + 'incident. The 26 bodies cannot be recovered by any procedure. This is the '
               + 'honest outcome the CC-CMD anticipated; stop looking.',
        terminal: true,
      };
};

// ── self-test ───────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  let failed = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) { failed++; if (detail) console.log(`      → ${detail}`); }
  };

  // THE REAL OUTPUT, not a mock of it. Captured 2026-09-08 in
  // outbox/codex-overwrite-0b-timetravel.txt.
  const REAL_REFUSAL = `
npm warn deprecated rollup-plugin-inject@3.0.2: This package has been deprecated
✘ [ERROR] A request to the Cloudflare API (/accounts/REDACTED/d1/database/REDACTED) failed.

  Authentication error [code: 10000]

📎 It looks like you are authenticating Wrangler via a custom API token set in an environment variable.
Please ensure it has the correct permissions for this operation.
`;
  check('the REAL captured refusal reads as PENDING, not as an answer',
    classify(REAL_REFUSAL).state === 'AUTH_REFUSED',
    `got ${classify(REAL_REFUSAL).state}`);

  check('a refusal is NOT terminal — the watch keeps running',
    classify(REAL_REFUSAL).terminal === false, 'a pending state that stops watching is a dropped follow-up');

  // A window reaching back before the incident.
  const COVERS = 'Time travel: the earliest available bookmark is 2026-08-20T00:00:00Z';
  check('a bookmark BEFORE the incident reads as UNBLOCKED',
    classify(COVERS).state === 'WINDOW_COVERS', `got ${classify(COVERS).state}`);

  // A window that starts after the incident.
  const TOO_SHORT = 'Time travel: the earliest available bookmark is 2026-09-08T12:00:00Z';
  check('a bookmark AFTER the incident reads as GONE',
    classify(TOO_SHORT).state === 'WINDOW_TOO_SHORT', `got ${classify(TOO_SHORT).state}`);

  // THE TEETH. Both bookmark cases must be told apart, and the refusal must be
  // told apart from both. A classifier that always answered AUTH_REFUSED — the
  // only state this repo has ever actually observed — would pass the first two
  // rows and fail here, which is exactly the shape a check that has only ever
  // seen one outcome tends to have.
  check('THE THREE STATES ARE DISTINGUISHABLE, not one answer three times',
    new Set([classify(REAL_REFUSAL).state, classify(COVERS).state, classify(TOO_SHORT).state]).size === 3,
    'the classifier collapses two or more states into one');

  // Both ends of a window named at once: the EARLIEST decides.
  const BOTH_ENDS = 'earliest 2026-08-20T00:00:00Z, latest 2026-09-08T18:00:00Z';
  check('when both ends are printed, the EARLIEST decides',
    classify(BOTH_ENDS).state === 'WINDOW_COVERS' && classify(BOTH_ENDS).earliest === '2026-08-20T00:00:00.000Z',
    `got ${JSON.stringify(classify(BOTH_ENDS))}`);

  check('output with neither an auth error nor a timestamp is UNPARSEABLE, not a guess',
    classify('wrangler printed something nobody has seen before').state === 'UNPARSEABLE',
    'a parser that was never shown a successful run must say so rather than answer');

  // A boundary the incident time itself sits on. `<=` is deliberate: a bookmark
  // AT the incident second is the last one that could still hold the prior body.
  check('a bookmark exactly AT the incident still counts as covering it',
    classify(`earliest ${INCIDENT_ISO}`).state === 'WINDOW_COVERS',
    'the boundary is inclusive — the write landed during that second, not before it');

  console.log(`\n${failed === 0 ? 'self-test OK' : `${failed} FAILING`}`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── the run ─────────────────────────────────────────────────────────────────

// A terminal answer is recorded once and never re-asked. Without this the watch
// would keep dispatching wrangler weekly against a question it has already
// answered, and a green run would go on meaning nothing.
if (existsSync(STATUS_FILE)) {
  try {
    const prior = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
    if (prior.terminal) {
      console.log(`ALREADY ANSWERED on ${prior.checked_at}: ${prior.state}`);
      console.log(prior.verdict);
      console.log('\nNothing to do. Delete the status file to re-open the question.');
      process.exit(0);
    }
  } catch (e) {
    console.error(`status file unreadable (${e.message}) — re-asking rather than assuming`);
  }
}

let output;
try {
  output = execSync(`npx --yes wrangler@3.109.0 d1 time-travel info ${DB} 2>&1`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
  });
} catch (e) {
  // A non-zero exit is the EXPECTED path while the permission is missing —
  // wrangler exits 1 on the auth refusal. The output is what matters, not the code.
  output = `${e.stdout || ''}${e.stderr || ''}` || `spawn failed: ${e.message}`;
}

const result = classify(output);
const status = {
  checked_at: new Date().toISOString(),
  database: DB,
  incident: INCIDENT_ISO,
  ...result,
  raw_output: output.slice(0, 4000),
};
writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + '\n');

console.log(`state:   ${status.state}`);
console.log(`verdict: ${status.verdict}`);
console.log(`\n--- raw wrangler output ---\n${output.slice(0, 2000)}`);

// Exit 0 on PENDING. A weekly red run for a condition nobody has changed trains
// the reflex this repo's Rule 77 exists to prevent — a failure that is always
// there stops being read. The terminal states are loud in the artifact and in
// the commit message instead.
process.exit(0);
