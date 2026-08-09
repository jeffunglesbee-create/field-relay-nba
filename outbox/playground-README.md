# field-playground

FIELD's sandbox — **part of FIELD, and permanently separate from
production.** Both things are true at once, and neither weakens the other.

Part of FIELD: the work, the probes and the findings here are FIELD's, and
a defect found here in the client (`jubilant-bassoon`) or the relay
(`field-relay-nba`) is a FIELD defect, not someone else's problem.

Separate from production: this repo never becomes a second production
surface. Nothing here ships. Anything worth keeping **graduates** into
`jubilant-bassoon` / `field-relay-nba` through the normal CC-CMD process —
it is reimplemented there under that discipline, not promoted from here.

See `docs/OPERATING-MODE.md` for the full operating rules.

**Read before starting new work here** — reduces the odds of writing
something that already exists (this happened once already: two
independent design docs collided on the same filename because neither
writer knew the other existed):

- **`docs/GROUND-UP-DESIGN.md`** — founding design spec for what FIELD
  would look like rebuilt from scratch. Nine principles, each traced to
  a real incident, revised 2026-07-24 with actual evidence from building
  against them (some confirmed, some humbled — read the revision notes).
- **`docs/SOLIDJS-BUILD.md`** — the SolidJS implementation plan behind
  the AmbientPanel + DeskCard rebuild (why SolidJS, architecture).
- **`docs/EXPERIMENTS.md`** — status index for every experiment run or
  considered here, one row each. Check this before starting something
  new — it's the fastest way to see what's done, what's scoped and
  waiting, and what's been considered and deprioritized (with why).

Current implementation: `src/components/AmbientPanel/` and
`src/components/DeskCard/`, wired to live relay data via
`src/data/relay.js`. Vite + SolidJS, no router, no TypeScript, no test
suite (exploratory — each experiment's answer *is* the output).
