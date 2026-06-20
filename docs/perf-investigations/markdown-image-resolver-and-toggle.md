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
patch, and why the fix here targets the remount instead.

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
| content save (visible mode) | re-sanitize | re-sanitize (still rebuilds the *shown* appliance under the snapshot contract) |
| content save (hidden mode) | re-sanitize | **deferred** — no re-render until that mode is next shown |

A keep-alive prototype (render both modes once, hide the inactive one) **eliminates
the toggle re-sanitize entirely**: a Source⇄Rendered round-trip with no intervening
edit is a pure `display` flip — **zero** marked → DOMPurify → image-resolve → Shiki
runs. The win is the toggle, not the edit: under the kept `render(file)` snapshot
contract a content save still rebuilds the *visible* appliance (reload-on-edit
intact), but an edit to the *hidden* mode is deferred until it's shown, so a save
never re-renders both modes at once. The core mechanism is validated.

### The fix: keep both toggle modes alive

Shipped — the same state-preservation pattern `RightPanel` already uses (#818:
render both forms, hide the inactive one), applied to `FileView`. Each mode is
mounted lazily on first view and then kept alive across toggles, hidden with
`display:none` rather than unmounted, so flipping back is a pure visibility flip:
the whole marked → DOMPurify → tree-walks → image-resolve → Shiki → `innerHTML`
pipeline runs **zero** times per toggle instead of once. Each feared risk
resolved more cleanly than the scoping expected:

- **No API change.** The `render(file: FileData)` snapshot contract stays. A
  per-slot `heldFile` memo *freezes* the snapshot while a mode is hidden and
  adopts the latest the instant it's shown — so a toggle with no intervening edit
  reuses the same snapshot (no re-render at all), an edit to the *visible* mode
  still re-renders it (reload-on-edit intact), and an edit to a *hidden* mode is
  deferred until it's next shown (never re-rendering both modes at once). No
  reactive-`file` refactor, no ripple to the five renderers.
- **Single-mode appliances untouched.** The keep-alive is `both()`-gated, so
  images / video / iframes (one form, no toggle) stay on the existing `active()`
  path with their reload-on-edit semantics exactly as before.
- **Comment surfaces decoupled, not coupled.** Keeping both `CommentTextSurface`s
  mounted would have made them contend for the single global `kolu-comment` CSS
  Custom Highlight (`applyHighlights` *replaces* the named highlight each call).
  The fix gives each overlay instance its **own** highlight name + style element,
  so a hidden surface's ranges simply don't lay out and repaint automatically when
  shown — no visibility-threading, and a latent single-surface fragility removed.
- **Memory** is one extra resident appliance per *open* file once both modes have
  been visited — bounded (one file open in the panel at a time).

**Proven in the real app** by an e2e (`code-tab.feature` — "Toggling Source and
Rendered keeps the rendered preview alive"): a marker stamped on the rendered
preview survives a Source ⇄ Rendered round-trip, which a remount would erase. The
existing comment-highlight survival e2e still passes against the per-instance names.

**The win, measured.** Per toggle-back on the 50-image reproduction, the old code
ran one full pipeline (1 marked parse + 1 DOMPurify sanitize + 6 tree-walks + 50
image-resolutions + per-fence Shiki tokenization + 1 full `innerHTML` DOM reparse);
keep-alive runs none. Over three round-trips: **150 image-resolutions + 3 full
pipelines → 0** (`mdMounts +0` on each toggle, vs `+1` per toggle before).

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
