---
description: Atlas — regenerate + commit the rendered HTML when Atlas content changes
applyTo: "{website/src/content/atlas/**,website/src/pages/atlas/**,website/src/content.config.ts}"
---

## The Atlas — keep the rendered HTML in sync

Atlas notes are authored as markdown in `website/src/content/atlas/` and rendered by Astro to `website/dist/atlas/`. The rendered `.html` is **committed** (marked generated in `.gitattributes`) so it can be reviewed directly in kolu's Code tab without running a dev server.

- After you **add, edit, rename, or remove** a Atlas note (or change the Atlas's Astro setup), **regenerate and commit the output in the same commit**: run `just website::build-atlas`, then stage `website/dist/atlas/`.
- Pages build with inlined styles, so each `website/dist/atlas/<slug>.html` is self-contained and previews correctly in the Code tab.
- **Author markdown only** — never hand-edit the generated HTML under `website/dist/`.
- The generated index lives at `website/dist/atlas/index.html`; a note can't be unfiled, so no hand-curated map or CI link-gate is needed for the Atlas.
