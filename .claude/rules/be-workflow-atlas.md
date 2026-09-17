---
paths:
  - "{docs/atlas/src/content/atlas/be-workflow.mdx,docs/atlas/src/diagrams/be-workflow.svg}"
---

## The /be Atlas note is retired history

The Atlas note **`docs/atlas/src/content/atlas/be-workflow.mdx`** and its diagram
**`docs/atlas/src/diagrams/be-workflow.svg`** (published at
<https://kolu.dev/atlas/be-workflow.html>) map the `/be` pipeline — the skill
chain that took a task to a reviewed, CI-green PR.

**That pipeline no longer exists in this repo.** `/be`, `/be-review`, and every
gauntlet skill the diagram links to were deleted along with the `srid/agency`
dependency, which is why this note is now a record rather than a description of
live machinery. Nothing points at it, and there is nothing for it to track.

So the old sync obligation is gone, and the note is **not** a place to document
the current workflow. Do not extend it, and do not "fix" it to match a pipeline
kolu no longer runs — a note that quietly drifts into describing something else
is worse than one that is honestly dated. It exists so that a reader can still
see how kolu shipped before, and follow the links to the source of each skill the
pipeline used.

Edit it only if you are deliberately correcting the historical record, and then
keep the pair consistent:

- The SVG is **hand-authored and layout-dependent** — re-author it wholesale
  rather than coordinate-patching.
- Then run the Atlas sync per `/atlas`: `just atlas::build`, stage
  `docs/atlas/dist/`, and `just atlas::check-sync` (the `ci::atlas-sync` gate).
