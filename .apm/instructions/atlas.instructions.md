---
description: Atlas — regenerate + commit the rendered HTML when Atlas content changes
applyTo: "docs/atlas/**"
---

## The Atlas — keep the rendered HTML in sync

The Atlas is a **self-contained Astro project** at `docs/atlas/` — decoupled from the public website and **not published anywhere**. Notes are authored as markdown/MDX in `docs/atlas/src/content/atlas/` and rendered by Astro to `docs/atlas/dist/`. The rendered `.html` is **committed** (marked generated in `.gitattributes`) so it can be reviewed directly in kolu's Code tab without running a dev server.

- After you **add, edit, rename, or remove** an Atlas note (or change the Atlas's Astro setup), **regenerate and commit the output in the same commit**: run `just atlas::build`, then stage `docs/atlas/dist/`.
- Pages build with `format: "file"` + inlined styles, so each `docs/atlas/dist/<slug>.html` is self-contained and cross-links with relative hrefs — it previews correctly in the Code tab.
- **Author markdown/MDX only** — never hand-edit the generated HTML under `docs/atlas/dist/`. For anything markdown can't express, reuse the shared kit in `docs/atlas/src/components/` (e.g. `<PrLink>`). A **note-local** component must be defined **inline in the `.mdx`** (`export const Foo = (props) => …`), never as a separate per-note file — promote it into `src/components/` only once it's reused across notes.
- The generated index lives at `docs/atlas/dist/index.html`; a note can't be unfiled, so no hand-curated map or CI link-gate is needed for the Atlas.
- **This is enforced.** CI runs `ci::atlas-sync` (`just atlas::check-sync`), which rebuilds and fails the pipeline if the committed `docs/atlas/dist/` is stale — so forgetting to regenerate is caught, not silently merged.
