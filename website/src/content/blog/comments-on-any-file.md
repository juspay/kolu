---
title: "Comments on any file: a queue-and-paste review loop for agent output"
description: "Kolu's Code tab now lets you select text in source files, branch diffs, or rendered HTML artifacts and leave free-text notes that accumulate into a Markdown queue ready to paste back into the agent. One gesture, three surfaces, one anchor model."
pubDate: 2026-05-19
author: "Sridhar Ratnakumar"
---

_Kolu's Code tab now lets you select text in source files, branch diffs, or rendered HTML artifacts and leave free-text notes that accumulate into a Markdown queue. "Copy to clipboard" flushes the queue and you paste it back into the agent. One gesture, three surfaces, one anchor model._

When the agent finishes a turn, you read what it produced. You spot something — a function name you don't like, a refactor that went one step too far, a row of a comparison table that's wrong, a paragraph of generated HTML that misreads the source. The natural move is to **point at that thing and say what's wrong with it**. The unnatural move is what the workflow used to require: scroll back, paraphrase from memory in plain text, lose precision, hope the agent finds the right spot.

This is the loop that PR [#922](https://github.com/juspay/kolu/pull/922) closes. Build on top of the iframe-preview surface from [#918](https://github.com/juspay/kolu/pull/918), and the artifact-review workflow becomes end-to-end: the agent emits an artifact (code, diff, HTML), you read it in the Code tab, you point-and-comment, the queue copies out as Markdown that quotes back exactly what you pointed at. The agent re-locates each comment by quote-matching against the file, applies edits, you re-read. The loop closes without a paraphrase step.

## The shape

Three surfaces in the Code tab now share one comment pipeline:

```
text browse  ─▶ FileView  ─┐
branch diff  ─▶ FileDiff  ─┼─▶ useTextSelection ─┐
                           │   (parent DOM)      │
HTML iframe  ─▶ <iframe>  ─┘                     ▼
                                          composerState ─▶ useComments ─▶ localStorage
              in-iframe SDK ─▶ bridge ─────┘             │   (per-terminal)
              (postMessage)                              ▼
                                                  CommentsTray ─▶ formatMarkdown ─▶ clipboard
```

The capture site differs per surface — parent listens to `selectionchange` for text/diff; the in-iframe SDK does the same gesture inside the opaque-origin sandbox and `postMessage`s the result up — but **everything downstream of capture is one code path**.

That's the seam the design hinged on. Earlier sketches treated text and HTML as different concepts with different selector models (line ranges for text, CSS selectors for HTML, bounding boxes for images), and the cost was three composers, three trays, three clipboard formats. Once selection-anchored-by-quote becomes the universal locator, the surface kind is implementation-internal: a user selecting text in a rendered HTML chart isn't doing a categorically different thing from selecting text in a source file.

## The locator: W3C TextQuoteSelector

A comment needs to remember _where_ it was anchored, with enough robustness to survive the agent's edits. There are three families of options:

| Approach | Robust to edits? | DOM-agnostic? | Wire-cheap? |
| --- | --- | --- | --- |
| Line numbers (`file.ts:42-45`) | No — first reformat invalidates | Yes (text only) | Yes |
| CSS selectors / XPath | No — DOM rewrites break paths | No (DOM only) | Yes |
| Character ranges (offset start/end) | No — any prefix edit shifts offsets | Yes | Yes |
| Quote + prefix + suffix (W3C TextQuoteSelector) | **Yes** — re-found by string match | **Yes** | Yes |

W3C [TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector) is the W3C Web Annotation model's standard anchor. The locator is `{ quote, prefix, suffix }` — the selected text plus a small context window on either side. Re-finding the anchor is a string search against the document; the prefix/suffix disambiguate when the quote appears multiple times.

```ts
// In artifact-sdk/core/types.ts
export type Locator = {
  quote: string;   // the user-selected text
  prefix: string;  // ~32 chars before, for disambiguation
  suffix: string;  // ~32 chars after, for disambiguation
};
```

The agent that consumes the clipboard payload doesn't need a DOM. It greps the file for the quote, scores candidates by prefix/suffix match, picks the highest-scoring hit, and applies the edit. _The locator is a portable string search, not a structural reference._

This is why text browse, branch diff, and HTML iframe all share one locator type: there's no DOM-specific information in it. A quote anchored in rendered HTML lands in the same `{quote, prefix, suffix}` shape as a quote anchored in a `.ts` file. The downstream pipeline doesn't branch on surface.

The pure functions live in `packages/artifact-sdk/src/core/` and are tested standalone:

- `extractQuote(range, root)` — build a Locator from a live browser Range.
- `findQuote(text, locator)` — re-locate a Locator's offsets in a string, with prefix/suffix scoring.
- `applyHighlights(window, root, comments, name)` — register a CSS Custom Highlight for every locator that re-finds successfully.

These three functions are the entire algorithmic surface. Everything else (the postMessage bridge, the composer popover, the tray) is plumbing.

## The shadow-DOM tax

`window.getSelection()` cannot return a selection whose anchor or focus lives inside a shadow tree. Per the [Selection API spec](https://w3c.github.io/selection-api/), the user-agent's `Selection` represents the document-level selection — and shadow-root content is, by design, opaque to that.

Kolu uses [Pierre's file viewer + diff renderer](https://www.pierrecomputer.com/) which attaches an open shadow root (`mode: "open"`) to a `<diffs-container>` custom element and renders all the user-visible text inside it. A user dragging across syntax-highlighted code selects DOM nodes that live in Pierre's shadow tree. `window.getSelection()` returns a collapsed (empty) selection for those drags.

Chrome's escape hatch is `ShadowRoot.getSelection()` — a method on each `ShadowRoot` instance that returns _that_ tree's active selection. So:

```ts
// packages/client/src/comments/useTextSelection.ts
function getShadowAwareSelection(host: HTMLElement): Selection | null {
  // Walk descendant shadow roots in DFS order. The first non-collapsed
  // selection wins; fall back to document selection if nothing's open.
  const stack: Element[] = [host];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const sr = el.shadowRoot;
    if (sr) {
      const inShadow = sr.getSelection?.();
      if (inShadow && inShadow.rangeCount > 0 && !inShadow.isCollapsed) {
        return inShadow;
      }
      for (const child of Array.from(sr.children)) stack.push(child);
    }
    for (const child of Array.from(el.children)) stack.push(child);
  }
  return window.getSelection();
}
```

The bug this fixes is one I almost shipped. The first e2e test used `Selection.addRange(...)` to synthesize a selection — bypassing `getSelection()` entirely. The test passed; the production code crashed silently (empty selection, no pill). The fix was to rewrite the e2e to drive **real mouse gestures** via `page.mouse.down/move/up` across the target text's bounding rect. That test caught the bug on first run — and now stays in the suite as a regression boundary.

_Lesson: e2e tests that bypass the user's actual gesture are theatre. The shadow-DOM tax is real and the only way to verify the workaround is to make the browser do what the user does._

## The iframe tax

HTML artifacts — the agent emits a chart, a comparison table, a dashboard, a generated report — render in a **sandboxed iframe** at an opaque origin. The sandbox flag is `allow-scripts` only; no `allow-same-origin`, so the iframe document has the origin string literal `"null"` and can't read kolu's cookies or localStorage. Cross-origin `fetch()` from inside is blocked — acceptable for a view-only artifact preview.

But this means **the parent and iframe can't share a Selection object, can't share a DOM, can't share a `getSelection()` call.** The user drags inside the iframe, the iframe's own document has the selection, and the parent's `getSelection()` sees nothing.

`postMessage` is the only bridge that survives opaque-origin isolation. So the iframe gets its own copy of the selection-capture code — bundled at server startup, injected as a `<script>` tag into `text/html` responses by a Hono middleware. When the user selects text inside the iframe, the in-iframe SDK builds a Locator and `postMessage`s it to the parent. The parent receives the message and routes it to the same `composerState.open(...)` singleton that text browse uses.

```
parent                                     iframe (opaque origin "null")
─────────                                  ─────────────────
                                           selectionchange ─▶ build Locator
              ◀── postMessage ────────────  send SelectMsg
composer.open(...)
   │
   ▼
useComments.add(...)
   │
   ▼ (data changes)
pushHighlightsTo(el, list) ── postMessage ─▶  applyHighlights(window, document)
                                                  └─ CSS Custom Highlight
```

Two postMessages: one inward (the selection), one outward (the highlights). The bridge stays narrow: identity-check `event.source === iframe.contentWindow` (origin-based validation is meaningless when the origin is `"null"`), drop unknown message types via `match(...).otherwise(...)`, push the path on every iframe `load` event so in-iframe link clicks (which don't change the iframe `src`) still produce a working SDK on the new document.

The package boundary is the artifact in this design. `@kolu/artifact-sdk` ships three subpath exports:

| Subpath | Owns |
| --- | --- |
| `./types` | The wire protocol — `SelectMsg`, `ReadyMsg`, `PathMsg`, `RenderHighlightsMsg`, `Locator`. One module both runtimes import. |
| `./client` | The parent-side `bindArtifactSdk(iframe, opts)` and `pushHighlightsTo(iframe, comments)` — plus re-exports of the pure `core/` algorithms so the parent can reuse `findQuote` / `applyHighlights` for non-iframe text surfaces. |
| `./server` | One function: `mountArtifactSdk(app, opts)` — registers the SDK bundle route and a Hono middleware that splices the SDK `<script>` into `text/html` responses. esbuild bundles the in-iframe entry at server startup; the host server has one line of integration code. |

The host server never knows HTML decoration exists. The byte-streaming `iframePreviewRoute.ts` from #918 is untouched — `mountArtifactSdk` wraps it from outside via the middleware seam. The dependency arrow points `server → artifact-sdk`, never the reverse.

## The per-terminal keying decision

The store is keyed by `terminalId`, not by `repoRoot`. Each terminal has its own comment queue.

The first design was the opposite — `useComments(repoRoot)` — and the rationale was _"comments travel with the repo, not the directory; intent is about the codebase, not the worktree."_ It sounds reasonable in isolation. It was wrong for the actual workflow.

In practice, each terminal is:

- A separate **agent conversation** (the terminal's history is the chat with that specific instance)
- Often a separate **worktree** (different feature branch, different review context)
- Often a separate **session** (you can have a kolu terminal running Claude Code, another running OpenCode, both on the same repo)

Sharing the comment queue across all of these means your half-formed Claude feedback shows up in the OpenCode terminal's tray. It's surprise behaviour, and the fix is structural — key the store by the identity that actually scopes the review context.

```ts
// packages/client/src/comments/useComments.ts
const STORAGE_PREFIX = "kolu:comments-by-terminal:";

const storesByKey = new Map<string, CommentStore>();

function storeFor(terminalId: string): CommentStore {
  const existing = storesByKey.get(terminalId);
  if (existing) return existing;
  const [signal, setSignal] = makePersisted(
    createSignal<PersistedShape>({ v: 1, comments: [] }),
    { name: `${STORAGE_PREFIX}${terminalId}`, /* ... */ },
  );
  // ...
  storesByKey.set(terminalId, wrapped);
  return wrapped;
}
```

The schema gets a `v: 1` envelope from commit one — not because there's a migration today, but because the moment you ship persisted data without a version field, future-you is locked out of changing the shape.

## The clipboard payload: plain Markdown

The original plan called for a `[kolu comments v1]` envelope wrapping the clipboard payload — a stable-contract identifier so the agent could distinguish kolu-emitted comments from arbitrary pasted text.

It's not there. The clipboard format is plain Markdown, no envelope:

```md
**packages/client/src/right-panel/CodeTab.tsx**
> "isDiffView"
agent should rename this — too easy to confuse with `isDiff()`

**packages/server/src/router.ts**
> "schedulers.startedAt"
this should be `createdAt` for consistency with the other tables
```

The envelope didn't earn its keep. The agent receiving this payload reads it as instructions — _"go change these things"_ — and treats the quoted text as the locator to grep for. No version negotiation, no protocol-level handshake. If the format changes later, that's a breaking change to the agent prompt, not to a wire protocol.

The persisted shape on disk still has a `{v: 1}` envelope because that's the migration hook — it survives future schema drift. The clipboard format is the agent-facing surface and stays plain.

## The Solid reactivity tax

This one bit me. After shipping the per-terminal keying, the tray sometimes wouldn't appear when I left a comment — a full page refresh would fix it. The bug repro:

1. User opens kolu.
2. CodeTab mounts. `props.terminalId` is briefly the empty string while `meta.git.repoRoot` is streaming in.
3. CommentsTray mounts: `const store = useComments(props.terminalId)` — captures the empty string as the key, binds `store` to `storeFor("")`.
4. Meta resolves. `props.terminalId` becomes `<real-id>`. Composer's submit handler (inside an event callback — reads `props.terminalId` fresh at click time) writes to `storeFor("<real-id>")`.
5. Tray's `store.comments()` reads from `storeFor("")`. Empty. Tray stays hidden.
6. Refresh re-mounts the tray with the real terminalId already populated. Comment appears.

The fix is **`createMemo`**:

```ts
// Wrong — captures props.terminalId once at mount
const store = useComments(props.terminalId);

// Right — re-derives when the prop ticks
const store = createMemo(() => useComments(props.terminalId));
// usage: store().comments(), store().add(...)
```

SolidJS component bodies don't re-execute on re-render. Only JSX-embedded reactive reads and `createEffect`/`createMemo` bodies do. A plain `const x = useHook(props.y)` line in the component body reads `props.y` exactly once, at mount.

The existing `props-stay-reactive` lint rule covered destructuring (`const { y } = props`), but missed function-argument passing (`useHook(props.y)`) — semantically identical, syntactically different. The fix was to add a new code-police rule (`solid-reactive-prop-passed-to-hook-must-be-reactive`) that names the failure mode, so the next time an LLM or human writes `const store = useComments(props.terminalId)` outside a reactive scope, the reviewer (or `/code-police`) flags it.

This is the kind of bug that LLM-generated code is structurally prone to. The diff looks innocuous — it reads exactly like the destructuring-warning pattern but doesn't trip it. Tests pass on machines fast enough that meta resolves before mount. Slower machines (or unlucky timing) catch it. _Codifying the rule was the actual fix._

## What you can do now

If you're running kolu, this is what's at your fingertips in the Code tab:

- **Drag-select any text in any file** (source, diff, or rendered HTML preview). A floating "+ Comment" pill appears next to the selection.
- **Click the pill, type a note, hit ⌘↵.** The comment lands in a tray at the bottom of the panel, with the file path and an italicized quote of what you pointed at.
- **Switch files freely.** The tray accumulates across every file in the active terminal's worktree — review a branch diff across ten files and queue ten comments before flushing.
- **Click a tray entry to jump.** The Code tab navigates to the comment's file and line; the CSS Custom Highlight underlines the original quote in the file viewer.
- **"Copy to clipboard"** flushes the queue as Markdown and clears the tray. Paste into the agent's prompt.

Tip: the comments tray hides itself when empty. There's no toggle, no "mode" — visibility is just `comments.length > 0`. The entire "mode-vs-state" bug class is impossible by construction.

## Why this matters

The artifact-review workflow has been the rough edge of agent-collaboration UX since chat assistants started writing real code. The agent's output is concrete (a diff, a function, a table, a paragraph of HTML); the human's response was an abstraction (a paragraph of plain prose, paraphrasing what they pointed at). The asymmetry forces a mental tax — _"how do I describe in words what I'm looking at?"_ — and dilutes precision.

Quote-anchored comments make the human's response **as concrete as the agent's output**. You point at the chart bar; the clipboard payload quotes "5.2%" with its surrounding context; the agent greps the file for "5.2%" and finds the line. No paraphrase, no offset arithmetic, no fragile structural references.

The fact that source code, branch diffs, and rendered HTML all funnel through the same gesture means the workflow stays one workflow as the agent's output gets richer. The next agent that emits a portable HTML dashboard with embedded SVG annotations works the same way you review source code today: select, comment, queue, paste.

## Try it

```sh
nix run github:juspay/kolu/master
```

Open a terminal, run an agent, ask it to do something with multiple discrete outputs (write a service, generate a comparison table as HTML, refactor a function). When the reply lands, switch to the Code tab and start selecting.

The full PR with the design walk and review-by-review refinement walk is at [#922](https://github.com/juspay/kolu/pull/922). The artifact-sdk package is browsable at [`packages/artifact-sdk/`](https://github.com/juspay/kolu/tree/master/packages/artifact-sdk) — it's published as a workspace-private package today, but the pure-DOM `core/` algorithms are deliberately framework-agnostic and could surface as a standalone npm package if there's interest.
