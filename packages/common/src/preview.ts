/** File-extension classification for the Code browser's preview pipeline.
 *  Node-free and dependency-free so the node server AND the browser client
 *  import the *same* source — the seam that historically drifted when a
 *  server list and a client list were kept in step only by a prose comment
 *  (an image format added on one side rendered as garbage on the other).
 *
 *  Lives in kolu-common, not kolu-git: classification is a preview concern
 *  shared across client and server, not a git operation. It feeds two
 *  decisions:
 *    - SERVER: `isBinaryPreviewable` picks the `FsReadFileOutput.kind` wire
 *      variant (inline text vs a route-served URL) — the schema lives in
 *      `kolu-git/schemas.ts`.
 *    - CLIENT: `isRasterImage` / `isMarkdown` pick the rendered appliance in
 *      `@kolu/solid-fileview` — a plain `<img>`, a sandboxed iframe, or a
 *      rendered Markdown document.
 *
 *  Three disjoint sets partition the binary-previewable space:
 *    - SANDBOX — rendered in an `allow-scripts`, opaque-origin iframe.
 *      `.html`/`.htm`/`.svg` can carry scripts; `.pdf` rides the same
 *      sandbox. The set is the security boundary and changes rarely.
 *    - RASTER — rendered with a plain `<img>` (image bytes can't execute).
 *      This is a volatile axis (new formats: avif, jxl, …).
 *    - VIDEO — rendered with a `<video controls>` element (the file route
 *      serves it with a real `video/*` Content-Type and HTTP range support
 *      so the player can seek). Also volatile (new codecs/containers).
 *
 *  `BINARY_PREVIEWABLE_EXTENSIONS` is their union, so a new previewable
 *  format cannot be added without being placed in exactly one category —
 *  the "every non-document binary is an image or a video" assumption is
 *  structural, not a convention a future edit can quietly break.
 *
 *  Markdown is a *separate* axis: it stays `kind:"text"` on the wire (there's
 *  no server URL — the client renders it from `content`), so `isMarkdown`
 *  isn't part of the binary partition. It tells the client a text file also
 *  has a rendered form, which is what lights the Source ⇄ Rendered toggle. */

export const SANDBOX_PREVIEWABLE_EXTENSIONS = [
  ".html",
  ".htm",
  ".svg",
  ".pdf",
] as const;

export const RASTER_IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
] as const;

/** Video containers the `<video>` element can play across the browsers Kolu
 *  targets. `.mov` is QuickTime but ships H.264/AAC in practice, which Chrome
 *  and Safari play; non-web codecs (`.mkv`, `.avi`) are deliberately absent —
 *  they'd serve as a binary URL the player can't decode. */
export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
  ".ogv",
] as const;

export const BINARY_PREVIEWABLE_EXTENSIONS = [
  ...SANDBOX_PREVIEWABLE_EXTENSIONS,
  ...RASTER_IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
] as const;

/** Text files the Code browser can render as a document. Stays
 *  `kind:"text"` on the wire — there's no server URL; the client renders it
 *  from `content` via `@kolu/solid-markdown`. */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

function hasExtension(filePath: string, exts: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** Server: should this file bypass the UTF-8 text read and instead be served
 *  by the file route as `kind: "binary"`? */
export function isBinaryPreviewable(filePath: string): boolean {
  return hasExtension(filePath, BINARY_PREVIEWABLE_EXTENSIONS);
}

/** Client: of the binary-previewable files, render this one with a plain
 *  `<img>` rather than the sandboxed iframe? */
export function isRasterImage(filePath: string): boolean {
  return hasExtension(filePath, RASTER_IMAGE_EXTENSIONS);
}

/** Client: of the binary-previewable files, render this one with a
 *  `<video controls>` element rather than an `<img>` or the iframe? */
export function isVideo(filePath: string): boolean {
  return hasExtension(filePath, VIDEO_EXTENSIONS);
}

/** Client: of the binary-previewable files, render this one in the sandboxed
 *  iframe (`.html`/`.htm`/`.svg`/`.pdf`) rather than an `<img>` or `<video>`?
 *  Names the sandbox branch of the three-way partition at the dispatch site so
 *  an unclassified binary surfaces as a visible no-match instead of silently
 *  landing in an iframe that can't render it. */
export function isSandboxPreviewable(filePath: string): boolean {
  return hasExtension(filePath, SANDBOX_PREVIEWABLE_EXTENSIONS);
}

/** Client: does this text file have a rendered Markdown form, so the Code
 *  browser offers a Source ⇄ Rendered toggle (defaulting to rendered)? */
export function isMarkdown(filePath: string): boolean {
  return hasExtension(filePath, MARKDOWN_EXTENSIONS);
}

/** Per-segment codec for the repo-relative path embedded in the iframe-preview
 *  URL (`/api/terminals/{host}/{id}/file/{encoded/path}`). Same kolu-common rationale
 *  as the classifiers above: both sides of the wire must agree. The CLIENT
 *  builds the URL (`buildTerminalFileUrl` in `right-panel/BrowseFileDispatcher.tsx`)
 *  and also inverts it (`@kolu/solid-browser`'s `pathFromPreviewPathname`, with
 *  this codec bound in `right-panel/BrowseIframeRenderer.tsx`, to follow
 *  in-iframe link navigation); the HTTP route decodes the same encoding to
 *  stream the bytes (re-backed by padi's `preview.read`, see `iframePreviewRoute.ts`)
 *  — a single source keeps the encode/decode from drifting, so links into
 *  subdirectories or paths with spaces resolve to the right file.
 *
 *  Slashes stay literal (segment boundaries); each segment is percent-encoded
 *  so a name with spaces or reserved characters survives the URL round-trip. */
export function encodePreviewPath(repoRelPath: string): string {
  return repoRelPath.split("/").map(encodeURIComponent).join("/");
}

/** Invert `encodePreviewPath`. Throws on a malformed percent-sequence (the
 *  caller decides whether that means "ignore" or "error"). */
export function decodePreviewPath(encoded: string): string {
  return encoded.split("/").map(decodeURIComponent).join("/");
}

/** Kolu's preview-URL codec — the `{ encode, decode }` pairing the inversion
 *  in `@kolu/solid-browser` (`pathFromPreviewPathname`) injects. The concept
 *  "these two functions form kolu's codec" lives here, where both halves are
 *  defined, rather than being rebuilt at each consumer. Typed structurally
 *  (not against `@kolu/solid-browser`'s `PreviewPathCodec`, which would invert
 *  the dependency) — the shape is the wire contract both sides agree on. */
export const previewPathCodec: {
  encode: (path: string) => string;
  decode: (encoded: string) => string;
} = { encode: encodePreviewPath, decode: decodePreviewPath };

/** Base of the per-terminal file route + its `file` segment. Shared so the
 *  HTTP route registration (re-backed by padi's `preview.read`), the client's
 *  URL builder, and the client (which resolves repo-relative Markdown image
 *  srcs) all agree on one shape —
 *  `${BASE}/{host}/{terminalId}/${FILE}/{encoded/path}`. The leading `{host}`
 *  segment names WHICH padi in the pool owns the terminal, so a tab viewing a
 *  remote host reads that host's bytes (not the local default's). */
export const TERMINAL_FILE_ROUTE_BASE = "/api/terminals";
export const TERMINAL_FILE_ROUTE_FILE_SEGMENT = "file";

/** Build the per-terminal file-route URL for a repo-relative path (no cache
 *  key). `host` is the pool key of the padi that owns the terminal (the tab's
 *  active host) — it rides as a leading path segment so the HTTP route resolves
 *  the bytes against the RIGHT host, and an in-iframe relative link keeps it in
 *  the path prefix. The client appends `?v=<mtime>` (from `fs.statFileMtimeMs`,
 *  in `BrowseFileDispatcher`) for the iframe surface; the rendered-Markdown
 *  image path uses the bare URL to point at the actual repo file it references. */
export function buildTerminalFileUrl(
  host: string,
  terminalId: string,
  repoRelPath: string,
): string {
  return `${TERMINAL_FILE_ROUTE_BASE}/${encodeURIComponent(host)}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/${encodePreviewPath(repoRelPath)}`;
}
