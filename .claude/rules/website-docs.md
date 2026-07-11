---
paths:
  - "{README.md,website/src/content/docs/**,website/src/content/changelog/**}"
---

## kolu.dev docs are the canonical product docs

The user-facing description of kolu lives in the **kolu.dev docs** at `website/src/content/docs/` (rendered through `DocsLayout`, grouped by the `section` frontmatter). This is the canonical place a user reads about what kolu does and how to use it — **not** the root `README.md`, which is a slim map that points into these pages.

- When you add or materially change a **user-facing feature**, update the matching docs page in the same PR — a new agent's detection → `agent-detection.mdx`; a theming option → `theming.mdx`; a canvas/dock behaviour → `concepts.mdx`; a scale/session feature → `power-features.mdx`. Add a **new page** (frontmatter: `title` · `description` · `order` · `section`) when the feature doesn't fit an existing one; the sidebar orders by `order` and groups by `section`.
- **A `<Change>` in `changelog/unreleased.mdx` is your trigger, not your finish line.** A changelog entry is the most reliable signal that user-facing behaviour changed — so writing one is the moment to ask *which docs page did this just make stale?* A change can invalidate a page it never opens: a "known gap / for now / currently shows X" sentence you just closed, a table row, a flag you renamed. Grep `website/src/content/docs/` for the behaviour you're changing and fix the page **in the same PR** — the failure mode is not a missing doc, it's an existing sentence quietly turned into a lie. (Real slip: PR #1730 landed the honest-connect UI and wrote a perfect changelog entry, but left `remote-hosts.mdx` telling users the opposite; #1746 fixed the page and this glob.)
- Keep the README a pointer. Don't re-grow a feature catalog there — add or adjust a bullet under "What it does" that links to the doc page instead.
- Diagrams are hand-authored **inline SVG** reusing the `ax-d-*` / `doc-figure` classes (the site has no mermaid). Style both light and dark via the `--color-*` CSS tokens — never raw hex.
- This is the product-docs mirror of the `surface-reference` rule (which governs the `@kolu/surface` Reference pages). Same discipline: the record must not lie.
