#!/usr/bin/env node
// No workflow step may install a credential from a literal.
//
// WHY, and it is one file
//
// `.github/workflows/update-odds-key.yml`, deleted 2026-08-25:
//
//     name: Set ODDS_API_KEY to 20K plan key
//     run: |
//       echo "<a 32-hex literal>" | wrangler secret put ODDS_API_KEY --name field-relay-nba
//       echo "✅ ODDS_API_KEY updated to 20K plan key"
//
// The literal was the EXHAUSTED free-tier key. One `workflow_dispatch` replaced
// the working production key with a dead one and printed a green checkmark
// saying it had installed the 20K plan key. The step name, the job name and the
// success message all said one thing; the value said another.
//
// WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT
//
// The tempting rule is "a step's name must match what it does". That was
// measured before being written: over 828 steps in three repositories, a rule
// requiring every number and ALL-CAPS token in a step name to appear in its
// body produced 73 hits, essentially all of them section labels (STRUCTURAL,
// PROBE, COURIER) and subject nouns (ESPN, UEFA, OIDC). A check with that
// signal-to-noise gets deleted, so it is not here.
//
// What IS decidable is the MECHANISM rather than the claim: a command that
// installs a secret must take its value from a variable or a `secrets.*`
// expression, never from a quoted literal. That rule has no judgement in it.
// A literal cannot be rotated, cannot be audited, and is in git history the
// moment it is written -- which is true whether or not the name above it lies.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';
const SELF_TEST = process.argv.includes('--self-test');

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      → ${detail}`); failed++; }
};

// The commands that install a credential somewhere durable.
const INSTALLERS = [
  { re: /\bwrangler\s+secret\s+put\b/, what: 'wrangler secret put' },
  { re: /\bgh\s+secret\s+set\b/, what: 'gh secret set' },
  { re: /\bfly\s+secrets\s+set\b/, what: 'fly secrets set' },
  { re: /\bvercel\s+env\s+add\b/, what: 'vercel env add' },
];

/**
 * Is this line installing a secret from a LITERAL rather than a variable?
 *
 * A value is acceptable when it comes from `$VAR`, `${VAR}`, `${{ ... }}`, or a
 * file/stdin redirect. It is a literal when a quoted string of credential
 * length is piped or passed directly.
 */
export function literalSecretWrite(line) {
  const installer = INSTALLERS.find(i => i.re.test(line));
  if (!installer) return null;
  // Anything sourced indirectly is fine, and is by far the common case.
  if (/\$\{\{|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(line)) return null;
  if (/<\s*[^\s|]+|--body-file|--path\b/.test(line)) return null;
  // A quoted run of 8+ non-space characters being fed in.
  const m = line.match(/(['"])([^'"\s]{8,})\1/);
  return m ? { what: installer.what, length: m[2].length } : null;
}

if (SELF_TEST) {
  const bad = `          echo "deadbeefdeadbeefdeadbeefdeadbeef" | wrangler secret put ODDS_API_KEY --name field-relay-nba`;
  check('the deleted workflow\'s line is caught',
    literalSecretWrite(bad)?.what === 'wrangler secret put', JSON.stringify(literalSecretWrite(bad)));
  check('a single-quoted literal is caught too',
    literalSecretWrite("echo 'abcdefgh1234' | wrangler secret put X") !== null, 'missed');
  check('gh secret set with a literal body is caught',
    literalSecretWrite('gh secret set TOKEN --body "abcdefgh1234"') !== null, 'missed');

  // Every acceptable shape, because a false positive here fails a deploy.
  for (const [label, line] of [
    ['an env var', 'echo "$RELAY_SECRET" | wrangler secret put RELAY_SHARED_SECRET'],
    ['a braced env var', 'echo "${RELAY_SECRET}" | wrangler secret put X'],
    ['an Actions expression', 'echo "${{ secrets.ODDS_API_KEY }}" | wrangler secret put X'],
    ['a heredoc or file', 'wrangler secret put X < /tmp/value'],
    ['a body-file', 'gh secret set X --body-file /tmp/v'],
    ['a step that installs nothing', 'echo "deadbeefdeadbeefdeadbeefdeadbeef" > /tmp/notasecret'],
  ]) check(`${label} is allowed`, literalSecretWrite(line) === null, `flagged: ${line}`);

  // A short quoted flag value must not read as a credential.
  check('a short quoted flag is not a credential',
    literalSecretWrite('wrangler secret put X --name "app"') === null, 'flagged a short value');

  process.exit(failed === 0 ? 0 : 1);
}

if (!existsSync(DIR)) { console.log(`no ${DIR} — nothing to check`); process.exit(0); }

const found = [];
for (const f of readdirSync(DIR).filter(n => /\.ya?ml$/.test(n))) {
  const p = join(DIR, f);
  readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const hit = literalSecretWrite(line);
    if (hit) found.push(`${p}:${i + 1} — ${hit.what} with a ${hit.length}-character literal`);
  });
}

console.log(`\n${readdirSync(DIR).filter(n => /\.ya?ml$/.test(n)).length} workflow(s) scanned`);
check('no workflow installs a credential from a literal', found.length === 0,
  found.join('; ') + ' — take the value from an env var or a secrets.* expression. ' +
  'A literal cannot be rotated, cannot be audited, and is in git history the moment it is written.');

process.exit(failed === 0 ? 0 : 1);
