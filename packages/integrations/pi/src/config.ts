import os from "node:os";
import path from "node:path";

/** Pi's per-user session storage directory. Default `~/.pi/agent/sessions`.
 *
 *  `KOLU_PI_DIR` names the PARENT of the sessions tree: `SESSIONS_DIR` is
 *  always `<KOLU_PI_DIR>/sessions` when set (used by tests/e2e fixtures, and
 *  by users who run pi with a custom `PI_CODING_AGENT_SESSION_DIR` or
 *  `--session-dir` — pi's own override axes, see pi's
 *  docs/environment-variables.md; note pi's `PI_CODING_AGENT_DIR` moves pi's
 *  CONFIG directory only and does NOT move sessions). */
export const SESSIONS_DIR = process.env.KOLU_PI_DIR
  ? path.join(process.env.KOLU_PI_DIR, "sessions")
  : path.join(os.homedir(), ".pi", "agent", "sessions");
