#!/usr/bin/env python3
"""AST-based empty-catch auditor using real tree-sitter parsing.

Setup: pip install tree-sitter tree-sitter-javascript
Usage: python3 scripts/audit-empty-catches.py src/index.js [start_line] [end_line]
  (line range optional -- omit both to scan the whole file)

Built 2026-07-13 after grep-based manual review repeatedly missed real
sites (multi-line catch bodies where the log call sits on the next
line, not the catch() line itself) and, separately, after discovering
the repo's prior empty-catch count (the "118" figure referenced in
codex/outbox history) only ever covered pattern 1 below -- it never
surveyed pattern 2 at all, anywhere in the file. A full-repo run with
this script found 44 genuine pattern-2 gaps that predate this tool.

Covers two distinct patterns:
  1. try { } catch (e) { ... } block statements (what the repo's own
     prior AST tool apparently already covers)
  2. .catch(callback) promise-chain calls (NOT covered by a
     block-statement-only parser -- this is the gap this session found
     manually; verifying it here with a real parser instead)
A catch is "empty" if its body (block or arrow/function body) contains
no call expressions at all other than trivial ones, and no non-comment
statements -- i.e. it does nothing observable. This deliberately
excludes comment-only bodies (a comment node has zero runtime effect).
"""
import sys
import tree_sitter_javascript as tsjs
from tree_sitter import Language, Parser

JS_LANGUAGE = Language(tsjs.language())
parser = Parser(JS_LANGUAGE)

def is_effectively_empty_block(node, src):
    """A statement_block or expression is 'empty' if it has no
    non-comment children that constitute real statements/calls."""
    if node.type == 'statement_block':
        real_children = [c for c in node.children
                          if c.type not in ('{', '}', 'comment')]
        return len(real_children) == 0
    if node.type in ('null', 'undefined'):
        return True
    if node.type == 'parenthesized_expression':
        inner = [c for c in node.children if c.type not in ('(', ')')]
        return len(inner) == 1 and is_effectively_empty_block(inner[0], src)
    return False

def audit_file(path, start_line=None, end_line=None):
    with open(path, 'rb') as f:
        src = f.read()
    tree = parser.parse(src)
    root = tree.root_node

    block_catches = []   # catch (e) { ... }
    promise_catches = []  # .catch(fn)

    def walk(node):
        line = node.start_point[0] + 1
        if start_line and (line < start_line or line > end_line):
            for c in node.children:
                walk(c)
            return
        if node.type == 'catch_clause':
            body = node.child_by_field_name('body')
            empty = is_effectively_empty_block(body, src) if body else True
            snippet = src[node.start_byte:min(node.end_byte, node.start_byte + 80)].decode('utf8', 'replace').replace('\n', ' ')
            block_catches.append((line, empty, snippet))
        if node.type == 'call_expression':
            fn = node.child_by_field_name('function')
            if fn and fn.type == 'member_expression':
                prop = fn.child_by_field_name('property')
                if prop and src[prop.start_byte:prop.end_byte] == b'catch':
                    args = node.child_by_field_name('arguments')
                    arg_nodes = [c for c in (args.children if args else []) if c.type not in ('(', ')', ',')]
                    is_empty = False
                    if len(arg_nodes) == 1:
                        cb = arg_nodes[0]
                        cb_body = cb.child_by_field_name('body')
                        if cb_body is not None:
                            is_empty = is_effectively_empty_block(cb_body, src)
                    snippet = src[node.start_byte:min(node.end_byte, node.start_byte + 80)].decode('utf8', 'replace').replace('\n', ' ')
                    promise_catches.append((line, is_empty, snippet))
        for c in node.children:
            walk(c)

    walk(root)
    return block_catches, promise_catches

if __name__ == '__main__':
    path = sys.argv[1]
    start = int(sys.argv[2]) if len(sys.argv) > 2 else None
    end = int(sys.argv[3]) if len(sys.argv) > 3 else None
    blocks, promises = audit_file(path, start, end)

    empty_blocks = [b for b in blocks if b[1]]
    empty_promises = [p for p in promises if p[1]]

    print(f"=== catch(e){{}} block statements: {len(blocks)} total, {len(empty_blocks)} empty ===")
    for line, empty, snippet in empty_blocks:
        print(f"  L{line}: {snippet}")
    print()
    print(f"=== .catch(callback) promise chains: {len(promises)} total, {len(empty_promises)} empty ===")
    for line, empty, snippet in empty_promises:
        print(f"  L{line}: {snippet}")
    print()
    print(f"TOTAL genuinely empty (both patterns): {len(empty_blocks) + len(empty_promises)}")
