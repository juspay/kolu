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

interface StoreRegistry {
  stores(): readonly SessionStore[];
  note(store: SessionStore): void;
  installFanOut(
    onChange: () => void,
    onError: (err: unknown) => void,
    log?: Logger,
  ): void;
}

function createStoreRegistry(): StoreRegistry {
  const known = new Map<string, SessionStore>();
  const watched = new Map<string, () => void>();
  let fanOut: {
    onChange: () => void;
    onError: (err: unknown) => void;
    log?: Logger;
  } | null = null;

  function watch(store: SessionStore): void {
    if (fanOut === null || watched.has(store.root)) return;
    watched.set(
      store.root,
      subscribeSessionsTree(store, fanOut.onChange, fanOut.onError, fanOut.log),
    );
  }

  return {
    stores: () => [...known.values()],
    note(store) {
      known.set(store.root, store);
      watch(store);
    },
    installFanOut(onChange, onError, log) {
      fanOut = { onChange, onError, log };
      const fallback = defaultSessionStore();
      known.set(fallback.root, fallback);
      for (const store of known.values()) watch(store);
    },
  };
}

const registry = createStoreRegistry();

/** Every session store kolu knows about. Exported for the transcript
 *  exporter, which searches these (plus the default) for a session id. */
export function knownSessionStores(): readonly SessionStore[] {
  return registry.stores();
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
    registry.note(store);
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
      registry.installFanOut(onChange, onError, log);
    },
  },
};
