---
description: docs/ knowledge base — keep the plans Map of Content (index.html) in sync
applyTo: "docs/**"
---

## docs/ knowledge base

`docs/plans/index.html` is a **hand-curated Map of Content** (deliberately no generator). When you **add, rename, or remove** any file under `docs/plans/`, add or refresh its one-line entry in `index.html` — under the right section, in the **same commit**.

- Prefer flat, ancestry-free slugs (`pty-daemon-tui.html`) over dotted names (`remote-terminals.pty-daemon.tui.html`).
- New design/research docs are `.html` in the repo's house style (light "paper" palette), so they render and annotate inside kolu's own Code tab.
- The taxonomy (what lives in `docs/` vs the `hk` issue zettelkasten vs the blog) and the rationale for all of the above live in `docs/plans/second-brain.html`.
