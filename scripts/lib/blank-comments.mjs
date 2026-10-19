// COMMENTS AND QUOTED STRINGS BLANKED, string-aware. Shared by
// check-odds-calls-guarded.mjs and check-odds-live-disabled.mjs, so the two
// deploy-path odds checks agree on what is code. Its own module because a copy
// in each would be two definitions of "code" that can drift apart.
//
// Finding 4 of docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md: a
// guard NAMED in a comment credited a site whose real guard call was gone. The
// first fix dropped whole-line `//` comments only; the 2026-10-19 review then
// credited sites from a /* */ block, a trailing // comment, a string literal
// and the next function's doc block. This walks the text once, tracking '...', "...",
// `...` (with ${...} code inside), // and /* */, and replaces comment and
// '/" string bodies with spaces, newlines kept so line numbers hold. Template
// text is kept: billed URLs live there, and `//` inside `https://` is not a
// comment. The dropped 2026-10-18 stripper cut code after a " //" inside a
// string; this one cannot, because it knows it is in a string.
//
// REGEX LITERALS TOO (docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md,
// task 4). Until 2026-10-19 a regex was read as code, so a quote or backtick
// in one opened a string or template here that the language never opened, and
// `//` in one opened a comment. 20 lines of src/index.js blanked differently
// from acorn. A guard commented out between two regex literals holding a
// backtick was then read as code and credited, through all 25 deploy-path odds
// steps (harness case X1, measured at 4827946e). A `/` now opens a regex where
// an expression may start: after an operator or opening punctuation, `}`, a
// keyword such as `return`, or at the start. Elsewhere it divides. The regex
// body is blanked like a string body, slashes and flags kept, and a `/` inside
// a [...] class does not end it. Measured against acorn's tokenizer over
// src/index.js, src/ambient-do.js and src/wp-resolver.js (2026-10-19): 0 lines
// differ, from 265 (20 of them where the old reading also broke a string,
// template or comment, the rest regex bodies it kept as code, where a `(`,
// `[` or `{` miscounts every bracket match after it).
const BEFORE_EXPR_PUNCT = '(,=:[!&|?{};+-*%<>~^';
const BEFORE_EXPR_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new',
    'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

export function blankCommentsAndStrings(src) {
    let out = '', i = 0;
    const stack = [];            // 'tpl' for a template, 'code' for a ${...} inside one
    let braces = 0;
    // The last significant code character, ')' after a string, template or
    // regex (a value), '' at the start; the identifier ending there, if any.
    let prev = '', word = '', gap = false;
    const blank = (c) => (c === '\n' ? '\n' : ' ');
    const regexMayStart = () => prev === '' || BEFORE_EXPR_PUNCT.includes(prev) || prev === '}'
        || (/[\w$]/.test(prev) && BEFORE_EXPR_WORDS.has(word));
    const value = () => { prev = ')'; word = ''; gap = false; };
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        const inTpl = stack.length && stack[stack.length - 1] === 'tpl';
        if (inTpl) {
            if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
            if (c === '`') { stack.pop(); out += c; i++; value(); continue; }
            if (c === '$' && d === '{') { stack.push('code'); out += '${'; i += 2; braces = 0; prev = '{'; word = ''; continue; }
            out += c; i++; continue;
        }
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
        if (c === '/' && d === '*') {
            out += '  '; i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++; }
            if (i < src.length) { out += '  '; i += 2; }
            continue;
        }
        if (c === '/' && regexMayStart()) {
            out += c; i++;
            let inClass = false;
            while (i < src.length && src[i] !== '\n') {
                const r = src[i];
                if (r === '\\') { out += '  '; i += 2; continue; }
                if (r === '/' && !inClass) break;
                if (r === '[') inClass = true;
                else if (r === ']') inClass = false;
                out += ' '; i++;
            }
            if (src[i] === '/') { out += '/'; i++; }
            while (i < src.length && /[a-z]/i.test(src[i])) { out += src[i]; i++; }
            value();
            continue;
        }
        if (c === "'" || c === '"') {
            out += c; i++;
            while (i < src.length && src[i] !== c && src[i] !== '\n') {
                if (src[i] === '\\') { out += '  '; i += 2; continue; }
                out += ' '; i++;
            }
            if (i < src.length) { out += src[i]; i++; }
            value();
            continue;
        }
        if (c === '`') { stack.push('tpl'); out += c; i++; continue; }
        if (stack.length && stack[stack.length - 1] === 'code') {
            if (c === '{') braces++;
            if (c === '}') { if (braces === 0) { stack.pop(); out += c; i++; continue; } braces--; }
        }
        out += c; i++;
        if (/\s/.test(c)) { gap = true; continue; }
        word = /[\w$]/.test(c) ? (!gap && /[\w$]/.test(prev) ? word + c : c) : '';
        prev = c; gap = false;
    }
    return out;
}
