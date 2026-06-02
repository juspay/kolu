# kolu Atlas

kolu's in-repo knowledge base — a **self-contained Astro project**, deliberately
separate from the public website (`../../website`) and **not published
anywhere**.

- **Author** notes as markdown/MDX in `src/content/atlas/` (+ frontmatter).
- **Build** the self-contained HTML with `just atlas::build` → `dist/`.
- **Preview** any `dist/<slug>.html` directly in kolu's Code tab — styles are
  inlined and links are relative, so no dev server is needed.

The rendered `dist/` is **committed** (marked generated in `.gitattributes`); an
`.apm` rule regenerates it whenever a note changes. Author markdown/MDX only —
never hand-edit the generated HTML under `dist/`.

The design rationale lives in the Atlas itself: `src/content/atlas/second-brain.mdx`.
