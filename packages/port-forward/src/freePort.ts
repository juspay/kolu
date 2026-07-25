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

/** Is this port number free of local listeners — can we bind it ourselves?
 *
 *  Asked before PREFERRING the target's own number, because "free" here has to
 *  mean "nothing local answers on it", not merely "ssh can bind it". ssh sets
 *  `SO_REUSEADDR`, so it will happily listen on `0.0.0.0:5173` BESIDE an
 *  unrelated `127.0.0.1:5173` — and then the same port number means two
 *  different servers depending on which address you connect to, which is worse
 *  than an unpredictable port. A plain bind (no `SO_REUSEADDR` overlap) is
 *  exactly the "nobody else is here" question.
 *
 *  The bind is released immediately, so this is a hint, not a reservation; a
 *  lost race surfaces as ssh failing to bind, which is a loud error rather than
 *  a wrong answer. */
export function canBindLocally(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      // Only "this port is not available to us" is an ANSWER. Anything else —
      // EMFILE, ENFILE, a broken network stack — is a real failure of this
      // process, and relabelling it "something is listening there" would send
      // the caller to a fallback port that is about to fail the same way.
      if (PORT_UNAVAILABLE_CODES.has(err.code ?? "")) resolve(false);
      else reject(err);
    });
    server.listen({ host: "0.0.0.0", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** The bind errors that mean THIS PORT, as opposed to this machine.
 *
 *  `EADDRNOTAVAIL` is deliberately NOT here: for a fixed `0.0.0.0` bind it says
 *  the ADDRESS is unavailable, which another port number cannot repair — so it
 *  travels as the failure it is instead of sending the caller to a fallback
 *  that will fail identically. */
const PORT_UNAVAILABLE_CODES = new Set([
  "EADDRINUSE",
  "EACCES", // a privileged port, from an unprivileged process
]);

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
