---
name: atlas
description: Create, update, or finalize a note in the kolu Atlas (docs/atlas) — frontmatter, the MDX component kit, build + check-sync, and the preview/share links. Use whenever authoring or editing an Atlas note (e.g. a /be plan-of-record), so the mechanics live in one place.
argument-hint: "<slug | what the note is about>"
---

# Atlas note

A self-contained Astro project at `docs/atlas/`. Author MDX in
`docs/atlas/src/content/atlas/<slug>.mdx` (flat, ancestry-free slug); Astro
renders the committed `docs/atlas/dist/<slug>.html`. Sync rules:
`.apm/instructions/atlas.instructions.md`.

## 1. Author

```yaml
---
title: Title in Title Case
description: One line — what this note is about.
kind: reference        # bug · feature · analysis · reference (the index section)
status: proposed        # optional — proposed → accepted → implemented → superseded
maturity: seedling      # seedling → budding → evergreen
parents: [slug]         # optional — nests under same-kind parents; cross-kind ⇒ a "related" link
---
```

- Prose in markdown; reach for the **kit** in `docs/atlas/src/components/` only where markdown can't (`<Cite>`, `<Callout>`, `<PrLink>`, `<Terminal>`, `<AtlasMockup>`, `<D2>`, …).
- **Hierarchical headings, not a flat list.** A handful of top-level `##` sections (≈3–5), each with `###` sub-headers doing the low-level work — the TOC should read as an *outline*, not a long flat enumeration. If you find every heading is `##`, group the related ones under one `##` with `###` children.
- **Lead structural notes with an architecture diagram.** Any note that proposes or analyzes structure (a `feature`/`analysis` plan, a module split, a package boundary) MUST include a **D2 diagram of the module/package connections**, via `<D2 caption="…" code={`…`} />` (`src/components/D2.astro`). Use **`direction: down`** — a vertical stack fits the column's aspect ratio; `direction: right` renders wide and shrinks the text to unreadable. Quote any key/label with spaces or special chars. The `d2` binary comes from the Nix devShell (pinned; `--sketch=false`/`--layout=dagre` baked in so the SVG is byte-deterministic and `check-sync`'s host-independence gate stays green).
- A **note-local** component is defined **inline in the `.mdx`** (`export const Foo = …`), never a separate file — promote it to `src/components/` only once it's reused across notes. Never hand-edit `dist/`.

## 2. Build & verify

`just atlas::build`, then stage `docs/atlas/dist/`. Finish with `just
atlas::check-sync` (the `ci::atlas-sync` gate): it rebuilds and fails if the
committed HTML is stale or host-dependent.

## 3. Preview & share

Each `dist/<slug>.html` is self-contained: it previews in kolu's Code tab, and —
once the branch is pushed — reads on GitHub via
`https://htmlpreview.github.io/?https://github.com/<owner>/<repo>/blob/<branch>/docs/atlas/dist/<slug>.html`
(`<owner>/<repo>` ← `gh repo view --json nameWithOwner -q .nameWithOwner`,
`<branch>` ← `git branch --show-current`).

## 4. Lifecycle

Notes are **living** — git is the history, no frozen copies. Advance `status` as
it matures and link the implementing PR with `<PrLink pr={<n>} />`. A contributor
proposal is just a note carrying `status: proposed` (see `CONTRIBUTING.md`);
acceptance flips the status, not the `kind`.

ARGUMENTS: $ARGUMENTS
