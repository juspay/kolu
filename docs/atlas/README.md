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

Code fences: every fence language used in `src/` is **derived and preloaded**
into shiki at build start (`scripts/fence-langs.mjs`, shared with the website;
see the Atlas note `bug-shiki-grammar-load-race`), so a fence in any real
language just works, an unbundled/typo'd language fails the build loudly, and
a fence added while `astro dev` runs needs a dev-server restart (the list is
derived when the config evaluates). Unit pins live in `build/*.test.mjs` and
run under `just atlas::check`.

The design rationale lives in the Atlas itself: `src/content/atlas/meta.mdx`.
