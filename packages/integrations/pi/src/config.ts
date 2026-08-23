import os from "node:os";
import path from "node:path";

/** Pi's per-user session storage directory. Default `~/.pi/agent/sessions`,
 *  overridable wholesale via `KOLU_PI_DIR` — mostly for e2e tests that need
 *  hermetic isolation from real user history.
 *
 *  This mirrors pi's own override axes: pi moves its session storage with
 *  `PI_CODING_AGENT_SESSION_DIR` / `--session-dir` (see pi's
 *  docs/environment-variables.md). A user who runs pi that way must point
 *  kolu at the same sessions directory. Note `PI_CODING_AGENT_DIR` is pi's
 *  CONFIG directory (`~/.pi/agent`) and does NOT move sessions — sessions
 *  always default to `~/.pi/agent/sessions`. */
export const SESSIONS_DIR = process.env.KOLU_PI_DIR
  ? path.join(process.env.KOLU_PI_DIR, "sessions")
  : path.join(os.homedir(), ".pi", "agent", "sessions");

/** The directory a synthetic session file is symlinked into — the top of
 *  pi's per-user agent tree (transcripts never live here, so there are no
 *  user sessions to clobber). */
export const PI_DIR = path.dirname(SESSIONS_DIR);
