# @kolu/solid-browser

The navigation core of a content browser — the layer *above* a single document that decides **which** document you're looking at and **where its links go**. Rendering one document is [`@kolu/solid-fileview`](../solid-fileview)'s job; this package is the shell that drives it.

The package has two host-agnostic layers:

- **Navigation math** — three pure, framework-free functions that turn a link a user clicked into the next document path. No git, no repos, no DOM, no SolidJS.
- **History** — `createBrowser`, a small reactive (solid-js) controller that turns a sequence of "navigate here" calls into working **back/forward** over any location type.

A "document path" — or, for `createBrowser`, a "location" — is whatever opaque value *your* host resolves content from: a repo-relative path + git mode, an HTTP path, an ssh target, a doc slug.

| Export | The question it answers | In → out |
|----------|-------------------------|----------|
| `resolveRelativePath(fromPath, ref)` | "An author wrote `![](logo.png)` in this doc — what path is that?" | `("docs/readme.md", "logo.png")` → `"docs/logo.png"` |
| `resolveLinkHref(fromPath, href)` | "…and where does `[guide](./guide.md#install)` go?" | `("docs/readme.md", "./guide.md#install")` → `"docs/guide.md"` |
| `pathFromPreviewPathname(reported, currentUrl, currentPath, codec)` | "A sandboxed iframe just navigated itself — which document is it showing now?" | see [the preview walkthrough](#following-a-link-inside-a-sandboxed-preview) |
| `createBrowser<L>()` | "The user followed three links — how do I give them back/forward?" | see [the history walkthrough](#going-back-and-forward) |

The first two are GitHub's relative-link rules. The third inverts a host's preview-URL encoding through an **injected codec**, so the package never learns how your URLs are shaped. The fourth owns the back/forward stack so a host doesn't reinvent it.

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

Its runtime dependencies are the zero-dep [`@kolu/url-shape`](../url-shape) leaf (for the "does this ref carry its own scheme?" test) and `solid-js` (for `createBrowser`'s reactive stack) — so importing it never drags in a rendering stack.

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

## Going back and forward

The three functions above answer *"where does this link go?"*. `createBrowser` answers the next question: *"the user has been to five places — how do I give them back and forward?"* It's a reactive history controller over an **opaque location type** — it stores, compares, and replays locations and knows nothing about what a location *is*.

```ts
import { createBrowser } from "@kolu/solid-browser";

// Your host picks the location type. Here: a doc slug.
const browser = createBrowser<{ slug: string }>({
  initial: { slug: "index" },
  // Optional: two locations that name the "same page" refresh the current
  // entry in place instead of recording a duplicate.
  isSameEntry: (a, b) => a.slug === b.slug,
});

browser.navigate({ slug: "guide" }); // record + go
browser.navigate({ slug: "api" });
browser.current(); // → { slug: "api" }
browser.canBack(); // → true   (drives a ◀ button's `disabled`)

browser.back(); // → { slug: "guide" }   (returns the location to apply)
browser.back(); // → { slug: "index" }
browser.forward(); // → { slug: "guide" }

browser.navigate({ slug: "faq" }); // navigating after a back forks history:
browser.canForward(); // → false  (the "guide → api" tail was discarded)
```

`current`/`canBack`/`canForward` are reactive accessors, so a toolbar's ◀/▶ enablement tracks navigation with no extra wiring. The host owns the two things the controller deliberately doesn't: **applying** a returned location (rendering it) and **resolving** it to content.

> **Why `back()` returns the location instead of applying it.** The controller can't render your documents — only your host can. So traversal returns *what to show* and leaves *how to show it* to you. This is exactly the split kolu's Code tab uses: `back()` yields a `{ mode, path }`, and the Code tab re-applies it (sets the mode, re-selects the file, repaints the line highlight).

See [`example/docsite`](example/docsite) for a complete second host — a tiny doc browser — built on `createBrowser` in ~40 lines.

## What's NOT here (yet) — the roadmap

The navigation math and the history controller are both here. One piece is deliberately still out:

- **`<Browser>`** — a SolidJS component that composes `<FileView>`, owns link interception, and drives a `createBrowser` internally, so a host mounts one component instead of wiring the callbacks + history by hand. It's deferred because it only pays off once a host's *viewport* is uniform: kolu's Code tab still renders diffs through a different path than documents, so a `<Browser>` there would wrap just one of them. It ships with the host that can use it whole. (`BrowserLocation` is likewise the host's concern — kolu defines its own `{ mode, path, ref }`; the generic `createBrowser<L>` takes any location type.)

Mouse back/forward (X1/X2) buttons for the Code-tab browser are a tracked follow-up: [juspay/kolu#1192](https://github.com/juspay/kolu/issues/1192).

Background and the full plan: [`docs/atlas/.../solid-browser.mdx`](../../docs/atlas/src/content/atlas/solid-browser.mdx).

## Testing

`pnpm --filter @kolu/solid-browser test:unit` — 39 cases across `relativePath.test.ts` (GitHub-rule resolution, the reject set, traversal/escape attacks), `previewPath.test.ts` (codec round-trips, the out-of-route `null` cases), and `createBrowser.test.ts` (the history stack: record/traverse, forward-truncation, in-place refresh). The [`example/docsite`](example/docsite) second host carries its own reuse-proof suite.
