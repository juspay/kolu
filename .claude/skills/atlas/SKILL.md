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
parents: [feature]     # REQUIRED — the one filing edge. A category (bug · feature · analysis · reference) is itself a note marked `moc: true`; there is no `kind` field. List the index note and/or topical hubs, e.g. [solid-fileview, feature].
status: proposed       # optional — proposed → accepted → implemented → superseded
maturity: seedling     # seedling → budding → evergreen (a tag, not a location)
updated: <YYYY-MM-DD>  # date of the last meaningful edit
---
```

Every note is filed into the index through `parents` — the single edge mechanism.
There is **no `kind` enum**: the four index roots (Bugs · Features · Analysis ·
Reference) are ordinary notes marked `moc: true`, and you reach one by listing it
in `parents` (a note may list several — its index plus any topical hubs). A
proposal is just a note under its real index carrying `status: proposed`.

- Prose in markdown; reach for the **kit** in `docs/atlas/src/components/` only where markdown can't (`<Cite>`, `<Callout>`, `<PrLink>`, `<Terminal>`, `<AtlasMockup>`, `<Svg>`, `<D2>`, …).
- **Headings are an outline, not a count.** Decide the 3–5 *concepts* the note is about, name each as a `##`, then write the body under them. The TOC should read as an outline, not a flat enumeration. Do **not** hit the number by re-leveling: taking a flat list of `##`s and demoting some to `###` to satisfy "≈4" is the wrong move — if you're changing `#` counts on existing headers rather than moving content, you're cheating the rule, not following it. Every `##` must be a genuine peer concept; never invent a catch-all bucket ("Building it", "Details", "Misc", "Other") for whatever's left over. A `###` lives under its parent because it's *part of that concept*, not because the parent had a free slot.
- **Lead structural notes with an architecture diagram — your call between SVG and D2, favouring SVG.** Any note that proposes or analyzes structure (a `feature`/`analysis` plan, a module split, a package boundary) MUST include a diagram of the module/package connections. **Choose the tool per diagram by one test — which renders something more informative and useful to the human reader — and when it's a toss-up, choose SVG.** Hand-author an inline **SVG** via `<Svg svg={…} caption="…" />` (`src/components/Svg.astro`) whenever hand-authoring makes the diagram visually richer — colour as meaning, deliberate proportion, emphasis, a bespoke layout a graph DSL can't express; it also needs no build-time binary and is byte-deterministic for free. Keep the SVG as a real file in `src/diagrams/<slug>-<name>.svg`, imported with Vite's `?raw` loader (`import foo from "../../diagrams/foo.svg?raw"`); because there is no generator, edit a layout-dependent SVG by re-authoring it wholesale, not by patching coordinates. Reach for **D2** — `<D2 caption="…" code={`…`} />` (`src/components/D2.astro`) — only when its auto-layout genuinely serves the reader better than anything you'd hand-place: a large, nested graph whose value is just a clean, correct arrangement no hand-layout would improve. Then use **`direction: down`** (a vertical stack fits the column; `direction: right` renders wide and shrinks text to unreadable), quote keys/labels with special chars, and rely on the Nix-pinned `d2` (`--sketch=false`/`--layout=dagre`, deterministic). Tie-breaker, always: prefer SVG.
- A **note-local** component is defined **inline in the `.mdx`** (`export const Foo = …`), never a separate file — promote it to `src/components/` only once it's reused across notes. Never hand-edit `dist/`.

## 2. Build & verify

`just atlas::build`, then stage `docs/atlas/dist/`. Finish with `just
atlas::check-sync` (the `ci::atlas-sync` gate): it rebuilds and fails if the
committed HTML is stale or host-dependent.

- **Let the build finish before you stage — and stage `dist/` by pathspec, never
  `git add -A`.** `atlas::build` *empties* `dist/` and then regenerates it, so any
  `git status` / `git add` / `git commit` that runs **during** the build sees the
  whole `dist/` as deleted; a `git add -A && git commit` in that window silently
  stages ~50 deletions and wipes the rendered Atlas. Run the build in the
  foreground (don't background it and race a `git add`), and stage the rendered
  output as `git add docs/atlas/dist/ <your source files>`, so a half-written
  `dist/` can never sneak deletions into the commit.

## 3. Preview & share

Each `dist/<slug>.html` is self-contained: it previews in kolu's Code tab, and —
once the note is merged to `master` — is published on the web at
`https://kolu.dev/atlas/<slug>.html` (the index is `https://kolu.dev/atlas/`).
The website build folds the committed `dist/` in under `/atlas/`, so a merged
note ships with the next Pages deploy.

## 4. Lifecycle

Notes are **living** — git is the history, no frozen copies. Advance `status` as
it matures and link the implementing PR with `<PrLink pr={<n>} />`. A contributor
proposal is just a note carrying `status: proposed` (see `CONTRIBUTING.md`);
acceptance flips the status, not its `parents` (the index parent was right from
the start).

- **A plan-of-record describes current + future work, not the path that got here —
  when you re-plan, *rewrite*, don't layer.** Git already holds the archaeology, so
  superseded phases, abandoned attempts, closed-PR post-mortems, and "what we tried
  before" belong in the commit history, **not** as live sections of the note. Each
  re-plan **replaces** the old phase list outright; never keep the dead phases beside
  the new ones to show the journey. And carry **one** numbering scheme at a time:
  renaming P3a/P3b → PR1/PR2 means the P3a/P3b labels are *gone*, not cross-mapped in a
  table — two parallel schemes for the same work is the confusion, not the cure. If a
  reader has to ask "how does PR1 relate to P3a?" or "why does P3a still exist?", the
  note kept clutter it should have deleted.

ARGUMENTS: $ARGUMENTS
