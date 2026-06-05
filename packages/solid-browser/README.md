# @kolu/solid-browser

The navigation core of a content browser — the layer *above* a single document
that decides **which** document you're looking at and **where its links go**.
Rendering one document is `@kolu/solid-fileview`'s job; this package is the shell
that drives it.

## What's here (phase 1 — navigation primitives)

- **`relativePath.ts`** — `resolveRelativePath` / `resolveLinkHref`: resolve a
  repo-relative ref the way GitHub does (against the source document's directory;
  root-absolute from the root; reject own-scheme refs and traversal that escapes
  the root).
- **`previewPath.ts`** — `pathFromPreviewPathname`: invert a sandboxed preview's
  reported `location.pathname` back to a document path, with the URL **codec
  injected** (the host owns its own preview-URL encoding).

## Roadmap (phase 2 — the browser proper)

`createBrowser` (a location + **history** controller: `navigate` / `back` /
`forward`) and a `<Browser>` Solid component that composes `<FileView>` and owns
link interception. They land with history because that's what gives them
substance — a `<Browser>` that merely forwards to `<FileView>` would be a hollow
wrapper. See `docs/atlas/src/content/atlas/solid-browser.mdx`.
