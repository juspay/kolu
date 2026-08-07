# @kolu/serve-dir

A file server for a directory: name an absolute root and a raw request tail, get back an `Effect` whose value is the HTTP answer, streaming byte ranges. Zero *workspace* deps — `node:fs`/`node:path`/`node:stream` plus the focused [`mrmime`](https://github.com/lukeed/mrmime) MIME table — so the dependency arrow points *out*: a consumer plugs in the volatile bits, the package owns the serving mechanics.

It exists because no off-the-shelf static server fits the shape Kolu needs (a 20-agent prior-art survey, recorded in [`docs/atlas/src/content/atlas/electricity.mdx`](../../docs/atlas/src/content/atlas/electricity.mdx), found none did):

| Constraint | Why static-serve libraries miss it |
|------------|-----------------------------------|
| **Per-request absolute root** | They bind one fixed root at registration (`@hono/node-server`'s `serveStatic` rejects absolute roots outright). Kolu's root is a different terminal's repo per request. |
| **Hands back a value, not a socket write** | `send`/`serve-static`/`@fastify/static`/`koa-send`/`st` all `.pipe()` straight to a Node socket — there's no status/headers/body value for downstream middleware to read or rewrite. |
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

`serveFile(root, rawTail, rangeHeader?, realpathGuard?, ifRangeHeader?)` is the receptacle — a scoped `Effect` whose success value IS the HTTP answer. The consumer injects the two things that are *its* concern — **which** root, and **whether** to enforce a filesystem-authority guard — and the package owns everything else (range parsing, content types, lexical traversal safety, status mapping, and closing the descriptor on every exit, interruption included):

```ts
import { getHeaderCI, rawPathname, serveFile } from "@kolu/serve-dir";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

// One route — root resolved per request, guard wired by the consumer:
HttpRouter.add(
  "GET",
  "/files/:id/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const id = (yield* HttpRouter.params).id;
    const root = id === undefined ? undefined : lookupRoot(id); // consumer's domain
    if (root === undefined) return notFound();
    // The RAW request target, NOT a `new URL(...)` round trip.
    // `HttpServerRequest.url` on the node handler path IS the raw
    // `IncomingMessage.url` (origin-form, un-normalized); `rawPathname` strips
    // the query/fragment without normalizing dot segments.
    const tail = rawPathname(request.url).slice(`/files/${id}/`.length);
    // → 200 | 206 | 416 | 403 | 404 | 500, with the body streaming on 2xx.
    // The descriptor's lifetime is the effect's: an abandoned seek interrupts
    // the fiber, and the finalizer closes the handle.
    return toResponse(
      yield* serveFile(
        root,
        tail,
        getHeaderCI(request.headers, "range"),
        myRealpathGuard(root),
        getHeaderCI(request.headers, "if-range"),
      ),
    );
  }),
);
```

Get the tail with serve-dir's exported **`rawPathname`**, which slices the path off the raw request-target string — strip `scheme://authority`, then cut at the first `?`/`#` — explicitly **without** `new URL`. Do **not** use `new URL(...).pathname` or a router's own wildcard param (`HttpRouter.params["*"]`): `new URL().pathname` runs WHATWG path normalization that **collapses `..`/`%2e%2e` segments before the lexical guard can reject them** (reopening the directory-traversal hole this package exists to close), and a router that hands back `decodeURIComponent`d params double-decodes `%`-bearing filenames and erases the `%2f`-smuggling boundary — `resolvePathUnder` decodes exactly once internally. Feed it the raw, undecoded tail.

### Path safety (two stages, by volatility)

- **Lexical** — built in, pure, universal. `resolvePathUnder` decodes the whole tail, splits, rejects `..`/empty/absolute segments, then re-checks containment with `path.relative`. Defeats URL-encoded `..` and `%2f` smuggling before any I/O.
- **Realpath/symlink** — *injected*, because it touches the filesystem and encodes the consumer's threat model. Pass a `RealpathGuard` (`(abs) => Effect<boolean>`) and it runs **before** any `open`/`stat`/`read` — inside the read's own scope, so interrupting the read interrupts the guard's filesystem walk, so a planted `leak.html -> /etc/passwd` is rejected with 403 before a byte is read. Omit it and the package stays lexical-only — it never silently imposes a filesystem-authority policy you didn't ask for.

This split keeps the package agnostic: it ships no default symlink behavior, so it can't know (or import) any consumer's idea of "under the root."

## API reference

| Export | Signature | Notes |
|--------|-----------|-------|
| `serveFile` | `(root, rawTail, rangeHeader?, realpathGuard?, ifRangeHeader?) → Effect<ServeResult>` | The receptacle. The status IS the success value (the error channel is `never` — a 404 and a 500 are answers, not failures). Built on `Effect.acquireUseRelease`, so an interrupt closes the descriptor. |
| `resolvePathUnder` | `(root, rawTail) → PathResolution` | Pure lexical guard (no I/O). `{ ok, abs, mime } \| { ok: false, status, reason }`. |
| `rawPathname` | `(rawUrl: string) → string` | The path of a request URL **without** WHATWG normalization — strips `scheme://authority`, cuts at the first `?`/`#`. Use this to get the tail for `serveFile`; `new URL().pathname` would collapse `..` segments past the lexical guard (see Usage). |
| `parseByteRange` | `(header, size) → { start, end } \| "invalid" \| null` | Single-range `bytes=` parser. `null` = serve whole file (no/open/multi-range); `"invalid"` → 416. Hand-rolled deliberately (`range-parser` regresses the RFC-9110 suffix-overflow case). |
| `rangeResponseHead` | `(resolved: { start, end } \| null, size, baseHeaders) → { status, headers }` | The response-**shaping** half of the range contract (consumes `parseByteRange`'s output): `null` → `200` with `baseHeaders` unchanged (deliberately **no** `Content-Length`); a `{ start, end }` → `206` extending them with `Content-Range: bytes <start>-<end>/<size>` + `Content-Length`. One source of truth for the header shape — `serveFile` and any remote arm re-serving the bytes over the wire both call it, so they differ only in where the body comes from. |
| `contentTypeForPath` | `(filePath) → string` | Extension → Content-Type, backed by `mrmime`'s **complete** IANA table (not a curated subset) + a tiny `OVERRIDES` map for generic types mrmime omits (`.m4v`, `.ico`); text-bearing types get `; charset=utf-8`. `application/octet-stream` for unknowns. The ext↔MIME coupling is **dissolved** for every mrmime-known format; for the **mrmime gap set** (`.m4v`/`.ico`, and any future classifier entry mrmime doesn't know) it is **contained-by-test** — `OVERRIDES` and the consumer's classifier must co-vary, and the `iframePreviewRoute.test.ts` coverage invariant is load-bearing for that axis (drop an entry and the file silently serves as `octet-stream` → download). |
| `RealpathGuard` | `type (abs: string) => Effect<boolean>` | Injected filesystem-authority guard, run inside the read's scope. `true` allows, `false` → 403. |
| `ServeResult` | `interface { status; headers; body: string \| ReadableStream }` | Error bodies are `string`; success bodies (200/206) stream. |
| `PathResolution` | discriminated union | Result of `resolvePathUnder`. |

Responses advertise `Accept-Ranges: bytes`; 206 carries `Content-Range` + `Content-Length`; full 200s deliberately carry **no** `Content-Length` (see the body-transform constraint above). Every streamed 200/206 also carries a strong `ETag` (size + mtime + inode from the same `stat` that sizes the response). serve-dir doesn't honor conditional requests itself — the validator exists so a re-serving arm that reassembles one response from **multiple** reads (a remote-bound preview dialing in chunks) can prove all chunks came from one file snapshot and fail loud on a mid-flight change, the cross-read analogue of the single-open-handle invariant below.

## Design notes

- **No `Content-Length` on full 200s.** The runtime sets it from the bytes written, which is both race-free on a live-reloading root and safe for a downstream HTML rewrite. The 206 branch *does* set it (a partial response must, and a ranged body is never HTML-decorated).
- **One open handle per ranged response.** The range path does `open → handle.stat() → handle.createReadStream({start,end})`, so the size in the headers and the streamed bytes come from one file description — an atomic replace (write-temp-then-rename) can't desync them.
- **Lexical guard is independent of the realpath guard.** Traversal safety holds even with no guard injected; the realpath guard adds symlink-escape rejection on top.

See `src/index.test.ts` for the behavioral contract (range parsing, the lexical guard, 200/206/416, atomic-replace streaming, and the injected-guard mechanism). The Kolu-specific couplings (its previewable-extension classifier ↔ Content-Type coverage, and the real git realpath guard it injects) are verified in the consumer, in `packages/server/src/iframePreviewRoute.test.ts`.
