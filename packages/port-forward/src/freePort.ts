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
const PORT_UNAVAILABLE_CODES = new Set(["EADDRINUSE", "EACCES"]);

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
