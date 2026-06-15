# kolu Atlas

kolu's in-repo knowledge base — a **self-contained Astro project**, authored
separately from the public website (`../../website`) but published alongside it
at **[kolu.dev/atlas/](https://kolu.dev/atlas/)** (the website build folds the
committed `dist/` in under `/atlas/`).

- **Author** notes as markdown/MDX in `src/content/atlas/` (+ frontmatter).
- **Build** the self-contained HTML with `just atlas::build` → `dist/`.
- **Preview** any `dist/<slug>.html` directly in kolu's Code tab — styles are
  inlined and links are relative, so no dev server is needed.
- **Read on the web** (no checkout) — published at <https://kolu.dev/atlas/>,
  which serves the committed self-contained HTML with the relative links between
  notes intact. Reflects what's merged to `master`.

The rendered `dist/` is **committed** (marked generated in `.gitattributes`); an
`.apm` rule regenerates it whenever a note changes. Author markdown/MDX only —
never hand-edit the generated HTML under `dist/`.

The design rationale lives in the Atlas itself: `src/content/atlas/second-brain.mdx`.
