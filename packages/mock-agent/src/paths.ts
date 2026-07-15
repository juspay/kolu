/**
 * The REAL default on-disk locations each agent integration reads when NO
 * `KOLU_*_DIR` override is set — i.e. what a genuine `claude` / `codex` /
 * `opencode` / `grok` install writes to under the user's `$HOME`.
 *
 * The mock-agent runs INSIDE a kolu terminal, so its `$HOME` is whatever the
 * PTY host (padi) resolved for that box — the sandboxed fixture home locally,
 * the ssh user's home on a remote bind target. It writes here; the padi on the
 * SAME box reads here (its own `os.homedir()` fallback in
 * `kolu-claude-code/core.ts` · `kolu-codex/config.ts` · `kolu-opencode/config.ts`
 * · `kolu-grok/config.ts`). Because both endpoints derive the path from the one
 * `$HOME` of the machine the terminal lives on, local and remote are the same
 * code with no geography branch — the whole point of moving the mock into the
 * agent's seat.
 *
 * These tails are duplicated (not imported) from the integration `config`
 * modules on purpose: those constants read `process.env` at import time and
 * would resolve to the OVERRIDE, not the fallback, so importing them would give
 * the wrong path in the very harness that sets overrides. The unit test
 * `paths.test.ts` pins each tail against its integration's documented default so
 * a drift fails loudly.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** `$HOME` the same way the integrations' `os.homedir()` fallback resolves it. */
export function home(): string {
  return process.env.HOME || homedir() || "/";
}

/** claude-code: `SESSIONS_DIR` fallback = `~/.claude/sessions`. */
export function claudeSessionsDir(): string {
  return join(home(), ".claude", "sessions");
}

/** claude-code: `PROJECTS_DIR` fallback = `~/.claude/projects`. */
export function claudeProjectsDir(): string {
  return join(home(), ".claude", "projects");
}

/** codex: `CODEX_DIR` fallback = `~/.codex` (its `state_5.sqlite` +
 *  rollout JSONL live here). */
export function codexDir(): string {
  return join(home(), ".codex");
}

/** opencode: `OPENCODE_DB_PATH` fallback = `~/.local/share/opencode/opencode.db`. */
export function opencodeDbPath(): string {
  return join(home(), ".local", "share", "opencode", "opencode.db");
}

/** grok: `GROK_DIR` fallback = `~/.grok` (active_sessions.json +
 *  sessions/<urlencode(cwd)>/<uuid>/). */
export function grokDir(): string {
  return join(home(), ".grok");
}
