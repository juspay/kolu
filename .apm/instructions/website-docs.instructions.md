---
description: kolu.dev product docs are canonical for user-facing features; the README is a pointer
applyTo: "{README.md,website/src/content/docs/**}"
---

## kolu.dev docs are the canonical product docs

The user-facing description of kolu lives in the **kolu.dev docs** at `website/src/content/docs/` (rendered through `DocsLayout`, grouped by the `section` frontmatter). This is the canonical place a user reads about what kolu does and how to use it — **not** the root `README.md`, which is a slim map that points into these pages.

- When you add or materially change a **user-facing feature**, update the matching docs page in the same PR — a new agent's detection → `agent-detection.mdx`; a theming option → `theming.mdx`; a canvas/dock behaviour → `concepts.mdx`; a scale/session feature → `power-features.mdx`. Add a **new page** (frontmatter: `title` · `description` · `order` · `section`) when the feature doesn't fit an existing one; the sidebar orders by `order` and groups by `section`.
- Keep the README a pointer. Don't re-grow a feature catalog there — add or adjust a bullet under "What it does" that links to the doc page instead.
- Diagrams are hand-authored **inline SVG** reusing the `ax-d-*` / `doc-figure` classes (the site has no mermaid). Style both light and dark via the `--color-*` CSS tokens — never raw hex.
- This is the product-docs mirror of the `surface-reference` rule (which governs the `@kolu/surface` Reference pages). Same discipline: the record must not lie.
