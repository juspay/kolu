import os from "node:os";
import path from "node:path";

/** Pi's per-user config ("agent") directory — the root of its state tree:
 *  sessions under `<dir>/sessions`, settings at `<dir>/settings.json`. This
 *  is the directory pi's own `PI_CODING_AGENT_DIR` env var overrides; its
 *  default is `~/.pi/agent` (pi 0.84.2's `getAgentDir()`).
 *
 *  `KOLU_PI_DIR` overrides it for kolu's DEFAULT scan only (tests/e2e
 *  fixtures, users who keep their whole pi config elsewhere). It is
 *  deliberately the sole kolu env knob and overrides nothing per-invocation:
 *  pi's own session-store overrides (`--session-dir`,
 *  `PI_CODING_AGENT_SESSION_DIR`, settings.json `sessionDir`, and
 *  `PI_CODING_AGENT_DIR` in the pi process's env) belong to the pi process
 *  in the terminal, not to padi, and are resolved per terminal there — see
 *  `session-root.ts`. Reading them from the DAEMON's env here would be a
 *  silent lie on any host that doesn't run padi inside the pi deployment
 *  env, so config never consults `PI_*`. */
export const AGENT_DIR = process.env.KOLU_PI_DIR
  ? process.env.KOLU_PI_DIR
  : path.join(os.homedir(), ".pi", "agent");

/** kolu's default session-store root: `<agent dir>/sessions`, matching pi's
 *  own default (`getAgentDir() + "/sessions"`). Per-terminal overrides are
 *  followed in `session-root.ts`; this is the fallback every other answer
 *  bottoms out in. */
export const SESSIONS_DIR = path.join(AGENT_DIR, "sessions");
