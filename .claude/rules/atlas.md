---
paths:
  - "docs/atlas/**"
---

## The Atlas — keep the rendered HTML in sync

Notes are authored as markdown/MDX in `docs/atlas/src/content/atlas/` and render
to committed, self-contained HTML in `docs/atlas/dist/` (reviewable in kolu's
Code tab, no dev server). **Authoring or editing a note? Load the `/atlas`
skill** for frontmatter, the component kit, and the preview links.

The invariant whenever you touch Atlas content:

- **Regenerate + commit in the same change** — after you add, edit, rename, or
  remove a note (or change the Astro setup), run `just atlas::build` and stage
  `docs/atlas/dist/`. **Never hand-edit the generated `dist/`.**
- **Enforced** — `ci::atlas-sync` (`just atlas::check-sync`) rebuilds and fails
  if the committed `dist/` is stale or host-dependent, so forgetting to
  regenerate is caught, not silently merged.
- **Finished feature plans archive, they do not linger** — when a feature
  plan-of-record reaches `status: implemented`, delete the note and add a row to
  `archived-notes.mdx` (reparent children, retarget links, rebuild). Full
  procedure: `/atlas` skill §4 Lifecycle. Do not leave a shipped build plan as a
  living page.
