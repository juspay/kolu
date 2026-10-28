/**
 * Pi's AgentAdapter — wires core into the shared `AgentAdapter<Session, Info>`
 * contract from anyagent.
 *
 * Directory-keyed like codex/opencode: `resolveSessions` scans the cwd's
 * session directory newest-first and offers every candidate; the
 * orchestrator's ownership arbiter assigns one per terminal
 * (juspay/kolu#2057).
 *
 * WHICH directory: pi's session store moves per invocation (`--session-dir`,
 * `PI_CODING_AGENT_SESSION_DIR`, settings.json `sessionDir`,
 * `PI_CODING_AGENT_DIR` — pi 0.84.2's chain, see `session-root.ts`), and
 * those overrides live in the pi process's own argv/env. So the adapter
 * resolves the store root from the terminal's FOREGROUND process each
 * reconcile — not from padi's env — and scans there (`sessionStoreFor`).
 *
 * `externalChanges` IS implemented — pi writes its session file at launch,
 * BEFORE any title event can name it (the preexec hint precedes the file),
 * so a filesystem wake is the only signal that a session appeared; the
 * two-level tree watcher (`subscribeSessionsTree`) fires on both levels.
 * The watcher covers EVERY root ever resolved (the default tree plus each
 * redirected store a terminal revealed), because a late-landing file in a
 * redirected tree is just as invisible to the preexec hint as one in the
 * default tree. Roots are never unwatched (bounded by the distinct stores a
 * host uses).
 *
 * `isPresent` gates install on the binary being foregrounded or the
 * sessions tree already existing — a fresh machine that never ran pi pays
 * no watcher cost (issue #698).
 */

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

/**
 * The session stores kolu knows — the default tree plus every redirected
 * store a foregrounded pi process has revealed. Process-wide and growing:
 * the externalChanges install contract is at-most-once (no uninstall). The
 * KNOWN set is recorded even before install (the exporter consults it —
 * `knownSessionStores`); the WATCHED set subscribes each known store once
 * install's fan-out exists. Keyed by ROOT (the layout travels in the value).
 */
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

/** The session STORE for THIS terminal's pi, from the ONE process snapshot the
 *  caller already read (the host memoises it per foreground sample —
 *  juspay/kolu#2286 — so this never takes a second read). `null` means the
 *  process could not be read: fall back to the default store, the only honest
 *  answer left for the STORE (the caller decides whether it may attribute a
 *  session at all). */
function sessionStoreFor(
  state: AgentTerminalState,
  proc: ProcessSnapshot | null,
  log?: Logger,
): SessionStore {
  if (proc) {
    const resolved = resolveSessionDir({
      argv: proc.argv,
      // `null` = this platform redacts the environment (macOS), which is a
      // different fact from an empty env map; `undefined` is what pi's chain
      // spells "nothing named a store", so the default root applies — the
      // documented Darwin blind spot in this module's header.
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
  return defaultSessionStore();
}

export const piAdapter: AgentAdapter<PiSession, PiInfo> = {
  kind: "pi",

  resolveSessions(state, log) {
    if (!matchesAgent(state, piVocab.cli)) return [];
    // ONE read for this reconcile tick, as omp does: a failed read is "cannot
    // judge" (null), never "no `--no-session`". Falling through to the default
    // store on a failed read would attribute the cwd's stale session to a
    // `pi --no-session` run — exactly the #1495 class this guard closes, and the
    // two reads could disagree (a failure is not cached).
    const proc = state.readProcessSnapshot();
    if (proc === null) return null;
    // `--no-session` writes NO store at all, so whatever session files the cwd
    // already holds belong to EARLIER runs. `--no-session=true` is the same flag
    // in pi's argv parser.
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
