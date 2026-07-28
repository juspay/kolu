/**
 * Where the daemon's single-instance gate + unix socket live.
 *
 * Both the daemon (`daemon/main.ts`) and the supervisor (`supervisor/main.ts`)
 * derive the SAME two paths from the same rule, so the supervisor reads the
 * exact gate the daemon claims and dials the exact socket it serves.
 *
 * `daemonHome` is that rule: one call creates a private 0700 home under the
 * runtime dir, keeps gate beside socket, and hands back the paths. A per-user
 * runtime dir keeps them private (the socket-privacy check refuses a
 * world-accessible dir). Override via `FLEET_TOP_GATE` / `FLEET_TOP_SOCKET`
 * for a harness that wants fixed paths.
 */

import { daemonHome } from "@kolu/surface-daemon";

const home = daemonHome({ app: "fleet-top", placement: "runtime" });

export const GATE_PATH = process.env.FLEET_TOP_GATE ?? home.gatePath;
export const SOCKET_PATH = process.env.FLEET_TOP_SOCKET ?? home.socketPath;
