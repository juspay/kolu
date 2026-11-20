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

interface InstalledWatch {
  onChange: () => void;
  onError: (err: unknown) => void;
  log: Logger | undefined;
}

interface BreadcrumbWatchHub {
  note(dir: string): void;
  /** `externalChanges.install`, which runs at most once per process and never
   *  tears down: every directory noted before it is drained here. */
  install(
    onChange: () => void,
    onError: (err: unknown) => void,
    log: Logger | undefined,
  ): void;
}

function createBreadcrumbWatchHub(): BreadcrumbWatchHub {
  const known = new Set<string>();
  const watched = new Set<string>();
  let installed: InstalledWatch | null = null;

  function arm(dir: string): void {
    if (installed === null || watched.has(dir)) return;
    watched.add(dir);
    subscribeBreadcrumbDir(
      dir,
      installed.onChange,
      installed.onError,
      installed.log,
    );
  }

  return {
    note(dir) {
      known.add(dir);
      arm(dir);
    },
    install(onChange, onError, log) {
      installed = { onChange, onError, log };
      known.add(BREADCRUMB_DIR);
      for (const dir of known) arm(dir);
    },
  };
}

const breadcrumbWatch = createBreadcrumbWatchHub();

const sessionFiles = new Map<string, string>();

/** The transcript path kolu observed for a session, or null when this padi
 *  never resolved it. Exported for the transcript fetcher. */
export function knownOmpSessionPath(sessionId: string): string | null {
  return sessionFiles.get(sessionId) ?? null;
}

type AgentDirAnswer =
  | { kind: "resolved"; dir: AgentDirResolution }
  | { kind: "no-session" }
  | { kind: "unknown" };

function agentDirFor(state: AgentTerminalState, log?: Logger): AgentDirAnswer {
  const proc = state.readProcessSnapshot();
  if (proc === null) return { kind: "unknown" };
  if (proc.argv.includes("--no-session")) return { kind: "no-session" };
  const resolved = resolveAgentDir({
    argv: proc.argv,
    env: proc.env ?? undefined,
    home: os.homedir(),
    agentDirOverride: AGENT_DIR_OVERRIDE,
    cwd: state.cwd,
    existsSync: fs.existsSync,
  });
  if (resolved === null) return { kind: "unknown" };
  if (resolved.source !== "default") {
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
  return { kind: "resolved", dir: resolved };
}

export const ompAdapter: AgentAdapter<OmpSession, OmpInfo> = {
  kind: "omp",

  resolveSessions(state, log) {
    if (!matchesAgent(state, ompVocab.cli)) return [];
    const pid = state.foregroundPid;
    if (pid === undefined) return null;
    const answer = agentDirFor(state, log);
    if (answer.kind === "unknown") return null;
    if (answer.kind === "no-session") return [];
    const { breadcrumbDir } = answer.dir;
    breadcrumbWatch.note(breadcrumbDir);
    const ttyId = ttyIdForPid(pid, log);
    if (ttyId === null) return null;
    const crumb = readBreadcrumb(path.join(breadcrumbDir, ttyId), log);
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
      breadcrumbWatch.install(onChange, onError, log ?? undefined);
    },
  },
  screenScrape: {
    tailLines: TAIL_REGION_LINES,
    isPollable: isOmpScreenPollable,
    promote: promoteOmpFromScreen,
  },
};
