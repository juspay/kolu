/** Configuration constants for the Pi integration.
 *  Leaf module — no imports from other package files. */

import os from "node:os";
import path from "node:path";

/** Root of pi's per-user agent directory (`PI_CODING_AGENT_DIR` in pi's own
 *  vocabulary). Contains `sessions/`, auth, settings, and installed
 *  packages. Overridable via `KOLU_PI_DIR` so e2e fixtures and unit tests
 *  never scan the developer's real `~/.pi/agent`.
 *
 *  A user who points pi at a custom `PI_CODING_AGENT_DIR` from their shell
 *  rc can point kolu the same way; kolu cannot read the terminal's env, so
 *  the default is the one pi documents (`~/.pi/agent`). */
export const PI_DIR =
  process.env.KOLU_PI_DIR ?? path.join(os.homedir(), ".pi", "agent");

/** Per-cwd session roots live under this directory:
 *  `<SESSIONS_DIR>/--<cwd with "/"→"-">--/<timestamp>_<uuid>.jsonl`. */
export const SESSIONS_DIR = path.join(PI_DIR, "sessions");
