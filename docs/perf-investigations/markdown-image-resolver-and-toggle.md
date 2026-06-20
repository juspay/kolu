# Markdown preview: the image-resolver "fix" was a no-op; the toggle remount is the real cost

Investigation closing out **backlog item #7** of the
[performance map](../atlas/src/content/atlas/performance.mdx) —
*"Stabilize the markdown image resolver reference."* It arrived as a plausible,
code-cited diagnosis: `BrowseFileDispatcher` passes `resolveImageSrc` as an inline
arrow (a new reference per render), so `Markdown`'s `html` memo re-runs
`sanitizeHtml` for nothing — *memoize the resolver upstream to stop it.*

Measured against the real Solid runtime, the diagnosis is **mechanically wrong**:
stabilizing the reference eliminates **zero** sanitize runs. But the reproduction
that proved the negative also surfaced the **real** cost in the same code path —
`FileView` fully **remounts and re-sanitizes** the whole Markdown appliance on
every Source⇄Rendered toggle. This note records both, because a
faithfully-reproduced negative is as load-bearing as a fix (the lesson of
[dock-and-eventloop-1308](./dock-and-eventloop-1308.md) and
[memory-learnings](./memory-learnings.md)): it's why we ship no resolver-memoization
patch, and why the follow-up targets the remount instead.

---

## Part 1 — The negative: stabilizing `resolveImageSrc` saves nothing

The claim has a clean falsification: if the inline arrow caused extra `html`-memo
runs, then a **stable** callback would produce **fewer** sanitize runs than the
**fresh** inline arrow across the same operations. It doesn't — they're identical.
Three independent lines of evidence, all pointing the same way.

### 1. Runtime reproduction (the repo's real Solid build, under jsdom)

A faithful replica of `FileView`'s rendering mechanism — the tracked child
expression `<div>{active()}</div>` where
`active = () => matchedRendered()?.render(props.file)` — driven with the repo's
**client** Solid build (real `createEffect`/reconciliation, not the no-op SSR
build), counting the internal `html`-memo runs and per-image resolver calls for a
**fresh inline arrow** (current code) vs a **stable hoisted callback** (the
proposed fix):

| Operation | Fresh inline arrow | Stable hoisted callback |
|---|---|---|
| mount | 1 memo / 1 mount / 1 resolve | 1 / 1 / 1 |
| unrelated signal churn | 0 / 0 / 0 | 0 / 0 / 0 |
| mode toggle round-trip | **1 / 1 / 1** | **1 / 1 / 1** |
| content save | **1 / 1 / 1** | **1 / 1 / 1** |

Byte-identical. And the decisive detail: **every** re-run carries `mounts +1` — a
full *remount*, not an in-place prop update. The `html` memo re-runs because
`Markdown` was rebuilt, never because the resolver reference changed.

### 2. `FileView`'s design intent already says so

`FileView.tsx:91-98` documents the mechanism verbatim — `active()` is read as a
tracked child expression *"so Solid tracks `props.file`: a save mints a fresh
`FileData` … and the matching renderer has to re-run to pick it up … each
re-renders its appliance on a fresh snapshot."* The appliance is **re-rendered on
every snapshot by design**. There is no surviving `Markdown` instance for a stable
reference to spare a memo run on.

### 3. The Solid compiler proves the prop is static

Compiling the exact JSX with the repo's `babel-preset-solid`:

```js
_$createComponent(Markdown, {
  get markdown() { return file.source?.content ?? ""; },   // reactive getter
  resolveImageSrc: src => resolveMarkdownImageSrc(...),      // STATIC property
  ...
});
```

`resolveImageSrc={(src) => …}` compiles to a **plain static property** — only
expressions the compiler deems dynamic (member access, calls) become reactive
getters. So `props.resolveImageSrc` is a constant for the life of each mount and
is **never a reactive dependency** of the `html` memo. By construction it cannot
trigger an in-place re-run; it only ever differs across remounts, where the memo
runs once regardless.

### The defense-in-depth idea is inert too

The companion proposal — *mark already-processed images with a `data-` attribute so
the sanitize loop skips them* — also saves nothing. `sanitizeHtml` re-parses from
**raw markdown** on every run (`renderMarkdownToRawHtml` → a fresh DOMPurify tree),
so a marker written on one run's output DOM never reaches the next run's
freshly-parsed tree. Within a single run the loop already skips correctly
(`continue` on resolved images, `isLoadableImage(src)` short-circuit). There is no
cross-run state for a marker to dedupe.

**Verdict:** the resolver-reference stabilization is a confirmed no-op. No patch
ships.

---

## Part 2 — The real cost: the toggle remounts and re-sanitizes the whole doc

The same reproduction exposed where the actual work goes. Because `active()`
returns *only the active branch*, toggling Source⇄Rendered **unmounts** one
appliance and **remounts** the other — so flipping back to Rendered re-runs the
full pipeline: `marked` parse → DOMPurify sanitize → six tree-walks → resolve
**every** image → (if fenced) Shiki re-highlight → full `innerHTML` DOM re-parse.
Scaling the reproduction's image count to the map's "50-image file view":

| Path | Current (remount on toggle) | Keep-alive (visibility toggle) |
|---|---|---|
| one Source⇄Rendered round-trip | 1 remount + 1 sanitize (**50** image-resolutions) | **0** — a CSS `display` flip |
| three round-trips | **150** image-resolutions + 3× re-parse/sanitize/highlight/DOM-reparse | **0** |
| content save | remount + re-sanitize | **in-place** memo re-run (no remount) + re-sanitize |

A keep-alive prototype (render both modes once, thread `file` reactively, toggle
visibility) **eliminates the toggle re-sanitize entirely** and — because
`markdown` is already a reactive getter — converts a content save from a *remount*
into a cheaper *in-place* memo re-run, while still re-rendering correctly. The core
mechanism is validated.

### Why this is *scoped*, not shipped here

This is the same state-preservation pattern `RightPanel` already uses (#818: render
both tabs, hide the inactive one). But applying it to `FileView` is a change to a
**generic** `@kolu/solid-fileview` boundary, with real risk that demands a trace
and careful design before code:

- **API change.** `render(file: FileData)` hands appliances a *snapshot*. Keep-alive
  needs them to read `file` *reactively* (e.g. `render(file: () => FileData)`),
  rippling to all five renderers and their kolu call sites.
- **Reload-on-edit must survive.** The image/iframe appliances capture their `url`
  once and **must** get a fresh element on edit — the exact semantics
  `FileView.tsx:91-98` was built to fix (an earlier `untrack` form broke it). A
  keep-alive refactor must preserve per-appliance reload, not regress it. These are
  single-mode (no toggle), so a `both()`-gated keep-alive leaves them untouched —
  but that gating is the design that needs proving.
- **Comment-surface duality.** Source ("text") and Rendered ("prose") each wrap in
  `CommentTextSurface`; keeping both mounted means both anchor live at once.
- **Memory.** Both appliances resident per open file (Pierre source + Markdown).

**A lower-risk alternative to weigh first:** a content-keyed sanitize cache (a
small module-level LRU keyed by `markdown`+variant+policy) lets a remount reuse a
recent sanitize result — killing the toggle re-sanitize **without** the FileView
API change, at the cost of cache-invalidation and the `resolveImageSrc`/`highlightCode`
closures in the key. Cheaper to land, narrower blast radius.

**Both are bounded at today's scale** (the cost only bites on large docs with
frequent toggling), so the gate is a real trace — open a heavy README, toggle
Source⇄Rendered, and measure the sanitize/highlight wall-clock — *then* choose
between the two fixes. The map carries this as a measurement-gated item, not a
speculative rewrite.

---

## Reproduction

The measurements above come from a throwaway harness: jsdom + the repo's client
Solid build (`solid-js@1.9.11` `dist/solid.js` + `web/dist/web.js`, with the
core import pinned so reconciliation is real, not the no-op SSR build), rendering a
faithful `FileView.active()` replica and a stand-in `Markdown` whose internal
`createMemo` reads `props.markdown` + `props.resolveImageSrc` and calls the
resolver once per `<img>` (so a resolver-call count is a sanitize-run count). The
compiler check ran the exact JSX through `babel-preset-solid` (`generate: "dom"`).

The scripts aren't committed — the repo keeps unit tests DOM-free and covers the
sanitize/DOM layer in the `code-tab.feature` e2e suite (see
`packages/solid-markdown/vitest.config.ts`), so a jsdom dependency isn't carried
just to re-assert a negative. The harness is small enough to reconstruct from this
description; the load-bearing facts are the three independent confirmations above.
