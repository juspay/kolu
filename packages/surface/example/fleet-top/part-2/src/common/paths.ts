/**
 * Where the daemon's single-instance gate + unix socket live.
 *
 * Both the daemon (`daemon/main.ts`) and the supervisor (`supervisor/main.ts`)
 * build the SAME {@link DaemonHomePaths} from the same rule, so they cannot
 * disagree about the gate or the socket. Overrides
 * (`FLEET_TOP_GATE` + `FLEET_TOP_SOCKET`) are absorbed into home construction
 * via `socketOverride` — never as loose path strings past the spine.
 */

import { dirname } from "node:path";
import {
  type DaemonHomePaths,
  daemonHome,
  resolveDaemonHome,
} from "@kolu/surface-daemon";

function fleetTopHome(): DaemonHomePaths {
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
    // Override absorbed into home construction (gate stem from app).
    return resolveDaemonHome({
      app: "fleet-top",
      placement: "runtime",
      socketOverride: sock,
    });
  }
  // Materialise the private 0700 home when no harness override is in play.
  return daemonHome({ app: "fleet-top", placement: "runtime" });
}

/** The daemon/supervisor home — one object, both sides. */
export const HOME: DaemonHomePaths = fleetTopHome();
export const HOME_DIR = HOME.dir;
export const GATE_PATH = HOME.gatePath;
export const SOCKET_PATH = HOME.socketPath;
