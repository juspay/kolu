/**
 * The in-band introspection rendezvous: while `odu run` is live, the
 * coordinator serves the fan-in surface on `.ci/odu.sock`, and
 * `odu status` / `logs` / `monitor` dial it.
 *
 * Transport is `@kolu/surface`'s first-class unix-socket pair
 * (`serveOverUnixSocket` / `unixSocketLink`) — same base64-newline framing
 * as every other odu transport, and unlike justci's `.ci/pc.sock`, what is
 * served is the same typed surface every other face speaks. odu keeps the
 * checkout-scoped path (one run per checkout, like justci) rather than the
 * library's per-user runtime-dir convention, and translates the library's
 * structured outcomes into odu-flavored verdicts: `already-served` IS the
 * one-run-per-checkout lock, and a dial failure IS "no run in progress".
 */

import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import type { ContractRouterClient } from "@orpc/contract";
import type { oduSurface } from "../common/surface";

export const SOCKET_PATH = ".ci/odu.sock";

export type OduClient = ContractRouterClient<typeof oduSurface.contract>;

/** Serve `router` on the unix socket; refuses when another run is live in
 *  this checkout (one run per checkout — justci's `.ci/pc.sock` rule). The
 *  library reclaims a provably-stale socket left by a crashed coordinator
 *  and refuses to serve from a world-readable directory, so `.ci` is
 *  tightened to owner-only first (it holds nothing but this run's logs). */
export async function serveSocket(
  // biome-ignore lint/suspicious/noExplicitAny: same router-shape constraint as serveOverUnixSocket's own options (the implementSurface spread defeats oRPC's Router type).
  router: any,
  path: string = SOCKET_PATH,
): Promise<() => void> {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync's mode is a no-op on a pre-existing dir (a prior run already
  // created `.ci` under the umask), and the library refuses non-private dirs.
  chmodSync(dir, 0o700);

  const listener = await serveOverUnixSocket({ socketPath: path, router });
  const { outcome } = listener;
  switch (outcome.kind) {
    case "listening":
      return () => listener.close();
    case "already-served":
      throw new Error(
        `odu: a run is already in progress in this checkout (${path} is live)`,
      );
    case "dir-not-private":
      throw new Error(
        `odu: refusing to serve ${path} — ${outcome.dir} is not an owner-only directory`,
      );
    case "not-a-socket":
      throw new Error(
        `odu: ${path} exists but is not a socket — remove it manually`,
      );
    case "probe-failed":
      throw new Error(
        `odu: could not probe ${path} (${outcome.code ?? "unknown error"})`,
      );
    case "bind-failed":
      throw new Error(`odu: could not bind ${path}: ${String(outcome.err)}`);
  }
}

/** Dial the socket of a live run. Exits with the justci-parity message when
 *  no run is in progress (a dead/absent server rejects with
 *  ECONNREFUSED/ENOENT). */
export async function dialSocket(
  path: string = SOCKET_PATH,
): Promise<{ client: OduClient; close: () => void }> {
  try {
    const { client, dispose } = await unixSocketLink<
      typeof oduSurface.contract
    >({ socketPath: path });
    return { client, close: dispose };
  } catch {
    process.stderr.write(
      `odu: no run in progress in this checkout (no live socket at ${path})\n`,
    );
    process.exit(1);
  }
}
