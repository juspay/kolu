---
name: atlas
description: Create, update, or finalize a note in the kolu Atlas (docs/atlas) — frontmatter, the MDX component kit, build + check-sync, and the preview/share links. Use whenever authoring or editing an Atlas note (e.g. a /be plan-of-record).
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
parents: [feature]     # REQUIRED — the filing edge(s). Categories (bug · feature · analysis · reference) are notes marked `moc: true`; there is no `kind` field.
status: proposed       # optional — proposed → accepted → implemented (features then archive, §4)
maturity: seedling     # seedling → budding → evergreen
updated: <YYYY-MM-DD>
---
```

`parents` is the single filing mechanism — list the index note and/or topical
hubs. A proposal is just a note under its real index with `status: proposed`.

- Prose in markdown; the component kit (`docs/atlas/src/components/` —
  `<Cite>`, `<Callout>`, `<PrLink>`, `<Footnote>`, `<Terminal>`,
  `<AtlasMockup>`, `<Svg>`, `<D2>`, …) only where markdown can't.
- **Push asides into `<Footnote>`, not parentheticals** — caveats, citations,
  "why we rejected X". It renders as a superscript with a popover (full MDX
  body). Not for load-bearing claims (inline) or whole paragraphs (`###` or
  `<Callout>`).
- **Every phased work item carries an Atlas-unique identifier** — a track
  prefix + number (`W3`, `SR5`), never a bare ordinal ("phase 2"). Declare a
  new prefix once (grep for collisions), lead the section heading with it
  (`### SR5 — …`), and reference it verbatim everywhere — no invented monikers.
- **Headings are an outline**: 3–5 genuine peer concepts as `##`s, no
  catch-all buckets ("Details", "Misc"), no re-leveling to fake the count.
- **A plan's shape is free-form** — let content pick the structure; prefer
  tables/diagrams over prose runs. **Default to one PR**: split into phases
  only for a real sequencing constraint, not to look thorough.
- **Architecture ⇄ implementation is a loop**: a structural verdict
  (package-vs-module, electricity-vs-leaf) is contingent on an implementation
  choice — surface that choice as an explicit decision and state the verdict
  conditioned on it, in both directions. (Adopting an external engine *reuses*
  its electricity, leaving a thin leaf wrapper — don't miscount a dependency
  as a receptacle you own.)
- **A plan-of-record is build-ready or it is not done** — written for the
  *implementing* agent: another agent can execute it straight through without
  asking anything. Before presenting, fix (don't leave for the user to catch):
  - **Open decisions**: every fork that changes the build is resolved — bake
    low-stakes ones in as defaults; put the genuinely user-facing forks in
    **one batched `AskUserQuestion` up front** (mockup-rich previews).
  - **Template phrasing / vague hand-waving**: every risk is named concretely
    with its mitigation; if a sentence would make an implementer ask "like
    what, specifically?", it isn't done.
  - **Unpinned proof-paths**: a phase that exists to graduate or de-risk a
    specific code path names **that path** and carries a done-criterion only
    that path can satisfy — otherwise the implementer ships a green PR by the
    easiest route and the graduation silently doesn't happen.
  - **Phases a human can't verify**: each phase states its user-visible delta
    ("none" when internal), a reproducible manual acceptance path (a test
    command is supporting evidence, not the path), and the sequencing reason
    it's separate.
- **Structural notes lead with an architecture diagram.** Prefer a
  hand-authored inline **SVG** (`<Svg svg={…} caption="…" />`, file in
  `src/diagrams/`, imported `?raw`; re-author wholesale, don't
  coordinate-patch) — colour as meaning, deliberate emphasis. **A dense
  diagram must pass `wide`** or its text renders unreadably tiny in the 46rem
  column. Reach for **D2** (`<D2 code={…} />`) only when auto-layout of a
  large nested graph genuinely beats hand placement — then `direction: down`
  (right renders wide and shrinks text). Toss-up → SVG.
- A note-local component is defined inline in the `.mdx`; promote to
  `src/components/` only on reuse. Never hand-edit `dist/`.

## 2. Build & verify

`just atlas::build`, stage `docs/atlas/dist/`, finish with
`just atlas::check-sync` (the `ci::atlas-sync` gate). **The build empties
`dist/` before regenerating** — a `git add -A`/commit racing a running build
silently stages ~50 deletions and wipes the rendered Atlas. Build in the
foreground and stage by pathspec (`git add docs/atlas/dist/ <sources>`).

## 3. Preview & share

Each `dist/<slug>.html` is self-contained: previews in kolu's Code tab, and
once merged publishes at `https://kolu.dev/atlas/<slug>.html` (index:
`https://kolu.dev/atlas/`) with the next Pages deploy.

## 4. Lifecycle

Notes are living — git is the history. Advance `status`; link the implementing
PR with `<PrLink pr={<n>} />`.

- **A finished *feature* plan archives, it does not linger.** At
  `status: implemented`, delete the note and add a one-line row to
  `archived-notes.mdx` (former slug · what shipped · where to look now ·
  `<PrLink>`s). Then reparent children, retarget links to the deleted slug,
  delete note-only diagrams, rebuild + stage + check-sync. Don't "compact" it
  into a current-state page unless the substance is durable reference — then
  rewrite it as that kind of note under a different parent. Implemented
  **bug/analysis/reference** notes may stay when they still teach.
- **Re-planning rewrites, never layers.** Superseded phases, abandoned
  attempts, and "what we tried" belong in git, not as live sections. One
  numbering scheme at a time — renaming means the old labels are gone, not
  cross-mapped.

ARGUMENTS: $ARGUMENTS
