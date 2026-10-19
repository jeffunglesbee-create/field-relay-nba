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
export function blankCommentsAndStrings(src) {
    let out = '', i = 0;
    const stack = [];            // 'tpl' for a template, 'code' for a ${...} inside one
    let braces = 0;
    const blank = (c) => (c === '\n' ? '\n' : ' ');
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        const inTpl = stack.length && stack[stack.length - 1] === 'tpl';
        if (inTpl) {
            if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
            if (c === '`') { stack.pop(); out += c; i++; continue; }
            if (c === '$' && d === '{') { stack.push('code'); out += '${'; i += 2; braces = 0; continue; }
            out += c; i++; continue;
        }
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
        if (c === '/' && d === '*') {
            out += '  '; i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++; }
            if (i < src.length) { out += '  '; i += 2; }
            continue;
        }
        if (c === "'" || c === '"') {
            out += c; i++;
            while (i < src.length && src[i] !== c && src[i] !== '\n') {
                if (src[i] === '\\') { out += '  '; i += 2; continue; }
                out += ' '; i++;
            }
            if (i < src.length) { out += src[i]; i++; }
            continue;
        }
        if (c === '`') { stack.push('tpl'); out += c; i++; continue; }
        if (stack.length && stack[stack.length - 1] === 'code') {
            if (c === '{') braces++;
            if (c === '}') { if (braces === 0) { stack.pop(); out += c; i++; continue; } braces--; }
        }
        out += c; i++;
    }
    return out;
}
