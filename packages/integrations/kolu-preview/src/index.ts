/** kolu-preview — Phase 1 preview proxy for iframe-of-dev-server tiles (#633).
 *
 *  One-shot install against a caller-owned Hono app + Node HTTP server.
 *  The HTTP middleware matches Host headers of the form `<port>.preview.
 *  <anything>` and fetch-and-streams to `127.0.0.1:<port>`; the WS
 *  upgrade helper does the same for WebSocket handshakes. Callers own
 *  the Hono app and the HTTP server — we hand back a WS `handle` that
 *  the caller's own `server.on('upgrade', ...)` dispatches to before its
 *  existing route matching.
 *
 *  This package is self-contained: matcher, header munging, HTTP fetch,
 *  and WS passthrough. Nothing domain-specific to Kolu's terminal state
 *  leaks in — the only inputs are an `isTls()` callback and a logger.
 *  Unit tests can exercise each piece in isolation. */

export { matchPreviewHost } from "./hostMatch.ts";
export { buildUpstreamHeaders, stripFramingHeaders } from "./headers.ts";
export { previewHttpProxy } from "./httpProxy.ts";
export type { PreviewProxyOptions, PreviewLogger } from "./httpProxy.ts";
export { createPreviewWsProxy } from "./wsProxy.ts";
export type { PreviewWsProxy, PreviewWsLogger } from "./wsProxy.ts";
