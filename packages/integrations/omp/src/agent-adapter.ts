import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AgentAdapter,
  type AgentTerminalState,
  matchesAgent,
} from "anyagent";
import type { Logger } from "kolu-shared";
import { type AgentDirResolution, resolveAgentDir } from "./agent-dir.ts";
import { type OmpSession, readBreadcrumb, ttyIdForPid } from "./breadcrumb.ts";
import { AGENT_DIR_OVERRIDE, BREADCRUMB_DIR } from "./config.ts";
import { subscribeBreadcrumbDir } from "./core.ts";
import { type OmpInfo, ompVocab } from "./schemas.ts";
import {
  isOmpScreenPollable,
  promoteOmpFromScreen,
  TAIL_REGION_LINES,
} from "./screen-scrape.ts";
import { createOmpWatcher } from "./session-watcher.ts";

const knownBreadcrumbDirs = new Set<string>();
const watchedBreadcrumbDirs = new Set<string>();
interface InstalledWatch {
  onChange: () => void;
  onError: (err: unknown) => void;
  log?: Logger;
}
let installed: InstalledWatch | null = null;

const sessionFiles = new Map<string, string>();

/** The transcript path kolu observed for a session, or null when this padi
 *  never resolved it. Exported for the transcript fetcher. */
export function knownOmpSessionPath(sessionId: string): string | null {
  return sessionFiles.get(sessionId) ?? null;
}

function watchBreadcrumbDir(dir: string, watch: InstalledWatch): void {
  if (watchedBreadcrumbDirs.has(dir)) return;
  watchedBreadcrumbDirs.add(dir);
  subscribeBreadcrumbDir(dir, watch.onChange, watch.onError, watch.log);
}

function noteBreadcrumbDir(dir: string): void {
  knownBreadcrumbDirs.add(dir);
  if (installed) watchBreadcrumbDir(dir, installed);
}

function agentDirFor(
  state: AgentTerminalState,
  log?: Logger,
): AgentDirResolution | "no-session" | null {
  // The host's ONE read for this reconcile tick, shared with every other
  // adapter (juspay/kolu#2286) — never a per-adapter `readProcessSnapshot`.
  const proc = state.readProcessSnapshot();
  if (proc === null) return null;
  if (proc.argv.includes("--no-session")) return "no-session";
  const resolved = resolveAgentDir({
    argv: proc.argv,
    env: proc.env ?? undefined,
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
    if (!matchesAgent(state, ompVocab.cli)) return [];
    const pid = state.foregroundPid;
    if (pid === undefined) return null;
    const dir = agentDirFor(state, log);
    if (dir === null) return null;
    if (dir === "no-session") return [];
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
  presenceSessionId(session) {
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
      return matchesAgent(state, ompVocab.cli) || fs.existsSync(BREADCRUMB_DIR);
    },
    install(onChange, onError, log) {
      installed = { onChange, onError, log: log ?? undefined };
      noteBreadcrumbDir(BREADCRUMB_DIR);
      for (const dir of knownBreadcrumbDirs) {
        watchBreadcrumbDir(dir, installed);
      }
    },
  },
  screenScrape: {
    tailLines: TAIL_REGION_LINES,
    isPollable: isOmpScreenPollable,
    promote: promoteOmpFromScreen,
  },
};
