/** oh-my-pi's AgentAdapter — wires core + breadcrumb into the shared
 *  `AgentAdapter<Session, Info>` contract from anyagent.
 *
 *  Detection is **tty-anchored**, and there is exactly one candidate: the
 *  foreground process names `omp`, its stdin tty names the breadcrumb file, and
 *  that breadcrumb names THE session this terminal is writing to. No directory
 *  scan, no ownership arbiter (juspay/kolu#2057) — omp records the terminal
 *  itself, which is the thing pi, Codex and OpenCode have to guess at from a
 *  working directory. Two omp terminals in one repository therefore each show
 *  their own session with nothing above the adapter arbitrating.
 *
 *  WHICH agent directory: omp's state moves per invocation (`PI_CODING_AGENT_DIR`,
 *  `--profile` / `OMP_PROFILE` / `PI_PROFILE`, `PI_CONFIG_DIR`, the XDG state
 *  dir — omp 18.1.21's chain, see `agent-dir.ts`), and those overrides live in
 *  the omp process's own argv/env. So the adapter reads the terminal's
 *  FOREGROUND process each reconcile and folds it. Unlike pi there is NO
 *  fallback to kolu's default directory: a breadcrumb is the only anchor, so an
 *  unresolvable directory answers `null` ("keep what was published") rather than
 *  pointing at a tree this terminal does not write to.
 *
 *  `externalChanges` IS implemented — omp writes its breadcrumb when a session
 *  is created or switched, which can be AFTER the preexec hint named `omp`
 *  (launching `omp` in a tty that still carries an earlier session's crumb, and
 *  the `omp -c` resume path, both rewrite it), so a filesystem wake is the only
 *  signal that the terminal's session changed without a title event. One flat
 *  watcher per breadcrumb directory ever resolved.
 *
 *  `isPresent` gates install on the binary being foregrounded or the default
 *  breadcrumb directory already existing — a fresh machine that never ran omp
 *  pays no watcher cost (issue #698). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AgentAdapter,
  type AgentTerminalState,
  matchesAgent,
} from "anyagent";
import { readProcessSnapshot } from "kolu-io";
import type { Logger } from "kolu-shared";
import { type AgentDirResolution, resolveAgentDir } from "./agent-dir.ts";
import { type OmpSession, readBreadcrumb, ttyIdForPid } from "./breadcrumb.ts";
import { AGENT_DIR_OVERRIDE, BREADCRUMB_DIR } from "./config.ts";
import { subscribeBreadcrumbDir } from "./core.ts";
import type { OmpInfo } from "./schemas.ts";
import {
  isOmpScreenPollable,
  promoteOmpFromScreen,
  TAIL_REGION_LINES,
} from "./screen-scrape.ts";
import { createOmpWatcher } from "./session-watcher.ts";

/**
 * Every breadcrumb directory kolu has resolved, plus the ones it watches. Both
 * are process-wide and growing: the `externalChanges` install contract is
 * at-most-once (no uninstall). The KNOWN set is recorded even before install;
 * the WATCHED set subscribes each known directory once the install fan-out
 * exists. Keyed by directory.
 */
const knownBreadcrumbDirs = new Set<string>();
const watchedBreadcrumbDirs = new Map<string, () => void>();
let fanOut: (() => void) | null = null;
let watchOnError: ((err: unknown) => void) | null = null;
let watchLog: Logger | null = null;

/**
 * Session id → absolute transcript path, recorded by every `resolveSessions`
 * call. The breadcrumb is the ONE source of truth for where a session's file
 * lives, so the transcript exporter reads this map rather than re-deriving a
 * path from a cwd (which would be a second, lossier answer — omp's session
 * directory key is lossy, and the store can move per invocation). A session
 * this padi never observed live is simply absent, which the `Fetcher` contract
 * spells "transcript not available".
 */
const sessionFiles = new Map<string, string>();

/** The transcript path kolu observed for a session, or null when this padi
 *  never resolved it. Exported for the transcript fetcher. */
export function knownOmpSessionPath(sessionId: string): string | null {
  return sessionFiles.get(sessionId) ?? null;
}

function watchBreadcrumbDir(dir: string): void {
  if (watchedBreadcrumbDirs.has(dir)) return;
  watchedBreadcrumbDirs.set(
    dir,
    subscribeBreadcrumbDir(
      dir,
      fanOut!,
      (err) => watchOnError?.(err),
      watchLog ?? undefined,
    ),
  );
}

function noteBreadcrumbDir(dir: string): void {
  knownBreadcrumbDirs.add(dir);
  if (fanOut) watchBreadcrumbDir(dir);
}

/** Fold THIS terminal's omp invocation through omp's agent-directory chain.
 *  `null` means the directory could not be determined (an unreadable process, a
 *  profile name omp itself would refuse) — never a substituted default. */
function agentDirFor(
  state: AgentTerminalState,
  pid: number,
  log?: Logger,
): AgentDirResolution | null {
  const proc = readProcessSnapshot(pid, log);
  if (proc === null) return null;
  const resolved = resolveAgentDir({
    argv: proc.argv,
    env: proc.env,
    home: os.homedir(),
    agentDirOverride: AGENT_DIR_OVERRIDE,
    cwd: state.cwd,
    existsSync: fs.existsSync,
  });
  if (resolved !== null && resolved.source !== "default") {
    log?.info(
      {
        agentDir: resolved.agentDir,
        breadcrumbDir: resolved.breadcrumbDir,
        source: resolved.source,
        cwd: state.cwd,
      },
      "omp: agent dir redirected",
    );
  }
  return resolved;
}

export const ompAdapter: AgentAdapter<OmpSession, OmpInfo> = {
  kind: "omp",

  resolveSessions(state, log) {
    if (!matchesAgent(state, "omp")) return [];
    const pid = state.foregroundPid;
    if (pid === undefined) return null;
    const dir = agentDirFor(state, pid, log);
    if (dir === null) return null;
    noteBreadcrumbDir(dir.breadcrumbDir);
    const ttyId = ttyIdForPid(pid, log);
    if (ttyId === null) return null;
    const crumb = readBreadcrumb(path.join(dir.breadcrumbDir, ttyId), log);
    if (crumb.kind === "unusable") return null;
    if (crumb.kind === "absent") return [];
    sessionFiles.set(crumb.session.id, crumb.session.transcriptPath);
    return [crumb.session];
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createOmpWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "omp") || fs.existsSync(BREADCRUMB_DIR);
    },
    install(onChange, onError, log) {
      fanOut = onChange;
      watchOnError = onError;
      watchLog = log ?? null;
      // Drain every directory known so far (any resolved before install —
      // resolveSessions runs in the same reconcile pass AFTER install in the
      // sensors, but the ordering belt needs braces).
      noteBreadcrumbDir(BREADCRUMB_DIR);
      for (const dir of knownBreadcrumbDirs) watchBreadcrumbDir(dir);
    },
  },

  // The transcript can show the tool call (`tool_use`) but not the dialog the
  // user is looking at: omp's approval gate and its `ask` question render on
  // the terminal while the tail stays on the in-flight call. So when the host
  // can read the rendered screen (`readScreenText`), the orchestrator polls
  // while `isOmpScreenPollable` holds for `thinking` / `tool_use` and promotes
  // the active state → `awaiting_user`. `promote` only ever lifts (never
  // lowers); the orchestrator self-demotes when the dialog clears, because the
  // watcher's change gate drops the structurally-identical settle-back. Both
  // halves of the policy live in `screen-scrape.ts` next to the detector.
  screenScrape: {
    tailLines: TAIL_REGION_LINES,
    isPollable: isOmpScreenPollable,
    promote: promoteOmpFromScreen,
  },
};
