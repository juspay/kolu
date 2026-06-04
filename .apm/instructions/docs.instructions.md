---
description: docs/ knowledge base — the Atlas (docs/atlas) is the home; docs/plans is deprecated
applyTo: "docs/**"
---

## docs/ knowledge base

kolu's in-repo knowledge base is the **Atlas** at `docs/atlas/` — authored as markdown/MDX in `docs/atlas/src/content/atlas/` and rendered to `docs/atlas/dist/`. New plans, designs, reviews, research, and retros go there. The design + taxonomy (what lives in the Atlas vs GitHub Issues vs the blog) live in `docs/atlas/src/content/atlas/second-brain.mdx`.

- **`docs/plans/` is deprecated** — see `docs/plans/README.md`. It holds only not-yet-migrated legacy HTML; do not add new docs there. There is no longer an `index.html` Map of Content or a `docs-moc` CI gate.
- Prefer flat, ancestry-free slugs (`pty-daemon-tui` over `remote-terminals.pty-daemon.tui`).
