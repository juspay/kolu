/**
 * Dial the kolu-server pty-host over its unix socket and hand back a
 * contract-typed client. A `net.Socket` is a Duplex, so it IS the
 * `{ read, write }` transport `stdioLink` wants — the same base64+newline
 * framing the in-server `serveOverStdio` listener speaks (and the same link
 * the ssh/daemon path will reuse, swapping only the socket for a child's
 * stdio).
 */
import { createConnection, type Socket } from "node:net";
import type { ptyHostSurface } from "@kolu/pty-host";
import { stdioLink } from "@kolu/surface/links/stdio";

export type PtyTuiClient = ReturnType<
  typeof stdioLink<typeof ptyHostSurface.contract>
>;

export interface Connection {
  client: PtyTuiClient;
  /** Close the socket — the link dies with it. */
  dispose(): void;
}

/** Connect to the pty-host at `socketPath`. Rejects with the raw socket error
 *  (`ECONNREFUSED` for a dead/absent server, `ENOENT` for a missing path) so
 *  the caller can print an honest, actionable message. */
export function connectPtyHost(socketPath: string): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection(socketPath);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      const client = stdioLink<typeof ptyHostSurface.contract>({
        read: socket,
        write: socket,
      });
      resolve({ client, dispose: () => socket.destroy() });
    });
    socket.once("error", reject);
  });
}
