# @kolu/artifact-sdk

Self-contained comments-on-files toolkit. Captures user text selections
inside Kolu's Code tab — source files, branch diffs, and HTML artifacts
rendered in a sandboxed iframe — and turns each one into a W3C-style
quote anchor that survives file edits.

## Layout

```
src/
  types.ts                Locator + iframe ↔ parent wire messages.
                          Single source of truth across runtimes.

  core/                   Pure functions, no DOM imports beyond types.
                          Bundled into the iframe by esbuild AND imported
                          by the parent — bit-identical anchor behavior
                          across surfaces.
    extractQuote.ts       Range → Locator (W3C TextQuoteSelector).
    findQuote.ts          (text, Locator) → match offsets.
    applyHighlights.ts    Re-find + register CSS Custom Highlights.
    theme.ts              Shared highlight color tokens.

  iframe/                 In-iframe bundle (opaque-origin sandbox).
    index.ts              Entry: selection capture + pill + postMessage.
                          esbuild bundles core/ + iframe/ into one
                          self-contained JS file at server startup.

  server/                 Host-server integration.
    index.ts              mountArtifactSdk(app, opts) — one call.
                          Registers the bundle route + an HTML-decoration
                          middleware that splices <script src="..."> into
                          text/html responses on the iframe-preview path.
    bundle.ts             esbuild-on-startup; cached in-memory with a
                          content hash for cache-busting.
    inject.ts             Pure HTML string splicer.

  client/                 Parent-side (kolu-client) entry.
    index.ts              Re-exports core/* and bridge.
    bridge.ts             bindArtifactSdk(iframe, opts) — postMessage
                          protocol with the in-iframe SDK. Validates by
                          event.source identity since event.origin is
                          "null" under the opaque sandbox.
```

Package exports:

- `./types` — `Locator`, message types
- `./client` — parent-side bridge + pure anchor functions
- `./server` — `mountArtifactSdk` + `MountOptions`

The `./core` and `./iframe` paths are internal — consume via `./client`
or, for the iframe, build-bundle the source files directly.

## How comments flow

```
text browse  ─▶ FileView  ─┐
branch diff  ─▶ FileDiff  ─┼─▶ useTextSelection ─┐  (kolu-client)
                           │                      │
HTML iframe  ─▶ <iframe>  ─┘                      ▼
                                            composerState ─▶ useComments
            in-iframe SDK ─▶ bridge ─────────┘
            (postMessage,                          ▼
             opaque origin)                  CommentsTray
```

The capture site differs per surface (browser `selectionchange` for text
in the parent, `postMessage` from the sandboxed iframe), but everything
downstream of capture is one code path. `Locator = { quote, prefix,
suffix }` is the single anchor model.

## Browser-API gotchas

- **`window.getSelection()` cannot see selections whose anchor/focus is
  inside a shadow tree.** Pierre's `FileView` / `FileDiff` render into a
  `<diffs-container>` custom element with an open shadow root, so the
  parent uses Chrome's `ShadowRoot.getSelection()` escape hatch. Without
  this, real user drags inside Pierre look "empty" to `window.getSelection()`
  and no pill appears.
- **`::highlight()` supports a subset of CSS** — `background-color`,
  `color`, `text-decoration*`, `text-shadow`. `box-shadow` is silently
  dropped. Use `text-decoration-line: underline` for the accent line.
- **Sandboxed iframe has opaque origin** (`sandbox="allow-scripts"`, no
  `allow-same-origin`). Parent ↔ iframe only via `postMessage`;
  `event.origin` is the literal string `"null"`, so the bridge validates
  by `event.source === iframe.contentWindow` identity.

## Tracking issue

[juspay/kolu#881](https://github.com/juspay/kolu/issues/881) — phased
rollout of comments-on-files.
