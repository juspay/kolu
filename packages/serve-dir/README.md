# @kolu/serve-dir

A fetch-native file server for a directory: bind an absolute root, get back a `(relPath, Request) → Response` that streams byte ranges. Zero workspace deps — only `node:fs`/`node:path`/`node:stream` — so the dependency arrow points *out*: a consumer plugs in the volatile bits, the package owns the serving mechanics.

It exists because no off-the-shelf static server fits the shape Kolu needs (a 20-agent prior-art survey, recorded in [`docs/atlas/src/content/atlas/electricity.mdx`](../../docs/atlas/src/content/atlas/electricity.mdx), found none did):

| Constraint | Why static-serve libraries miss it |
|------------|-----------------------------------|
| **Per-request absolute root** | They bind one fixed root at registration (`@hono/node-server`'s `serveStatic` rejects absolute roots outright). Kolu's root is a different terminal's repo per request. |
| **Returns a Fetch `Response`** | `send`/`serve-static`/`@fastify/static`/`koa-send`/`st` all `.pipe()` straight to a Node socket — there's no `Response` for downstream middleware to read. |
| **Composes with a body transform** | A downstream middleware (Kolu's artifact-sdk `<script>` injector) rewrites `text/html` bodies *after* serving, so a pinned `Content-Length` would truncate the result. This package omits `Content-Length` on full 200s and lets the runtime derive it from the bytes actually sent. |
| **Streaming range** | `Range → 206` must stream only the requested bytes from a file handle, never buffer a multi-GB file into the heap. |

The one full-fit shape is `createReadStream({start,end}) → Readable.toWeb → Response` (what Deno `@std/http` and SvelteKit/Vite converge on), so it's owned here rather than vendored.

## Install

Workspace-private package. Wire it into the consuming server package:

```jsonc
// packages/server/package.json
{
  "dependencies": {
    "@kolu/serve-dir": "workspace:*"
  }
}
```

## Usage

`createDirServer(root, realpathGuard?)` is the receptacle. The consumer injects the two things that are *its* concern — **which** root, and **whether** to enforce a filesystem-authority guard — and the package owns everything else (range parsing, content types, lexical traversal safety, status mapping):

```ts
import { createDirServer } from "@kolu/serve-dir";

// In a Hono route handler — root resolved per request, guard wired by the consumer:
app.get("/files/:id/*", (c) => {
  const root = lookupRoot(c.req.param("id"));        // consumer's domain
  if (!root) return c.text("not found", 404);
  return createDirServer(root, myRealpathGuard(root))
    .fetch(tailFromRawUrl(c.req.raw.url), c.req.raw); // → 200 | 206 | 416 | 403 | 404 | 500
});
```

Slice the tail from the **raw, undecoded** URL (`new URL(c.req.raw.url).pathname`), not a framework-decoded path — `resolvePathUnder` decodes once internally, so a pre-decode would double-decode `%`-bearing filenames *and* lose the `%2f`-smuggling defense.

### Path safety (two stages, by volatility)

- **Lexical** — built in, pure, universal. `resolvePathUnder` decodes the whole tail, splits, rejects `..`/empty/absolute segments, then re-checks containment with `path.relative`. Defeats URL-encoded `..` and `%2f` smuggling before any I/O.
- **Realpath/symlink** — *injected*, because it touches the filesystem and encodes the consumer's threat model. Pass a `RealpathGuard` (`(abs) => Promise<boolean>`) and it runs **before** any `open`/`stat`/`read`, so a planted `leak.html -> /etc/passwd` is rejected with 403 before a byte is read. Omit it and the package stays lexical-only — it never silently imposes a filesystem-authority policy you didn't ask for.

This split keeps the package agnostic: it ships no default symlink behavior, so it can't know (or import) any consumer's idea of "under the root."

## API reference

| Export | Signature | Notes |
|--------|-----------|-------|
| `createDirServer` | `(root: string, realpathGuard?: RealpathGuard) → { fetch(relPath, request): Promise<Response> }` | The receptacle. Reads the `Range` header off the request; returns a Fetch `Response`. |
| `serveFile` | `(root, relPath, rangeHeader?, realpathGuard?) → Promise<ServeResult>` | The I/O half as a plain value (no `Response`), for testing the status/header/body without crafting a `Request`. |
| `resolvePathUnder` | `(root, rawTail) → PathResolution` | Pure lexical guard (no I/O). `{ ok, abs, mime } \| { ok: false, status, reason }`. |
| `parseByteRange` | `(header, size) → { start, end } \| "invalid" \| null` | Single-range `bytes=` parser. `null` = serve whole file (no/open/multi-range); `"invalid"` → 416. Hand-rolled deliberately (`range-parser` regresses the RFC-9110 suffix-overflow case). |
| `contentTypeForPath` | `(filePath) → string` | Extension → Content-Type; `application/octet-stream` for unknowns. |
| `RealpathGuard` | `type (abs: string) => Promise<boolean>` | Injected filesystem-authority guard. `true` allows, `false` → 403. |
| `ServeResult` | `interface { status; headers; body: string \| ReadableStream }` | Error bodies are `string`; success bodies (200/206) stream. |
| `PathResolution` | discriminated union | Result of `resolvePathUnder`. |

Responses advertise `Accept-Ranges: bytes`; 206 carries `Content-Range` + `Content-Length`; full 200s deliberately carry **no** `Content-Length` (see the body-transform constraint above).

## Design notes

- **No `Content-Length` on full 200s.** The runtime sets it from the bytes written, which is both race-free on a live-reloading root and safe for a downstream HTML rewrite. The 206 branch *does* set it (a partial response must, and a ranged body is never HTML-decorated).
- **One open handle per ranged response.** The range path does `open → handle.stat() → handle.createReadStream({start,end})`, so the size in the headers and the streamed bytes come from one file description — an atomic replace (write-temp-then-rename) can't desync them.
- **Lexical guard is independent of the realpath guard.** Traversal safety holds even with no guard injected; the realpath guard adds symlink-escape rejection on top.

See `src/index.test.ts` for the behavioral contract (range parsing, the lexical guard, 200/206/416, atomic-replace streaming, and the injected-guard mechanism). The Kolu-specific couplings (its previewable-extension classifier ↔ Content-Type coverage, and the real git realpath guard it injects) are verified in the consumer, in `packages/server/src/iframePreviewRoute.test.ts`.
