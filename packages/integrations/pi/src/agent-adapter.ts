import os from "node:os";
import {
  type AgentAdapter,
  type AgentTerminalState,
  matchesAgent,
} from "anyagent";
import type { Logger } from "kolu-shared";
import type { ProcessSnapshot } from "kolu-io/types";
import { AGENT_DIR } from "./config.ts";
import {
  defaultSessionStore,
  findSessionsByDirectory,
  type PiSession,
  piHomePresent,
  type SessionStore,
  subscribeSessionsTree,
} from "./core.ts";
import { type PiInfo, piVocab } from "./schemas.ts";
import { resolveSessionDir } from "./session-root.ts";
import { createPiWatcher } from "./session-watcher.ts";

const knownStores = new Map<string, SessionStore>();
const watchedStores = new Map<string, () => void>();
let treeFanOut: (() => void) | null = null;
let treeOnError: ((err: unknown) => void) | null = null;
let treeLog: Logger | null = null;

/** Every session store kolu knows about. Exported for the transcript
 *  exporter, which searches these (plus the default) for a session id. */
export function knownSessionStores(): readonly SessionStore[] {
  return [...knownStores.values()];
}

function watchStore(store: SessionStore): void {
  if (watchedStores.has(store.root)) return;
  watchedStores.set(
    store.root,
    subscribeSessionsTree(
      store,
      treeFanOut!,
      (err) => treeOnError?.(err),
      treeLog ?? undefined,
    ),
  );
}

function noteStore(store: SessionStore): void {
  knownStores.set(store.root, store);
  if (treeFanOut) watchStore(store);
}

function sessionStoreFor(
  state: AgentTerminalState,
  proc: ProcessSnapshot,
  log?: Logger,
): SessionStore {
  const resolved = resolveSessionDir({
    argv: proc.argv,
    env: proc.env ?? undefined,
    home: os.homedir(),
    defaultAgentDir: AGENT_DIR,
    cwd: state.cwd,
    log,
  });
  if (resolved.source !== "default") {
    log?.info(
      {
        dir: resolved.dir,
        layout: resolved.layout,
        source: resolved.source,
        cwd: state.cwd,
      },
      "pi: session store redirected",
    );
  }
  return { root: resolved.dir, layout: resolved.layout };
}

export const piAdapter: AgentAdapter<PiSession, PiInfo> = {
  kind: "pi",

  resolveSessions(state, log) {
    if (!matchesAgent(state, piVocab.cli)) return [];
    const proc = state.readProcessSnapshot();
    if (proc === null) return null;
    if (proc.argv.some((arg) => arg.startsWith("--no-session"))) return [];
    const store = sessionStoreFor(state, proc, log);
    noteStore(store);
    return findSessionsByDirectory(state.cwd, store, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createPiWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, piVocab.cli) || piHomePresent();
    },
    install(onChange, onError, log) {
      treeFanOut = onChange;
      treeOnError = onError;
      treeLog = log ?? null;
      // Drain every store known so far (any resolved before install —
      // resolveSessions runs in the same reconcile pass AFTER install in the
      // sensors, but the ordering belt needs braces).
      noteStore(defaultSessionStore());
      for (const store of knownStores.values()) watchStore(store);
    },
  },
};
