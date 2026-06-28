---
description: When the /be or /be-review skill sources change, keep the Atlas note (be-workflow) and its diagram in sync
applyTo: "{agents/.apm/skills/be/**,agents/.apm/skills/be-review/**,docs/atlas/src/content/atlas/be-workflow.mdx,docs/atlas/src/diagrams/be-workflow.svg}"
---

## Keep the /be Atlas note in sync

The Atlas note **`docs/atlas/src/content/atlas/be-workflow.mdx`** and its diagram
**`docs/atlas/src/diagrams/be-workflow.svg`** are the human-readable map of the
`/be` pipeline — published at <https://kolu.dev/atlas/be-workflow.html>. They
describe the same flow these skills implement, so an edit here can leave the map
stale.

Whenever you change `agents/.apm/skills/be/**` or `agents/.apm/skills/be-review/**` in a way a
reader would notice — a phase added/removed/reordered, a reviewer added or
dropped from the gauntlet, a skill swapped in/out of a phase, the interview
questions changing — **update the note and the diagram in the same change**:

- Edit the prose in `be-workflow.mdx` so the phase/skill description matches.
- Re-author `be-workflow.svg` (it's a hand-authored, layout-dependent SVG — edit
  it wholesale, don't coordinate-patch). Each skill node links to its
  `SKILL.md` on GitHub; add/remove/repoint nodes to match.
- Then run the Atlas sync per `/atlas`: `just atlas::build`, stage
  `docs/atlas/dist/`, and `just atlas::check-sync` (the `ci::atlas-sync` gate).

Skip only when the skill edit is invisible to a reader of the pipeline (a typo
fix, a reworded internal caution that doesn't change the flow).
