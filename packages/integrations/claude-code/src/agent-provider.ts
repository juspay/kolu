/**
 * Claude Code's AgentProvider — wires the package's existing helpers
 * (`readSessionFile`, `subscribeSessionsDir`, `createSessionWatcher`) into
 * the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * The server's generic agent orchestrator consumes this and needs no
 * claude-code-specific knowledge.
 *
 * `externalChanges.isPresent` gates `install` on either (a) `claude`
 * being foregrounded in some terminal, or (b) `~/.claude/sessions/`
 * existing on disk already. Matching is not PID-based here —
 * `resolveSession` returns null until claude writes its session file,
 * which is exactly what the SESSIONS_DIR watcher fires on — so we need
 * a cheaper "might be running here" signal to authorize the watcher
 * install. `matchesAgent(state, "claude")` covers the OSC 633;E preexec
 * hint and the kernel foreground basename; the directory check covers
 * the PID-match path where a session file can appear with no preexec
 * signal because claude is invoked via a shim (npx, wrapper) or via
 * scenarios the kolu-instrumented shell never saw. Neither holds on a
 * fresh machine that has never run Claude — no watcher, no logs
 * (issue #698).
 */

import fs from "node:fs";
import { type AgentProvider, matchesAgent } from "anyagent";
import {
  readSessionFile,
  SESSIONS_DIR,
  type SessionFile,
  subscribeSessionsDir,
} from "./core.ts";
import type { ClaudeCodeInfo } from "./schemas.ts";
import {
  isScreenPollable,
  promoteFromScreen,
  TAIL_REGION_LINES,
} from "./screen.ts";
import { createSessionWatcher } from "./session-watcher.ts";

export const claudeCodeProvider: AgentProvider<SessionFile, ClaudeCodeInfo> = {
  kind: "claude-code",

  resolveSession(state, log) {
    if (state.foregroundPid === undefined) return null;
    return readSessionFile(state.foregroundPid, log);
  },

  sessionKey(session) {
    // Keyed by transcript identity AND process identity. A `claude -c` resume
    // reuses the same `sessionId` but writes a new session file with a fresh
    // `pid` and `startedAt`; the watcher captures `session.pid`/`startedAt`
    // once (for the #1017 subtree-idle probe and orphaned-prompt age check), so
    // keying on `sessionId` alone would early-return on resume and leave the
    // watcher probing the dead pid against a stale `startedAt`. Folding pid and
    // startedAt into the key forces the orchestrator to recreate the watcher
    // when either changes for the same transcript.
    return `${session.sessionId}:${session.pid}:${session.startedAt ?? ""}`;
  },

  createWatcher(session, onChange, log) {
    return createSessionWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "claude") || fs.existsSync(SESSIONS_DIR);
    },
    install(onChange, onError, log) {
      subscribeSessionsDir(onChange, onError, log);
    },
  },

  // The SDK buffers `AskUserQuestion` / `ExitPlanMode` in memory until the user
  // answers, so the JSONL classifier reports `waiting` throughout the prompt
  // (#905). The prompt is on the rendered screen, though — so when the host can
  // read it (`ProviderHooks.readScreenText`), the orchestrator polls while
  // `isScreenPollable` holds and lifts `waiting → awaiting_user`. `promote` only
  // ever lifts (never lowers); the orchestrator self-demotes when the prompt
  // clears, because the watcher's change gate drops the structurally-identical
  // `waiting` settle-back. Both halves of the policy live in `screen.ts` next to
  // the detector.
  screenScrape: {
    tailLines: TAIL_REGION_LINES,
    isPollable: isScreenPollable,
    promote: promoteFromScreen,
  },
};
