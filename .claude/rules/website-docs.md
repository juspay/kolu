---
paths:
  - "{README.md,website/src/content/docs/**}"
---

## kolu.dev docs are the canonical product docs

The user-facing description of kolu lives in the **kolu.dev docs** at `website/src/content/docs/` (rendered through `DocsLayout`, grouped by the `section` frontmatter). This is the canonical place a user reads about what kolu does and how to use it — **not** the root `README.md`, which is a slim map that points into these pages.

- When you add or materially change a **user-facing feature**, update the matching docs page in the same PR — a new agent's detection → `agent-detection.mdx`; a theming option → `theming.mdx`; a canvas behaviour → `canvas.mdx`; a terminal-tile behaviour → `tiles.mdx`; a dock behaviour → `dock.mdx`; a session/sleep-wake feature → `sessions.mdx`. (`concepts.mdx` is vocabulary-only — behaviour never lands there; if no page owns the surface, that's the signal to create one, not to widen Core Concepts.) Add a **new page** (frontmatter: `title` · `description` · `order` · `section`) when the feature doesn't fit an existing one; the sidebar orders by `order` and groups by `section`.
- How to write `<Change>` entries lives in its own rule, `changelog.instructions.md` (scoped to `website/src/content/changelog/**`) — including the discipline that a changelog entry is the trigger to fix the docs page it just made stale, in the same PR.
- Keep the README a pointer. Don't re-grow a feature catalog there — add or adjust a bullet under "What it does" that links to the doc page instead.
- Diagrams are hand-authored **inline SVG** reusing the `ax-d-*` / `doc-figure` classes (the site has no mermaid). Style both light and dark via the `--color-*` CSS tokens — never raw hex.
- This is the product-docs mirror of the `surface-reference` rule (which governs the `@kolu/surface` Reference pages). Same discipline: the record must not lie.
