# CC-CMD-2026-08-09-fix-completion-field-superset-regression — Result

## Status: DONE. `verify` green on `1466df19`. **Confidence: 97.**

## Task 1 — the check, decoded and read before touching anything

The step fetches `src/index.js` via GitHub's **JSON contents API**, then:
- extracts `COMPLETION_FIELDS` with `re.search(r"const COMPLETION_FIELDS = \[(.*?)\];")`
- builds a block per route: from `if (pathname === '<route>'` to the next
  `/archive/` marker
- asserts every field appears in the `/archive/game` and
  `/archive/score-by-id` blocks

**Asserts:** each completion field is textually present in both route bodies.

## Task 2 — reproduced, and the assertion was exonerated

Ran the decoded logic locally:
```
HEAD                :  /archive/score-by-id 8083 B, /archive/game 21795 B, MISSING: none
before c8849d9b     :  identical, MISSING: none
```
**Both pass.** So the assertion was never the problem, and the region-parse
fragility I hypothesised in the CC-CMD was wrong.

The real CI error, read rather than guessed:
```
COMPLETION_FIELDS constant not found in src/index.js
```
The constant is present. **The file was never fetched.**
```
src/index.js    1,057,532 bytes      (1 MiB = 1,048,576)
contents API    size=1057532  content len=0  encoding='none'
```
GitHub's JSON contents API silently stops returning content above 1 MiB —
HTTP 200, empty string, no error. Every check using that helper began
asserting against an **empty string**.

## Task 3 — fixed the check, not the handler

Three payloads in `deploy.yml` share that `fetch_file`. All three patched
to `Accept: application/vnd.github.raw` and read the body directly — no
base64, no size ceiling. **Assertions unchanged**, deliberately: this gate
exists because completion fields silently missing from one write path is a
real shipped bug class, and relaxing it to go green would hide that
permanently.

Proven against the live API **before** pushing:
```
raw fetch bytes: 1046150
COMPLETION_FIELDS found: True
SOCCER_LEAGUE_LABELS found: True (18 labels)
```

**Done condition artifact:** deploy run on `1466df19`, `verify` job →
**success**.

## Correcting my own isolation

The CC-CMD attributed this to `c8849d9b`. That commit *triggered* it by
pushing the file past 1 MiB, but the defect was **latent in the workflow
all along**. Blaming the commit alone would have led a session to revert a
working feature instead of fixing the real bug.

## The finding that matters more than this fix

**Three** checks were affected — including the soccer league label check,
which has been passing green all session and was one commit away from
reporting `SOCCER_LEAGUE_LABELS constant not found` for 18 labels that are
plainly present.

That is the fourth green-but-asserting-nothing check found in this session
(after STRUCTURAL 7, the vacuous label regexes, and deploy-gate's Confirm
step), and the worst of them: it would have failed **loudly and wrongly**,
sending the next session hunting a constant that was never missing.

## Residual, named not deferred

`src/index.js` is now over 1 MiB. Any future CI check written against the
JSON contents API for this file will hit the same wall. The three in
`deploy.yml` are fixed; a new one written from the old pattern would not
be. Worth a lint or a comment at the helper — not done here, as it is
outside this CC-CMD's scope.
