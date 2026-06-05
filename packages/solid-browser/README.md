# @kolu/solid-browser

The navigation core of a content browser — the layer *above* a single document that decides **which** document you're looking at and **where its links go**. Rendering one document is [`@kolu/solid-fileview`](../solid-fileview)'s job; this package is the shell that drives it.

Phase 1 ships the **navigation math**: three pure, framework-free functions that turn a link a user clicked into the next document path. No git, no repos, no DOM, no SolidJS — a "document path" is whatever opaque string your host resolves content from (a repo-relative path, an HTTP path, an ssh target).

| Function | The question it answers | In → out |
|----------|-------------------------|----------|
| `resolveRelativePath(fromPath, ref)` | "An author wrote `![](logo.png)` in this doc — what path is that?" | `("docs/readme.md", "logo.png")` → `"docs/logo.png"` |
| `resolveLinkHref(fromPath, href)` | "…and where does `[guide](./guide.md#install)` go?" | `("docs/readme.md", "./guide.md#install")` → `"docs/guide.md"` |
| `pathFromPreviewPathname(reported, currentUrl, currentPath, codec)` | "A sandboxed iframe just navigated itself — which document is it showing now?" | see [the preview walkthrough](#following-a-link-inside-a-sandboxed-preview) |

The first two are GitHub's relative-link rules. The third inverts a host's preview-URL encoding through an **injected codec**, so the package never learns how your URLs are shaped.

## Install

Workspace-private. Add it to whichever package does the navigating:

```jsonc
// packages/<consumer>/package.json
{
  "dependencies": {
    "@kolu/solid-browser": "workspace:*"
  }
}
```

Its only runtime dependency is the zero-dep [`@kolu/url-shape`](../url-shape) leaf (for the "does this ref carry its own scheme?" test) — so importing it never drags in a rendering stack.

## Tutorial

### Following a relative link in rendered prose

Say you're rendering `docs/guide.md` and the reader clicks `[the API](../api/auth.md)`. The browser must turn that href — written *relative to the document* — into a real document path. `resolveLinkHref` does exactly what GitHub does:

```ts
import { resolveLinkHref } from "@kolu/solid-browser";

resolveLinkHref("docs/guide.md", "../api/auth.md"); // → "api/auth.md"
resolveLinkHref("docs/guide.md", "tips.md");        // → "docs/tips.md"  (sibling)
resolveLinkHref("docs/guide.md", "/LICENSE");       // → "LICENSE"       (root-absolute)
resolveLinkHref("docs/guide.md", "guide.md#install"); // → "docs/guide.md"  (fragment dropped)
```

It returns `null` for anything that isn't a path *inside* your document space — so the caller can fall back (open a real browser tab, show a toast, do nothing) instead of navigating somewhere bogus:

```ts
resolveLinkHref("docs/guide.md", "https://example.com"); // → null  (own scheme)
resolveLinkHref("docs/guide.md", "mailto:a@b.c");        // → null  (own scheme)
resolveLinkHref("docs/guide.md", "#section");            // → null  (in-page anchor)
resolveLinkHref("docs/guide.md", "../../etc/passwd");    // → null  (escapes the root)
```

That last line is load-bearing: a ref that climbs above the root with `..`, or smuggles a separator through an escape (`a%2f..%2fetc`), is rejected — a link can never reach outside the document space.

`resolveRelativePath` is the same resolver without the `#fragment`/`?query` stripping — reach for it on an **image `src`** (where `?` and `#` are real filename characters), and `resolveLinkHref` on a **link `href`** (where they're a fragment/query to drop). `resolveLinkHref` is literally `resolveRelativePath` after stripping the tail.

#### Wiring it into a renderer

In kolu, the Markdown renderer reports a clicked relative link via an `onNavigateRelative` callback; the host resolves it and opens the result:

```ts
<MarkdownRenderer
  markdown={doc.content}
  onNavigateRelative={(href) => {
    const path = resolveLinkHref(doc.path, href);
    if (path === null) return toast.error(`Can't open link: ${href}`);
    navigate(path); // the host's "navigate" — in kolu, openInCodeTab({ ref: { path, … } })
  }}
/>
```

### Following a link inside a sandboxed preview

HTML/SVG previews render in an **opaque-origin sandboxed iframe**, so the parent can't read `contentWindow.location` — when the user clicks an `<a>` inside the frame, all you learn (via a `postMessage` bridge) is the frame's new `location.pathname`. `pathFromPreviewPathname` inverts that back to a document path.

The catch: the package can't know your preview-URL scheme. You serve previews at some `<prefix>/<encoded-path>?v=<mtime>`, and only *you* know how `encoded-path` is built. So you pass a **codec** — the `{ encode, decode }` pair your server already uses — and the function derives the prefix from the file currently shown, strips it, and decodes the rest:

```ts
import { pathFromPreviewPathname, type PreviewPathCodec } from "@kolu/solid-browser";

// Your preview-URL encoding — the SAME encoder your server builds URLs with.
const codec: PreviewPathCodec = {
  encode: (p) => p.split("/").map(encodeURIComponent).join("/"),
  decode: (s) => s.split("/").map(decodeURIComponent).join("/"),
};

// We're showing docs/a.html (served at …/file/docs/a.html?v=7).
// The iframe reports it navigated to …/file/docs/b.html:
pathFromPreviewPathname(
  "/api/terminals/t1/file/docs/b.html",     // reported by the frame
  "/api/terminals/t1/file/docs/a.html?v=7", // the URL we served it
  "docs/a.html",                            // the doc we're showing
  codec,
); // → "docs/b.html"
```

Using one injected codec for **both** directions is the point: the inversion can't drift from the encoding, because there's no second copy of the rule. If the frame navigates *outside* the preview route (an external link, a prefix mismatch, a malformed escape), you get `null` and leave the selection untouched:

```ts
pathFromPreviewPathname("/somewhere/else.html", currentUrl, currentPath, codec); // → null
```

#### Wiring it into an iframe host

```ts
import { pathFromPreviewPathname } from "@kolu/solid-browser";
import { previewPathCodec } from "kolu-common/preview"; // your codec, defined once

observeIframeNavigation(iframeEl, (pathname) => {
  const next = pathFromPreviewPathname(pathname, props.url, props.path, previewPathCodec);
  if (next !== null && next !== props.path) props.onNavigate?.(next); // host's "navigate"
});
```

> **Why a codec instead of a dependency?** kolu's encoder (`encodePreviewPath`) lives in `kolu-common/preview`; this package must not depend on kolu. Injecting `{ encode, decode }` keeps the inversion host-agnostic while guaranteeing it inverts *your* exact encoding. A different app plugs in a different codec and reuses the same function.

## What's NOT here (yet) — the roadmap

Phase 1 is deliberately just the math. The browser *proper* lands in phase 2, where it has substance:

- **`BrowserLocation`** — the typed "URL" of a document space (path + optional line focus). Ships with its first consumer, not before.
- **`createBrowser`** — a location + **history** controller: `navigate` / `back` / `forward` over a stack of locations.
- **`<Browser>`** — a SolidJS component that composes `<FileView>` and owns link interception, so a host mounts one component instead of wiring the callbacks above by hand.

These arrive *together with history* on purpose: a `<Browser>` that merely forwards to `<FileView>` would be a hollow wrapper — history is what earns the component. Background and the full plan: [`docs/atlas/.../solid-browser.mdx`](../../docs/atlas/src/content/atlas/solid-browser.mdx).

## Testing

`pnpm --filter @kolu/solid-browser test:unit` — 29 cases across `relativePath.test.ts` (GitHub-rule resolution, the reject set, traversal/escape attacks) and `previewPath.test.ts` (codec round-trips for any path, the out-of-route `null` cases).
