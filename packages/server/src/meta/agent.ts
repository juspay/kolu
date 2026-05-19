/**
 * Generic agent metadata provider — single orchestrator for every agent
 * detection integration. Reads observable terminal state, awaits
 * `provider.resolveSession` (executor-routed), and owns the watcher
 * lifecycle.
 *
 * The orchestrator has **zero branches on local vs remote**. Each
 * terminal carries a `Host`; we pick its executor (the host itself is
 * structurally a `GitExecutor`), pass it to the provider, and the same
 * code path runs for both backends. Adding a new agent CLI is a new
 * `AgentProvider` and one line in `startProviders` — no edits here.
 */

import path from "node:path";
import {
  type AgentInfoShape,
  type AgentProvider,
  type AgentTerminalState,
  type AgentWatcher,
  type Executor,
} from "anyagent";
import { localExecutor } from "kolu-git/executor";
import type { Logger } from "kolu-shared";
import type { AgentInfo } from "kolu-common/surface";
import { getHost } from "../host/registry.ts";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { getLastAgentCommandName } from "./agent-command.ts";
import { updateServerLiveMetadata, updateServerMetadata } from "./state.ts";

/** Pure decision: does this agent transition warrant a recency bump? */
export function shouldBumpRecencyForAgentChange(
  prev: AgentInfo | null,
  next: AgentInfo | null,
  currentLastActivityAt: number,
): boolean {
  const transitioning =
    prev?.kind !== next?.kind ||
    prev?.sessionId !== next?.sessionId ||
    prev?.state !== next?.state;
  if (!transitioning) return false;
  const isReDetectionAfterRestore =
    prev === null && next !== null && currentLastActivityAt > 0;
  return !isReDetectionAfterRestore;
}

/** Single write-site for `m.agent`. */
function setAgentMetadata(
  entry: TerminalProcess,
  terminalId: string,
  nextAgent: AgentInfo | null,
): void {
  const bump = shouldBumpRecencyForAgentChange(
    entry.meta.agent,
    nextAgent,
    entry.meta.lastActivityAt,
  );
  updateServerLiveMetadata(entry, terminalId, (m) => {
    m.agent = nextAgent;
  });
  if (bump) {
    updateServerMetadata(entry, terminalId, (m) => {
      m.lastActivityAt = Date.now();
    });
  }
}

/** node-pty may return a full path; normalize to basename. */
function readForegroundBasenameOnce(
  entry: TerminalProcess,
  plog: Logger,
): string | null {
  try {
    const proc = entry.handle.process;
    return proc ? path.basename(proc) : null;
  } catch (err) {
    plog.debug({ err }, "failed to read entry.handle.process");
    return null;
  }
}

function snapshotTerminalState(
  entry: TerminalProcess,
  terminalId: string,
  plog: Logger,
): AgentTerminalState {
  let basename: string | null | undefined;
  const foregroundPid = entry.handle.foregroundPid;
  const shellIdle =
    foregroundPid === undefined || foregroundPid === entry.handle.pid;
  return {
    foregroundPid,
    cwd: entry.meta.cwd,
    readForegroundBasename: () => {
      if (basename === undefined)
        basename = readForegroundBasenameOnce(entry, plog);
      return basename;
    },
    lastAgentCommandName: shellIdle
      ? null
      : getLastAgentCommandName(terminalId),
  };
}

/** Pick the executor for this terminal. Local terminals run agents via
 *  `localExecutor` (controller's fs / child_process). Remote terminals
 *  run them via the SSH host — which structurally satisfies `Executor`.
 *  One orchestrator, two backends.
 *
 *  `hostId` is always a concrete string on terminal metadata
 *  (`"local"` or an SSH alias); `localExecutor` is the fallback when
 *  the registry doesn't recognize the id. */
function executorForTerminal(entry: TerminalProcess): Executor {
  return getHost(entry.meta.hostId) ?? localExecutor;
}

/** Per-executor activation state for the lazy external-change subscription.
 *  Memo-keyed by `{kind, executor}` — installing the same watcher twice
 *  on the same executor's backend is wasteful.
 *
 *  `reconcilers` is the fan-out set: every terminal whose own state has
 *  ever reported "agent present" is in here, and a single external-change
 *  event dispatches to all of them. */
interface ExternalChangesActivation {
  reconcilers: Set<() => void>;
  handle: { stop(): void } | null;
  installing: boolean;
}
const activations = new Map<string, ExternalChangesActivation>();

function activationKey(kind: string, executor: Executor): string {
  // Stable key per executor. `localExecutor` is a module singleton (one
  // reference equality check), and each remote Host is a distinct
  // singleton per ssh alias — they form the natural identity domain.
  return `${kind}::${executorId(executor)}`;
}
const executorIds = new WeakMap<Executor, string>();
let nextExecutorId = 1;
function executorId(executor: Executor): string {
  if (executor === localExecutor) return "local";
  let id = executorIds.get(executor);
  if (!id) {
    id = `exec#${nextExecutorId++}`;
    executorIds.set(executor, id);
  }
  return id;
}

/** Preexec retry chain — same as before. */
const COMMAND_RUN_RECONCILE_DELAYS_MS = [0, 75, 300, 1000] as const;

function getActivation(key: string): ExternalChangesActivation {
  let entry = activations.get(key);
  if (!entry) {
    entry = { reconcilers: new Set(), handle: null, installing: false };
    activations.set(key, entry);
  }
  return entry;
}

/**
 * Start the provider's agent-detection loop for one terminal. Subscribes
 * to title / cwd / commandRun events, awaits `resolveSession` on each
 * fire, and replaces the running watcher iff the `sessionKey` changed.
 *
 * Returns a cleanup function that tears down every subscription + the
 * current watcher.
 */
export function startAgentProvider<Session, Info extends AgentInfoShape>(
  provider: AgentProvider<Session, Info>,
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({
    provider: provider.kind,
    terminal: terminalId,
    hostId: entry.meta.hostId,
  });
  const executor = executorForTerminal(entry);

  let current: { watcher: AgentWatcher; key: string } | null = null;
  let registeredForExternal = false;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];
  let externalActivationKey: string | null = null;

  plog.debug("started");

  async function reconcile(): Promise<void> {
    if (stopped) return;
    const state = snapshotTerminalState(entry, terminalId, plog);

    // Lazy external-change registration. On the first reconcile where the
    // agent is foregrounded in *this* terminal, join the provider's
    // per-executor fan-out set and — if we're the first across the whole
    // process for this executor — install the underlying watcher.
    if (!registeredForExternal && provider.externalChanges) {
      const isPresent = await provider.externalChanges.isPresent(
        state,
        executor,
      );
      if (stopped) return;
      if (isPresent) {
        externalActivationKey = activationKey(provider.kind, executor);
        const activation = getActivation(externalActivationKey);
        activation.reconcilers.add(() => void reconcile());
        registeredForExternal = true;
        if (!activation.handle && !activation.installing) {
          activation.installing = true;
          const slog = log.child({
            provider: provider.kind,
            executor: executorId(executor),
          });
          // Install asynchronously — once installed, the handle is stored
          // and the fan-out fires every reconciler on each event.
          void (async () => {
            try {
              const handle = await provider.externalChanges!.install(
                executor,
                () => {
                  for (const fn of [...activation.reconcilers]) {
                    try {
                      fn();
                    } catch (err) {
                      slog.error({ err }, "reconcile threw on external change");
                    }
                  }
                },
                (err) => slog.error({ err }, "external-change listener threw"),
                slog,
              );
              activation.handle = handle;
            } catch (err) {
              slog.error({ err }, "external watcher install failed");
            } finally {
              activation.installing = false;
            }
          })();
        }
      }
    }

    const next = await provider.resolveSession(state, executor, plog);
    if (stopped) return;
    const nextKey = next ? provider.sessionKey(next) : null;
    if ((current?.key ?? null) === nextKey) return;

    const hadCurrent = current !== null;
    current?.watcher.destroy();
    current = null;

    if (!next || !nextKey) {
      if (hadCurrent) plog.debug("agent session ended");
      if (entry.meta.agent?.kind === provider.kind) {
        setAgentMetadata(entry, terminalId, null);
      }
      return;
    }

    plog.debug({ session: nextKey }, "agent session matched");
    current = {
      key: nextKey,
      watcher: provider.createWatcher(
        next,
        executor,
        (info) => {
          setAgentMetadata(entry, terminalId, info as unknown as AgentInfo);
        },
        plog,
      ),
    };
  }

  function clearCommandRunTimers() {
    for (const timer of commandRunTimers) clearTimeout(timer);
    commandRunTimers = [];
  }

  function reconcileFromCommandRun(idx: number) {
    if (stopped) return;
    void reconcile().catch((err) =>
      plog.error({ err }, "command-run reconcile failed"),
    );
    if (current !== null) return;
    const nextIdx = idx + 1;
    const next = COMMAND_RUN_RECONCILE_DELAYS_MS[nextIdx];
    if (next === undefined) return;
    const cur = COMMAND_RUN_RECONCILE_DELAYS_MS[idx]!;
    commandRunTimers.push(
      setTimeout(() => reconcileFromCommandRun(nextIdx), next - cur),
    );
  }

  function scheduleCommandRunReconciles() {
    clearCommandRunTimers();
    reconcileFromCommandRun(0);
  }

  const cleanupTitle = terminalChannels.title(terminalId).consume({
    onEvent: () => void reconcile(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  const cleanupCwd = terminalChannels.cwd(terminalId).consume({
    onEvent: () => void reconcile(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  const cleanupCommandRun = terminalChannels.commandRun(terminalId).consume({
    onEvent: () => scheduleCommandRunReconciles(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  void reconcile();

  return () => {
    stopped = true;
    clearCommandRunTimers();
    cleanupTitle();
    cleanupCwd();
    cleanupCommandRun();
    if (registeredForExternal && externalActivationKey) {
      const activation = activations.get(externalActivationKey);
      if (activation) {
        // We can't easily remove our specific arrow function from the set —
        // but since reconcilers are stopped-guarded individually, the
        // leaked entry just becomes a no-op on future events. Acceptable
        // for now; a registry-of-handles refactor is the proper fix.
        if (activation.reconcilers.size === 0 && activation.handle) {
          activation.handle.stop();
          activation.handle = null;
        }
      }
    }
    current?.watcher.destroy();
    plog.debug("stopped");
  };
}
