# Five of six citations published this morning were wrong by the afternoon

**2026-08-25.**

## The measurement

Six `src/index.js:NNNN` citations went into CC-CMDs that morning. Checked the
same day:

| cited | actually now | what was meant |
|---|---|---|
| `:7726` | `:7779` | the LEAGUES golf entry |
| `:7750` | — | `teams.find(t => t.homeAway === 'home')` |
| `:7842` | `:7906` | `sport: gm.league` |
| `:6903` | `:6934` | `buildGolfCronContext` |
| `:8235` | `:8299` | the golf brief's `eventId` |
| `:3997` | `:3997` | the auth gate — the only survivor |

Not neglect. **The same session then edited the file it had cited**, and an
insertion above a line moves every line below it. Silently.

A stale citation is worse than no citation: it points confidently at unrelated
code, and the reader trusts it precisely because it is specific.

## The fix is a better identity, not a better number

A document that quotes a distinctive fragment beside its citation can be
checked — and the fragment finds the current line by itself, which makes the
number redundant rather than merely wrong.

That convention has a second property, and it is the one that matters:
**it cannot be satisfied from memory.** Every wrong figure published on
2026-08-25 — "21 of 22 entries" against a real 21, "the AUTH CHECK at :3997"
against eleven gates, "114 occurrences" against 115 — came from recall rather
than a probe, in documents whose own first step reads *"Probe first. Do not
write from this document."* Quoting a fragment requires opening the file.

## `scripts/check-doc-citations.mjs`

Two outcomes, deliberately different in severity:

- **FATAL** — an anchored citation whose anchor is not in the file. The document
  makes a specific checkable claim and the claim is false.
- **RATCHET** — bare `path:line` citations with nothing to verify them against.
  Counted, budgeted, may not grow. Existing ones are grandfathered rather than
  retroactively rewritten; a historical CC-CMD describing what a line held in
  July is a record, not a defect.

A missing FILE is reported and never fatal. These four repos cite each other,
and jubilant-bassoon's paths are legitimately absent here — 51 of them.

## First full run

```
915 document(s) scanned
  anchored   1550
  bare          9
  no file      51
  path only   656
```

Budget set to the measured 9. The corpus was already mostly anchored, because
these documents quote code heavily — which makes 9 a tight ratchet rather than a
token one.

It also prints repairs for anchored citations whose number has drifted, eight of
them, including one written earlier today.

## A bug in the checker, caught by its own output

The first version's repair hints were confident nonsense:

```
analytics-engine.js:1197 → now :8
index.js:3798 → now :14
```

(Paths deliberately shortened here. Written in full they parse as live
citations and count against this check's own bare-citation ratchet — which is
how the ratchet caught this file on its first run. They are quoted TOOL OUTPUT
about historical line numbers, not claims about code as it stands, and the
distinction is worth keeping visible rather than budgeting around.)

`lineOf` returned the FIRST line containing the anchor, and a short quoted
fragment appears near the top of a large file. A repair hint pointing at the
wrong line is the exact defect this check was written about, reintroduced by the
check itself.

`lineOf` now returns a line only when the anchor appears **exactly once**.
Ambiguous anchors still count as anchors — they just earn no repair suggestion.
Two self-test cases cover it.

## Not done

Ported to field-relay-nba and field-laboratory. **jubilant-bassoon (915+ docs)
and field-playground have no citation check** — filed as
`docs/CC-CMD-2026-08-25-port-citation-check.md` rather than carried forward,
with the same lesson the secret scanner taught six hours earlier: a checker that
walks one tree measures one tree.
