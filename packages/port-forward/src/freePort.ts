/**
 * Picking the local port a forward will answer on.
 *
 * The kernel picks it: bind to port 0 on all interfaces, read what we got,
 * release it. Binding `0.0.0.0` (not loopback) is deliberate — the port must be
 * free on the interface the forward will actually listen on.
 *
 * There is an unavoidable window between releasing the port and ssh binding it,
 * so the pick is a *hint*, not a reservation. That is fine because the bind
 * that follows fails loudly if it lost the race (ssh reports the bind error and
 * `create` rejects with it) — the one thing this must never do is quietly hand
 * back a port somebody else now owns. The TCP relay skips this entirely: it
 * binds port 0 itself and reads the port off its own listener, so it has no
 * window at all.
 */

import { createServer } from "node:net";

/** A free TCP port on all interfaces, as the kernel hands it out. */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "0.0.0.0", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(
          new Error(
            `port-forward: the kernel gave no TCP address for the probe listener (got ${JSON.stringify(address)}).`,
          ),
        );
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err !== undefined) reject(err);
        else resolve(port);
      });
    });
  });
}
