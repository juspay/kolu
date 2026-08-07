/**
 * Loopback transport primitive — two cross-piped `PassThrough` streams that
 * exercise the same framing as a real subprocess pair, but in-process.
 *
 * Note this is **not** a link: it produces no dispatch. It's the transport you
 * feed *into* a link — `pair.client` to `stdioLink`, `pair.server` to
 * `serveOverStdio` — so the family stays honest (a link returns a dispatch; a
 * loopback pair returns two stream ends). Enables two patterns:
 *
 *   1. **Symmetric "local backend wrapped in the same client shape as a
 *      remote backend"** — the in-memory dual of the stdio leg. A local
 *      backend can expose its surface over a loopback so consumers see one
 *      dispatch shape regardless of "is this the local or a remote host?"
 *
 *   2. **Unit tests** — round-trip a served surface through `serveOverStdio` to
 *      `stdioLink` without forking a subprocess. The ndjson framing is the same
 *      as the real ssh path (and the same the socket legs carry — see
 *      `links/byteSplice.test.ts`), so a green loopback test is genuine
 *      evidence the stdio link works end-to-end — just without the operational
 *      concerns (process spawn, signal handling, exit codes).
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
import {
  awaitStdioReadiness,
  type StdioReadinessProof,
  writeStdioReadiness,
} from "./links/readiness";

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

/**
 * Greet from the SERVER half and read the greeting on the CLIENT half — the
 * in-process dual of a `--stdio` agent's boot banner, and the way a loopback
 * composition obtains the `StdioReadinessProof` {@link
 * import("./links/stdio").stdioLink} requires (juspay/kolu#2101).
 *
 * This is not a shortcut around the gate: it performs the real protocol — a
 * banner is written on the wire and read back off it — which is precisely what
 * makes a loopback round-trip honest evidence about the ssh leg. `serveOverStdio`
 * writes that banner itself when the PROCESS is the agent (it owns stdout then);
 * over an explicit loopback transport the caller plays the server, so the caller
 * greets, exactly as a daemon front does after it converges.
 *
 * Call it BEFORE the client issues its first call. It cannot race the served
 * surface's own frames: a server writes nothing until it is asked something.
 */
export function greetLoopback(
  pair: LoopbackPair,
): Promise<StdioReadinessProof> {
  const proof = awaitStdioReadiness({
    read: pair.client.read,
    deadlineMs: 10_000,
    describe: "loopback",
  });
  writeStdioReadiness(pair.server.write, { verdict: "ready" });
  return proof;
}
