/**
 * Where the daemon's single-instance gate + unix socket live.
 *
 * Both the daemon (`daemon/main.ts`) and the supervisor (`supervisor/main.ts`)
 * derive the SAME two paths from the same rule, so the supervisor reads the
 * exact gate the daemon claims and dials the exact socket it serves.
 *
 * `daemonHome` is that rule: one call creates a private 0700 home under the
 * runtime dir and keeps gate beside socket. A harness may override with
 * `FLEET_TOP_GATE` + `FLEET_TOP_SOCKET`, but both must be set and must share a
 * directory — independent overrides would undo the co-location invariant.
 * `HOME_DIR` is always that shared directory (the daemon's self-reap anchor).
 */

import { dirname } from "node:path";
import { daemonHome } from "@kolu/surface-daemon";

function fleetTopPaths(): {
  homeDir: string;
  gatePath: string;
  socketPath: string;
} {
  const gate = process.env.FLEET_TOP_GATE;
  const sock = process.env.FLEET_TOP_SOCKET;
  if (gate !== undefined || sock !== undefined) {
    if (gate === undefined || sock === undefined) {
      throw new Error(
        "FLEET_TOP_GATE and FLEET_TOP_SOCKET must both be set (or neither) — " +
          "gate and socket stay side by side",
      );
    }
    if (dirname(gate) !== dirname(sock)) {
      throw new Error(
        `FLEET_TOP_GATE (${gate}) and FLEET_TOP_SOCKET (${sock}) must share a directory`,
      );
    }
    return {
      homeDir: dirname(gate),
      gatePath: gate,
      socketPath: sock,
    };
  }
  // Only materialise the home when no harness override is in play — so a
  // fixed-path test doesn't also mkdir the default runtime dir.
  const home = daemonHome({ app: "fleet-top", placement: "runtime" });
  return {
    homeDir: home.dir,
    gatePath: home.gatePath,
    socketPath: home.socketPath,
  };
}

const paths = fleetTopPaths();
export const HOME_DIR = paths.homeDir;
export const GATE_PATH = paths.gatePath;
export const SOCKET_PATH = paths.socketPath;
