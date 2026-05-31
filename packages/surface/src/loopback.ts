/**
 * Loopback transport primitive — two cross-piped `PassThrough` streams that
 * exercise the same framing as a real subprocess pair, but in-process.
 *
 * Note this is **not** a link: it produces no client. It's the transport you
 * feed *into* a link — `pair.client` to `stdioLink`, `pair.server` to
 * `serveOverStdio` — so the family stays honest (a link returns a client; a
 * loopback pair returns two stream ends). Enables two patterns:
 *
 *   1. **Symmetric "local backend wrapped in the same client shape as a
 *      remote backend"** — the in-memory dual of `StdioRPCLink`. R-2's
 *      `LocalTerminalBackend` could choose to expose its surface via a
 *      loopback so consumers see one client shape regardless of "is this
 *      the local or a remote host?"
 *
 *   2. **Unit tests** — round-trip a router through `serveOverStdio` to
 *      `stdioLink` without forking a subprocess. The framing
 *      and peer codec are the same as the real ssh path, so a green
 *      loopback test is genuine evidence the stdio link works end-to-end
 *      — just without the operational concerns (process spawn, signal
 *      handling, exit codes).
 *
 * Cross-piping convention: `client.read <- server.write` and
 * `client.write -> server.read`. The link sees the client's perspective:
 * pass `pair.client.read` and `pair.client.write` to `stdioLink`, pass
 * `pair.server.read` and `pair.server.write` to `serveOverStdio`. The
 * naming mirrors the subprocess case where the child's stdin is the
 * parent's `child.stdin` (write) and the child's stdout is the parent's
 * `child.stdout` (read).
 */

import { PassThrough } from "node:stream";

/** Result of `createLoopbackPair()` — two stdio "ends" that talk to each
 *  other. */
export interface LoopbackPair {
  client: { read: PassThrough; write: PassThrough };
  server: { read: PassThrough; write: PassThrough };
}

/** Build a cross-piped `PassThrough` pair. Client writes flow into the
 *  server's read stream; server writes flow into the client's read
 *  stream. */
export function createLoopbackPair(): LoopbackPair {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  return {
    client: { read: serverToClient, write: clientToServer },
    server: { read: clientToServer, write: serverToClient },
  };
}
