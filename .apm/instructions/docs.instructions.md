---
description: docs/ knowledge base — the Atlas (docs/atlas) is the home; docs/plans is retired
applyTo: "docs/**"
---

## docs/ knowledge base

kolu's in-repo knowledge base is the **Atlas** at `docs/atlas/` — authored as markdown/MDX in `docs/atlas/src/content/atlas/` and rendered to `docs/atlas/dist/`. Every note has a `kind` that files it in the index: `bug` · `feature` · `analysis` · `reference`. A contributor proposal is just a note in its real category with `status: proposed` — see `CONTRIBUTING.md`; accepting one flips the status. The design + taxonomy (what lives in the Atlas vs GitHub Issues vs the blog) live in `docs/atlas/src/content/atlas/meta.mdx`.

- **`docs/plans/` is retired** — every legacy HTML plan has been migrated to the Atlas and the directory is gone. Do not recreate it; new plans, designs, reviews, research, and retros go in the Atlas. (There is no `index.html` Map of Content or `docs-moc` CI gate either.)
- Prefer flat, ancestry-free slugs (`pty-daemon-tui` over `remote-terminals.pty-daemon.tui`).
