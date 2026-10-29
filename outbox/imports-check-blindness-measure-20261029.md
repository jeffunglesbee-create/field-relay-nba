# What the import check could not read before 2026-10-29

**Command:** `node scripts/measure-imports-check-blindness.mjs` at `292233f` plus the fix, 2026-10-29, read-only.
**CC-CMD:** `docs/CC-CMD-2026-10-29-imports-check-comment-stripper.md`, done condition 3.
**Denominator:** all 50 modules of `src/`; 255 exported symbols. The reference reading is
`scripts/lib/blank-comments.mjs`, which its own header says was compared with acorn's tokenizer (0 lines differ over
`src/index.js`, `src/ambient-do.js`, `src/wp-resolver.js`). That comparison was not repeated here.

```
modules read: 50 in src/
  ambient-do.js: the old first pass swallows 3396 non-blank code characters in 1 span(s), widest 9913 characters
  analytics-engine.js: the old first pass swallows 9543 non-blank code characters in 1 span(s), widest 17854 characters
  budget-helpers.js: the old first pass swallows 367 non-blank code characters in 2 span(s), widest 2326 characters
  index.js: the old first pass swallows 106014 non-blank code characters in 18 span(s), widest 80693 characters
code characters the old first pass swallowed, all modules: 119320
old three-replace chain: 0 unresolved
shared stripper, import recognition unchanged: 3 unresolved
    index.js: computeOddsStory() from odds-story.js
    index.js: checkAllSources() from stale-data-sentinel.js
    index.js: detectEliminationTraps() from wc-tournament-projections.js
shared stripper + dynamic-import binding (the check now): 0 unresolved
```

**Reading it.** The old reading finds 0 unresolved because it did not read 119,320 characters of code, including 106,014
of `src/index.js`. Reading everything finds 3 unresolved, each a valid `const { name } = await import('./module.js')`
(`src/index.js` lines 12124, 11989, 12244) that the check did not recognise as an import. With that recognised, 0
unresolved: **no import is missing today.** The check was blind, not the code broken.

**Also found, not in the table:** the old string pass replaced a whole template literal with `""`, so a call inside
`${...}` was never read either (self-test case 15 fails on the old check for that reason).
