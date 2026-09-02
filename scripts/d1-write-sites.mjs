// Every path that can issue a non-SELECT against a D1 binding.
//
// TASK 1 OF CC-CMD-2026-09-02-d1-write-provenance, and it is a task rather than
// a grep because a grep cannot answer it. The SQL is written as multi-line
// template literals, so `grep -n 'INSERT INTO'` finds the line the word is on
// and nothing about which binding it runs against or which function holds it.
// 191 `prepare` calls is a number, not an enumeration.
//
// This walks each `.prepare(` from its opening paren, balancing parens and
// tracking string/template state, so the whole argument comes back however many
// lines it spans. Then it classifies by the first SQL keyword and records the
// RECEIVER — `env.ARCHIVE_DB`, `env.DB`, `env.WC2026_DB` — because "a D1 write"
// and "a write to the archive" are different facts and the provenance call has
// to be added per site, not per file.
//
// It is committed rather than run once and pasted, so the count cannot rot: the
// next person to add a write site sees the number move.
//
// Usage:  node scripts/d1-write-sites.mjs            enumerate
//         node scripts/d1-write-sites.mjs --self-test
//         node scripts/d1-write-sites.mjs --json     machine-readable

import { readFileSync, readdirSync } from 'node:fs';

const WRITE = /^(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;

/**
 * The argument to a call whose opening paren is at `open`, with parens balanced
 * and string state tracked.
 *
 * WHY NOT A REGEX. `prepare(\`...\`)` bodies contain parens — `COUNT(*)`,
 * `COALESCE(a, b)`, `VALUES (?, ?)` — so a lazy match to the first `)` truncates
 * every interesting statement, and a greedy one swallows the rest of the file.
 * Quotes matter for the same reason: a `)` inside a string is not a close.
 */
export const argAt = (src, open) => {
    let depth = 0, i = open, quote = null;
    for (; i < src.length; i++) {
        const c = src[i], prev = src[i - 1];
        if (quote) {
            if (c === quote && prev !== '\\') quote = null;
            continue;
        }
        if (c === '`' || c === "'" || c === '"') { quote = c; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    return null;
};

/** The first SQL keyword of a prepared statement, or null. */
export const verbOf = (arg) => {
    if (typeof arg !== 'string') return null;
    // COMMENTS COME FIRST AND THEY ARE INDENTED. src/index.js:5477 puts a
    // twelve-line explanation between `prepare(` and the backtick, every line
    // after the first indented — so an anchored `^//` strip removes one line and
    // leaves the rest, and the verb never parses. That site is a CREATE TRIGGER,
    // a write, and it was the single UNREADABLE in the first run of this file.
    // Strip whitespace and comment lines alternately until neither moves.
    let body = arg;
    for (;;) {
        const next = body
            .replace(/^[\s`'"]+/, '')
            .replace(/^\/\/[^\n]*/, '')
            .replace(/^\/\*[\s\S]*?\*\//, '');
        if (next === body) break;
        body = next;
    }
    const m = /^([A-Za-z]+)/.exec(body);
    return m ? m[1].toUpperCase() : null;
};

/** Is this statement a WRITE? `SELECT` and anything unrecognised are not. */
export const isWrite = (verb) => verb !== null && WRITE.test(verb);

/**
 * The binding a `.prepare(` runs against, read backwards from the call.
 *
 * Returns `unknown` rather than guessing. A site whose receiver cannot be read
 * still needs the provenance call, and reporting it as `env.DB` would put it in
 * the wrong bucket while looking complete.
 */
export const receiverAt = (src, dotIndex) => {
    const before = src.slice(Math.max(0, dotIndex - 120), dotIndex);
    const m = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/.exec(before);
    return m ? m[1] : 'unknown';
};

/** Every `.prepare(` site in one source, classified. */
export const sitesIn = (src, file) => {
    const out = [];
    const re = /\.prepare\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const open = src.indexOf('(', m.index);
        const arg = argAt(src, open);
        const verb = verbOf(arg);
        out.push({
            file,
            line: src.slice(0, m.index).split('\n').length,
            receiver: receiverAt(src, m.index),
            verb,
            write: isWrite(verb),
            sql: (arg || '').replace(/\s+/g, ' ').replace(/^[`'"]|[`'"]$/g, '').trim().slice(0, 110),
        });
    }
    return out;
};

if (process.argv.includes('--self-test')) {
    let pass = 0, fail = 0;
    const t = (name, ok, detail) => {
        ok ? pass++ : fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
        if (!ok && detail) console.log(`      ${detail}`);
    };

    const src1 = 'env.DB.prepare(`SELECT COUNT(*) FROM t WHERE a = ?`).bind(1)';
    t('a nested paren does not end the argument',
      argAt(src1, src1.indexOf('(')) === '`SELECT COUNT(*) FROM t WHERE a = ?`',
      'COUNT(*) truncates a lazy match, which is why this is not a regex');
    const src2 = "env.DB.prepare('DELETE FROM t WHERE s = \\')\\'')";
    t('a paren INSIDE a string does not end the argument',
      argAt(src2, src2.indexOf('(')).includes('DELETE'));
    t('an unbalanced call yields null, not a truncation',
      argAt('x.prepare(`SELECT 1', 9) === null);

    t('a multi-line template is read whole', (() => {
        const s = 'env.ARCHIVE_DB.prepare(`\n  INSERT INTO g (a, b)\n  VALUES (?, ?)\n`)';
        const a = argAt(s, s.indexOf('('));
        return a.includes('INSERT INTO g') && a.includes('VALUES (?, ?)');
    })(), 'the whole point: a single-line grep sees one of these two lines');

    t('SELECT is not a write', isWrite(verbOf('`SELECT 1`')) === false);
    t('INSERT is', isWrite(verbOf('`INSERT INTO t VALUES (1)`')));
    t('UPDATE is', isWrite(verbOf('`  UPDATE t SET a = 1`')));
    t('DELETE is', isWrite(verbOf("'DELETE FROM t'")));
    t('CREATE TABLE is a write too — schema changes are writes',
      isWrite(verbOf('`CREATE TABLE IF NOT EXISTS t (a)`')));
    t('a leading newline and indent do not hide the verb',
      isWrite(verbOf('`\n            INSERT INTO t VALUES (1)`')));
    // THE SHAPE THAT WAS UNREADABLE, verbatim in structure from src/index.js:5477.
    t('AN INDENTED COMMENT BLOCK BEFORE THE SQL DOES NOT HIDE THE VERB', (() => {
        const a = '\n      // one\n      // two\n      `CREATE TRIGGER t AFTER UPDATE ON x BEGIN END`\n    ';
        return verbOf(a) === 'CREATE' && isWrite(verbOf(a));
    })(), 'an anchored ^// strip removes the first line and leaves the indented rest');
    t('a block comment before the SQL does not either',
      verbOf('/* why */ `UPDATE t SET a = 1`') === 'UPDATE');

    t('AN UNREADABLE ARGUMENT IS NOT A WRITE AND NOT A SELECT',
      verbOf(null) === null && isWrite(null) === false,
      'null must not be silently bucketed either way');

    t('the receiver is read backwards from the call',
      receiverAt('const r = await env.ARCHIVE_DB.prepare(', 30) === 'env.ARCHIVE_DB',
      receiverAt('const r = await env.ARCHIVE_DB.prepare(', 30));
    t('an unreadable receiver is `unknown`, never a guess',
      receiverAt('  )(', 3) === 'unknown');

    t('sitesIn finds every call and reports its line', (() => {
        const s = 'a\nenv.DB.prepare(`SELECT 1`)\n\nenv.ARCHIVE_DB.prepare(`INSERT INTO t VALUES (1)`)';
        const got = sitesIn(s, 'x.js');
        return got.length === 2 && got[1].line === 4 && got[1].write === true
            && got[0].write === false && got[1].receiver === 'env.ARCHIVE_DB';
    })());

    console.log(`\n${pass}/${pass + fail} checks passed`);
    process.exit(fail ? 1 : 0);
}

const files = readdirSync('src').filter(f => f.endsWith('.js')).sort();
const all = files.flatMap(f => sitesIn(readFileSync(`src/${f}`, 'utf8'), `src/${f}`));
const writes = all.filter(s => s.write);
const unreadable = all.filter(s => s.verb === null);

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total: all.length, writes: writes.length, sites: writes }, null, 2));
    process.exit(0);
}

console.log(`\n${all.length} prepare() site(s) across ${files.length} source file(s)`);
console.log(`  writes      ${writes.length}`);
console.log(`  reads       ${all.length - writes.length - unreadable.length}`);
console.log(`  UNREADABLE  ${unreadable.length}${unreadable.length ? '  <- each of these still needs the provenance call' : ''}`);

const byReceiver = new Map();
for (const w of writes) byReceiver.set(w.receiver, (byReceiver.get(w.receiver) ?? 0) + 1);
console.log('\nwrites by binding:');
for (const [r, n] of [...byReceiver.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}  ${r}`);

const byVerb = new Map();
for (const w of writes) byVerb.set(w.verb, (byVerb.get(w.verb) ?? 0) + 1);
console.log('\nwrites by verb:');
for (const [v, n] of [...byVerb.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}  ${v}`);

console.log('\nevery write site:');
for (const w of writes)
    console.log(`  ${w.file}:${String(w.line).padEnd(6)} ${w.receiver.padEnd(16)} ${w.verb.padEnd(7)} ${w.sql}`);

if (unreadable.length) {
    console.log('\nUNREADABLE — the argument did not parse; read these by hand:');
    for (const u of unreadable) console.log(`  ${u.file}:${u.line}  ${u.receiver}`);
}
