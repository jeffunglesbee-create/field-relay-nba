# CC session — port the citation check to jubilant-bassoon and field-playground

**Date:** 2026-10-11
**CC-CMD:** `docs/CC-CMD-2026-08-25-port-citation-check.md` (field-relay-nba)
**Repos changed:** jubilant-bassoon `main`, field-playground `main` — direct
commits, no PRs.

## The ask said "copy verbatim". Verbatim would have been a confident green.

The document's own *Why* section warns against exactly one failure: a check
"written for one repo, reported as if it measured the problem". Copying it
unchanged into jubilant-bassoon would have reproduced that in the port of the
fix.

The relay's pattern matches `(src|scripts|workers|.github)/…` with
`.(js|mjs|py|yml|yaml|json|fs|toml)`. **jubilant-bassoon is a root-level
single-file PWA.** Counted across `docs/`, `outbox/` and the root `*.md` before
a line was written:

```
index.html  2738      src/legacy/field.js      469
smoke.js     809      src/index.js             128
sw.js        481      scripts/sync-source.mjs   68
```

The relay's pattern reaches the right-hand column and none of the left.

So the roots stay and an **allow-list of seven root files** sits beside them —
a list, not a bare-word rule, because `smoke.js` as any-word would match prose,
and "requiring a known source root" is the protection the original comment is
about. Extensions gained `html` and `jsonc`.

**The split proves it was necessary. Of the 26 bare citations, 22 are root
files:**

```
19 index.html    2 sw.js    1 smoke.js
 1 workers/field-claude-proxy/src/index.js
 1 src/legacy/field.js    1 scripts/mlb-weekly-update.py
```

## MEASURED COUNTS — the done condition, verbatim

### jubilant-bassoon

```
955 document(s) scanned
  anchored   3332  (a quoted fragment beside the citation is present in the file)
  bare       26  (a line number and nothing to verify it against)
  no file    232  (cross-repo or deleted — reported, never fatal)
  path only  2447
  COVERAGE   roots src|scripts|workers|.github/ with .{js|mjs|py|yml|yaml|json|jsonc|fs|toml|html}
             root files: index.html, sw.js, smoke.js, field_smoke.js, field_unit.js, field_utils.js, wrangler.jsonc
             anything else cited is invisible here, not clean.
```

Budget **26**. `.github/workflows/smoke-and-verify.yml`, which runs on every
push to main — not the paths-filtered `deploy-gate.yml`. The document named
that workflow and the claim was verified against HEAD rather than taken.

### field-playground

```
140 document(s) scanned
  anchored   345  (a quoted fragment beside the citation is present in the file)
  bare       0  (a line number and nothing to verify it against)
  no file    36  (cross-repo or deleted — reported, never fatal)
  path only  287
  COVERAGE   roots src|scripts|workers|.github/ with .{js|mjs|jsx|py|yml|yaml|json|jsonc|fs|toml|css|html}
             root files: none — see the measurement above the allow-list
             anything else cited is invisible here, not clean.
```

Budget **0**. `.github/workflows/build-check.yml`, which runs on every push to
main with no paths filter.

This repo IS rooted, so the roots carried over unchanged. What they did not
carry is `jsx` and `css` — **372 citations between them**, every one invisible
to the relay's extension list.

**`ROOT_FILES` is deliberately empty here, and the measurement is the reason.**
`index.html` is cited eight times with line numbers — 6671, 16869, 23978,
27160, 27168 — and *this* repo's `index.html` is **16 lines**. Those citations
are jubilant-bassoon's file, referenced across repos. Putting `index.html` on
the allow-list would check them against the wrong file, and because a 16-line
file does exist here they would not even report as missing.

## Neither green was trusted on its own (Rule 90)

`bare 0` reads the same whether there is nothing to find or the matcher found
nothing. Both ratchets were made to fail on purpose:

```
field-playground   inserted one bare citation  → 1 against a budget of 0, named, exit 1
                   removed it                  → exit 0
jubilant-bassoon   inserted one bare citation  → 27 against 26, named, exit 1
```

## Two defects in my own work

**1. The budget was measured one commit too early.** Set to 25 from a reading
taken before the commit; the rebase onto `origin/main` then brought a document
in with it. Documents 954 → 955, anchored 3329 → 3332, bare 25 → 26 — one
four-citation document, one of them bare. `CC-CMD-2026-10-10-season-gate-stays-wired.md`
cites `src/legacy/field.js:15434` inside a fenced block, where a
backtick-quoted anchor cannot sit.

**So the first push was red**, on a ratchet that was correct about a count
measured against the wrong tree. Fixed by re-measuring at the pushed HEAD and
confirming it deterministic across three runs. The second repo was measured
again *after* its rebase for that reason.

**2. An empty allow-list became an empty alternative.** Written `|()`, and all
13 self-tests went red at once — an empty alternative matches the empty string
at every position, so the pattern matched everywhere and classified nothing.
`((?!))` can never match while keeping the group **numbering** stable, which
matters because the line number is capture group 3.

## CI

| repo | run | citation step | workflow |
|---|---|---|---|
| jubilant-bassoon | `38138554268` (`84e7c24`) | **success** | **success** |
| field-playground | `38138844720` (`57dfc27`) | **success** | failure — see below |

**field-playground's `Build Check` cannot go green and it is not this work.**
It has failed on every run in its visible history, always at `Probe the latency
chart`: `47ad522`, `b4a826a`, `bb792b5`, `4d5b8dd`, `fba60cb`, `7b740ff` — six
consecutive days before this change. The citation step passes on both pushes,
and it is readable only because it sits at step ~76 against that one at ~156.

Filed rather than fixed, per Rule 69 and Rule 87.4:
`field-playground docs/CC-CMD-2026-10-11-build-check-latency-probe-red.md`.

**So the done condition is met in one repo and not the other**, and the
difference is a pre-existing failure this document did not cause and does not
authorise touching. Stated rather than reported as green.

## Self-tests

**13 in each repo.** Eight ported, five written for the local layout:

- jubilant-bassoon — a root-file citation anchors; one with no anchor is bare;
  `index.html` quoted beside a citation to `index.html` must **not** anchor it
  to itself; a root-looking name off the allow-list is not a citation at all;
  and a rooted path still carries its line number in the new group.
- field-playground — with an empty allow-list a root file is **not** a
  citation; an empty allow-list does not make the pattern match everywhere;
  plus `.jsx` and `.css` are each seen.
