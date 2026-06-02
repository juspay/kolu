---
description: Astro garden — regenerate + commit the rendered HTML when garden content changes
applyTo: "{website/src/content/garden/**,website/src/pages/garden/**,website/src/content.config.ts}"
---

## Astro garden — keep the rendered HTML in sync

Garden notes are authored as markdown in `website/src/content/garden/` and rendered by Astro to `website/dist/garden/`. The rendered `.html` is **committed** (marked generated in `.gitattributes`) so it can be reviewed directly in kolu's Code tab without running a dev server.

- After you **add, edit, rename, or remove** a garden note (or change the garden's Astro setup), **regenerate and commit the output in the same commit**: run `just website::build-garden`, then stage `website/dist/garden/`.
- Pages build with inlined styles, so each `website/dist/garden/<slug>.html` is self-contained and previews correctly in the Code tab.
- **Author markdown only** — never hand-edit the generated HTML under `website/dist/`.
- The generated index lives at `website/dist/garden/index.html`; a note can't be unfiled, so no hand-curated map or CI link-gate is needed for the garden.
