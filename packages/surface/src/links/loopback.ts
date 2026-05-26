/**
 * In-process loopback transport for `@kolu/surface`.
 *
 * Pairs a client and a server living in the same Node.js process by
 * routing their messages through two crossed `PassThrough` streams.
 * The on-the-wire protocol is identical to the stdio link
 * (`./stdio.ts`) — same base64+newline framing — so the loopback link
 * exercises the same code path that real subprocess and SSH-tunneled
 * servers exercise.
 *
 * Use cases:
 *
 * 1. **Symmetric "local" backends in apps that have a Surface-over-stdio
 *    "remote" backend.** Lets the local consumer construct a typed
 *    client the same way it constructs a remote client (same
 *    `createStdioCellsClient` shape), just with the loopback pair
 *    instead of a subprocess's stdin/stdout. The downstream code that
 *    holds the client doesn't branch on local-vs-remote.
 *
 * 2. **Testing.** Unit tests can wire a real surface server to a real
 *    surface client in one process, exercising the snapshot+delta
 *    framing without spawning subprocesses or opening sockets.
 *
 * Cost: one extra base64 round-trip per message. Negligible for the
 * call patterns Surface streams (snapshot+delta), and the simplicity of
 * "identical transport, different transport instance" is worth the
 * microbenchmark. If a future profile finds it matters, a direct
 * router-call adapter (skipping framing) is a drop-in replacement that
 * preserves the same client shape.
 */

import { PassThrough } from "node:stream";
import type { StdioLinkOptions } from "./stdio";

export interface LoopbackPair {
  /** Pass to `createStdioCellsClient` — the consumer side. */
  readonly client: StdioLinkOptions;
  /** Pass to `serveOverStdio` — the producer side. */
  readonly server: StdioLinkOptions;
}

/** Create a paired client/server stdio configuration that loops back
 *  in-process. The client and server use crossed bindings: the client
 *  reads what the server writes, and writes what the server reads.
 *
 *  ```ts
 *  const pair = createLoopbackPair();
 *  const client = createStdioCellsClient<typeof contract>(pair.client);
 *  void serveOverStdio({ router, ...pair.server });
 *  ```
 *
 *  The pair owns its streams. Disposing the client / closing the
 *  server ends the loopback; the streams cannot be reused. */
export function createLoopbackPair(): LoopbackPair {
  // c2s: bytes from client → server.
  // s2c: bytes from server → client.
  const c2s = new PassThrough();
  const s2c = new PassThrough();
  return {
    // Client reads s2c (what server wrote) and writes to c2s (what
    // server will read).
    client: { read: s2c, write: c2s },
    // Server reads c2s (what client wrote) and writes to s2c (what
    // client will read).
    server: { read: c2s, write: s2c },
  };
}
