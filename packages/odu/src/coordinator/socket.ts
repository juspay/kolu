/**
 * The in-band introspection rendezvous: while `odu run` is live, the
 * coordinator serves the fan-in surface on `.ci/odu.sock`, and
 * `odu status` / `logs` / `monitor` dial it. Same base64-newline framing as
 * every other odu transport — `serveOverStdio` and `stdioLink` are
 * stream-pair generic, so a unix socket needs zero changes in
 * `@kolu/surface` (and unlike justci's `.ci/pc.sock`, what is served is the
 * same typed surface every other face speaks, not a separate baked client
 * protocol).
 */

import { existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { stdioLink } from "@kolu/surface/links/stdio";
import { serveOverStdio } from "@kolu/surface/peer-server";
import type { ContractRouterClient } from "@orpc/contract";
import type { oduSurface } from "../common/surface";

export const SOCKET_PATH = ".ci/odu.sock";

export type OduClient = ContractRouterClient<typeof oduSurface.contract>;

function probe(path: string): Promise<"live" | "stale" | "absent"> {
  return new Promise((resolve) => {
    if (!existsSync(path)) {
      resolve("absent");
      return;
    }
    const sock = createConnection(path);
    sock.once("connect", () => {
      sock.destroy();
      resolve("live");
    });
    sock.once("error", () => resolve("stale"));
  });
}

/** Serve `router` on the unix socket; refuses when another run is live in
 *  this checkout (one run per checkout — justci's `.ci/pc.sock` rule),
 *  reclaims a stale socket left by a crashed coordinator. */
export async function serveSocket(
  // biome-ignore lint/suspicious/noExplicitAny: same router-shape constraint as serveOverStdio's own options (the implementSurface spread defeats oRPC's Router type).
  router: any,
  path: string = SOCKET_PATH,
): Promise<() => void> {
  const state = await probe(path);
  if (state === "live") {
    throw new Error(
      `odu: a run is already in progress in this checkout (${path} is live)`,
    );
  }
  if (state === "stale") unlinkSync(path);

  const server = createServer((conn: Socket) => {
    void serveOverStdio({
      router,
      transport: { read: conn, write: conn },
    }).catch(() => {
      // a client hanging up mid-frame is unremarkable
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return () => {
    server.close();
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  };
}

/** Dial the socket of a live run. Exits with the justci-parity message when
 *  no run is in progress. */
export async function dialSocket(
  path: string = SOCKET_PATH,
): Promise<{ client: OduClient; close: () => void }> {
  const state = await probe(path);
  if (state !== "live") {
    process.stderr.write(
      `odu: no run in progress in this checkout (no live socket at ${path})\n`,
    );
    process.exit(1);
  }
  const sock = createConnection(path);
  await new Promise<void>((resolve, reject) => {
    sock.once("connect", resolve);
    sock.once("error", reject);
  });
  const client = stdioLink<typeof oduSurface.contract>({
    read: sock,
    write: sock,
  });
  return { client, close: () => sock.destroy() };
}
