/**
 * The mechanism for a `local` target: a plain TCP relay.
 *
 * A dev server bound to `127.0.0.1:5173` on this machine is invisible from
 * anywhere else — loopback never leaves the box. So we open a door on the
 * network side (`0.0.0.0:<port>`) and copy bytes between it and the loopback
 * listener. No ssh, no tunnel: same machine, two sockets.
 *
 * Every accepted connection is tracked so `close()` can DESTROY it. Closing a
 * `net.Server` only stops new connections — a browser holding a keep-alive
 * socket would keep talking to the dev server long after the row said the
 * forward was cancelled, and "cancel severs it" has to mean severed.
 */

import { connect, createServer, type Socket } from "node:net";
import type { OpenedForward } from "./mechanism.ts";

/** The address a `local` target listens on — loopback, by definition of the
 *  problem this solves. */
const LOOPBACK = "127.0.0.1";

/** Relay `0.0.0.0:<local>` → `127.0.0.1:<port>`. Resolves once the door is
 *  open; rejects (never half-opens) if the bind fails. `onLost` fires if the
 *  listener dies on its own afterwards.
 *
 *  The kernel picks the local port, and unlike the ssh mechanism there is no
 *  "prefer the target's own number" here — that number is the ONE number this
 *  listener may never take. Both ends are on this machine, so binding
 *  `0.0.0.0:<port>` while relaying to `127.0.0.1:<port>` points the relay at
 *  ITSELF: every accepted connection dials back into the listener and accepts
 *  again, forever. Measured before this was closed: one connection opened
 *  ~29,000 file descriptors in 1.5 seconds. */
export function openRelay(
  port: number,
  onLost: (reason: string) => void,
): Promise<OpenedForward> {
  const live = new Set<Socket>();

  const server = createServer((inbound) => {
    const outbound = connect({ host: LOOPBACK, port });
    live.add(inbound);
    live.add(outbound);
    // Either half ending or failing takes the pair down: a relay owns no
    // state of its own, so there is nothing to salvage from a half-open pipe.
    const drop = (): void => {
      live.delete(inbound);
      live.delete(outbound);
      inbound.destroy();
      outbound.destroy();
    };
    inbound.on("error", drop);
    outbound.on("error", drop);
    inbound.on("close", drop);
    outbound.on("close", drop);
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  });

  return new Promise((resolve, reject) => {
    const onListenError = (err: Error): void => reject(err);
    server.once("error", onListenError);
    // Port 0 asks the kernel to choose, with no pick-then-bind window at all.
    server.listen({ host: "0.0.0.0", port: 0 }, () => {
      server.removeListener("error", onListenError);
      // Past the bind, a listener error is a LOSS, not a startup failure —
      // report it and take the forward down rather than leaving a dead row.
      server.on("error", (err) => {
        onLost(`the local relay listener failed: ${err.message}`);
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(
          new Error(
            `port-forward: the relay listener has no TCP address (got ${JSON.stringify(address)}).`,
          ),
        );
        return;
      }
      resolve({
        localPort: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            for (const socket of live) socket.destroy();
            live.clear();
            server.close((err) => {
              if (err !== undefined) fail(err);
              else done();
            });
          }),
      });
    });
  });
}
