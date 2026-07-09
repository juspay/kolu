/**
 * Where the daemon's single-instance gate + unix socket live.
 *
 * Both the daemon (`daemon/main.ts`) and the supervisor (`supervisor/main.ts`)
 * derive the SAME two paths from the same rule, so the supervisor reads the
 * exact gate the daemon claims and dials the exact socket it serves. A per-user
 * runtime dir keeps them private (the socket-privacy check refuses a
 * world-accessible dir).
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = process.env.XDG_RUNTIME_DIR ?? tmpdir();

export const GATE_PATH =
  process.env.FLEET_TOP_GATE ?? join(runtimeDir, "fleet-top.pid");
export const SOCKET_PATH =
  process.env.FLEET_TOP_SOCKET ?? join(runtimeDir, "fleet-top.sock");
