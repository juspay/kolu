/**
 * Generic agent metadata provider — single orchestrator for every agent
 * detection integration. Replaces the pre-#601 per-agent `claude.ts` and
 * `opencode.ts` adapters (which had structurally identical bodies).
 *
 * Reads the terminal's observable state (foreground pid, foreground
 * basename, cwd), delegates session matching to the integration's
 * `AgentProvider`, and owns the watcher lifecycle + metadata publish loop.
 * Adding a new agent CLI is a new `AgentProvider` instance and one line in
 * `startProviders` — no edits to this file.
 */

import path from "node:path";
import type {
  AgentInfoShape,
  AgentProvider,
  AgentTerminalState,
  AgentWatcher,
} from "anyagent";
import { localExecutor, type Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import type { AgentInfo } from "kolu-common/surface";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { getLastAgentCommandName } from "./agent-command.ts";
import { updateServerLiveMetadata, updateServerMetadata } from "./state.ts";

/** Pure decision: does this agent transition warrant a recency bump?
 *
 *  - Watcher emits sharing the same `kind`/`sessionId`/`state` are
 *    dedup'd here so frequent sub-info refreshes (`contextTokens`,
 *    `summary`) don't perturb ordering.
 *  - Restore caveat: agent state is transient, so a restored terminal
 *    always sees a `null → detected` "transition" the moment the
 *    provider re-observes the still-running session. If the terminal
 *    already carries a non-zero `lastActivityAt` (from the saved
 *    session), that's the truth of when the user last interacted —
 *    don't overwrite it with `Date.now()` just because the live agent
 *    slot was re-populated. The next real state change inside the
 *    session will bump as usual. */
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

/** Single write-site for `m.agent`. The provider's watcher emits at
 *  ~150ms cadence while an agent is streaming; only a small fraction
 *  of those emits cross the recency-bump threshold (transitions on
 *  `kind`/`sessionId`/`state`). Sub-info refreshes — `contextTokens`,
 *  `summary`, `taskProgress` — share the live `agent` slot but don't
 *  bump.
 *
 *  Every tick writes `m.agent` via the live variant (no dirty signal,
 *  no autosave). On a bump, a second call writes `m.lastActivityAt`
 *  via the persisting variant. The two-call shape is forced by the
 *  bidirectional type fence in `state.ts`; the second publish is
 *  cheap and only happens on transitions. */
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
  // Live first so the dirty-fire snapshot already includes `nextAgent`.
  // The bidirectional fence on `updateServerMetadata` (mutator typed
  // to ServerPersistedTerminalFields) means the bump path can't write
  // `m.agent` and `m.lastActivityAt` in one closure — that's the price
  // of the structural fence, paid only on transitions (sparse).
  updateServerLiveMetadata(entry, terminalId, (m) => {
    m.agent = nextAgent;
  });
  if (bump) {
    updateServerMetadata(entry, terminalId, (m) => {
      m.lastActivityAt = Date.now();
    });
  }
}

/** node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on
 *  NixOS). Normalize to basename so providers can compare against known
 *  binary names. Mirrors `processBasename` in `process.ts`.
 *
 *  Reading `entry.handle.process` involves a kernel syscall on darwin
 *  (sysctl) and can throw if node-pty has already terminated the process;
 *  log and return null so the provider treats the terminal as having no
 *  foreground binary (session match will just fail). */
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

/** Build a snapshot. `readForegroundBasename` is a lazy, memoized accessor
 *  so providers that match by PID alone (e.g. claude-code) skip the darwin
 *  sysctl entirely on every reconcile. The cache is scoped to this one
 *  snapshot — a fresh snapshot on the next reconcile will re-read.
 *
 *  `lastAgentCommandName` is sourced from the per-terminal agent-command
 *  stash (`meta/agent-command.ts`, populated by the `commandRun` publisher
 *  channel), gated on `foregroundPid !== handle.pid` — i.e. a foreground
 *  command is actually running. When the shell is idle at the prompt,
 *  tcgetpgrp returns the shell's own pid and the previous stash no longer
 *  describes a live process; null it out so providers don't match an agent
 *  that has already exited. */
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

/**
 * Per-provider activation state for the lazy external-change subscription.
 * Shared across every terminal that uses a given provider kind on the
 * same executor. Installed at most once per process, the first time
 * any terminal's state reports
 * `externalChanges.isPresent` — so a user who has never run the agent
 * pays zero watcher cost and logs no missing-directory errors (issue #698).
 *
 * `reconcilers` is the fan-out set: every terminal whose own state has
 * ever reported "agent present" is in here, and a single external-change
 * event dispatches to all of them. Terminals that never hosted the agent
 * never join the set and never see a spurious reconcile. Entries are
 * removed on terminal teardown; the installed watcher itself stays up
 * for the remainder of the process (the underlying singleton matches
 * that lifetime anyway — there is no useful uninstall).
 */
interface ExternalChangesActivation {
  reconcilers: Set<() => void>;
  handle: { stop(): void } | null;
  installing: boolean;
}
const activations = new Map<string, ExternalChangesActivation>();

/** Preexec (`commandRun`) arrives while the shell still owns the foreground
 *  process group, so a synchronous reconcile reads `state.foregroundPid =
 *  shell.pid` and `snapshotTerminalState` forces `lastAgentCommandName =
 *  null` (the `shellIdle` gate). The matched agent binary takes over a few
 *  ticks later. Retry the reconcile at increasing delays so the per-terminal
 *  preexec stash maintained by `agent-command.ts` is sampled both immediately
 *  (cheap, covers the lucky-fast case where exec has already landed) and
 *  after POSIX foreground ownership has settled — closes the bootstrap
 *  window that previously left the codex provider with no registered
 *  reconciler for this terminal until a later WAL event happened to land
 *  at the right state.
 *
 *  Retries chain (not fan out): each attempt only schedules the next if
 *  the prior attempt didn't already match a session. Stops as soon as
 *  `current !== null`, so a fast match doesn't pay for additional
 *  `resolveSession` reads (which hit SQLite for codex/opencode). */
const COMMAND_RUN_RECONCILE_DELAYS_MS = [0, 75, 300, 1000] as const;

function activationKey(kind: string, executor: Executor): string {
  return `${executor.id}\x00${kind}`;
}

function getActivation(
  kind: string,
  executor: Executor,
): ExternalChangesActivation {
  const key = activationKey(kind, executor);
  let entry = activations.get(key);
  if (!entry) {
    entry = { reconcilers: new Set(), handle: null, installing: false };
    activations.set(key, entry);
  }
  return entry;
}

/**
 * Start the provider's agent-detection loop for one terminal. Subscribes
 * to title / cwd / commandRun events and — lazily, on first `isPresent`
 * match — joins the process-wide external-change fan-out for this provider;
 * on each signal, re-resolves the matching session and replaces the running
 * watcher iff the `sessionKey` changed.
 *
 * Returns a cleanup function that tears down every subscription + the
 * current watcher.
 */
export function startAgentProvider<Session, Info extends AgentInfoShape>(
  provider: AgentProvider<Session, Info>,
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: provider.kind, terminal: terminalId });
  const executor: Executor = localExecutor;

  let current: { watcher: AgentWatcher; key: string } | null = null;
  let registeredForExternal = false;
  let externalReconciler: (() => void) | null = null;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];
  let reconcileSeq = 0;

  plog.debug("started");

  async function reconcile(): Promise<void> {
    if (stopped) return;
    const seq = ++reconcileSeq;
    const state = snapshotTerminalState(entry, terminalId, plog);

    // Lazy external-change registration. On the first reconcile where the
    // agent is foregrounded in *this* terminal, join the provider's
    // fan-out set and — if we're the first across the whole process —
    // install the underlying watcher.
    if (!registeredForExternal && provider.externalChanges) {
      const isPresent = await provider.externalChanges.isPresent(
        state,
        executor,
      );
      if (stopped || seq !== reconcileSeq) return;
      if (isPresent) {
        const activation = getActivation(provider.kind, executor);
        externalReconciler = () => {
          void reconcile().catch((err) =>
            plog.error({ err }, "external-change reconcile failed"),
          );
        };
        activation.reconcilers.add(externalReconciler);
        registeredForExternal = true;
        if (!activation.handle && !activation.installing) {
          activation.installing = true;
          const slog = log.child({ provider: provider.kind });
          void provider.externalChanges
            .install(
              executor,
              () => {
                // Snapshot before iteration so a reconcile that registers or
                // unregisters synchronously can't skip a peer for this event.
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
            )
            .then((handle) => {
              activation.handle = handle;
            })
            .catch((err) => {
              slog.error({ err }, "external-change watcher install failed");
            })
            .finally(() => {
              activation.installing = false;
            });
        }
      }
    }

    const next = await provider.resolveSession(state, executor, plog);
    if (stopped || seq !== reconcileSeq) return;
    const nextKey = next ? provider.sessionKey(next) : null;
    if ((current?.key ?? null) === nextKey) return;

    const hadCurrent = current !== null;
    current?.watcher.destroy();
    current = null;

    if (!next || !nextKey) {
      if (hadCurrent) plog.debug("agent session ended");
      // Only clear metadata if the terminal's agent is ours to clear.
      // Other providers of different kinds share the same `m.agent` slot.
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
          // Widen Info to AgentInfo — every concrete Info variant is a
          // member of the AgentInfo discriminated union by construction
          // (its schema is one of the union's branches). The cast lives
          // at the sole metadata-write site for agent info, so widening
          // is confined to this one line rather than smeared across
          // every provider.
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

  /** Run reconcile attempt `idx` in the commandRun retry chain (sampled
   *  at `COMMAND_RUN_RECONCILE_DELAYS_MS[idx]` ms after commandRun), then
   *  schedule the next attempt only if this one didn't match a session.
   *  Early-out on success means a lucky-fast match pays for one
   *  reconcile instead of all four — each reconcile is a
   *  `resolveSession` call that hits SQLite for codex/opencode. */
  function reconcileFromCommandRun(idx: number) {
    // `stopped` guard is unique to this code path: title/cwd/commandRun
    // channel subscriptions are torn down synchronously by their
    // `consume()` cleanup, so they can't fire post-stop. The
    // commandRun-driven retry chain schedules `setTimeout` callbacks
    // that outlive cleanup — `clearCommandRunTimers()` clears the
    // current set, but a callback already removed from `commandRunTimers`
    // and in the event loop's pending queue still runs. This guard
    // makes that runaway no-op.
    if (stopped) return;
    void (async () => {
      try {
        await reconcile();
      } catch (err) {
        plog.error({ err }, "command-run reconcile failed");
      }
      if (stopped || current !== null) return;
      const nextIdx = idx + 1;
      const next = COMMAND_RUN_RECONCILE_DELAYS_MS[nextIdx];
      if (next === undefined) return;
      const cur = COMMAND_RUN_RECONCILE_DELAYS_MS[idx];
      if (cur === undefined) return;
      commandRunTimers.push(
        setTimeout(() => reconcileFromCommandRun(nextIdx), next - cur),
      );
    })();
  }

  function scheduleCommandRunReconciles() {
    clearCommandRunTimers();
    // First attempt (idx=0) fires synchronously — `DELAYS_MS[0] === 0`.
    // Catches the lucky-fast case where the agent exec has already
    // landed by the time commandRun is published.
    reconcileFromCommandRun(0);
  }

  // Title events — fired by OSC 2 preexec hook. Every shell command
  // boundary is a potential foreground-process change.
  const cleanupTitle = terminalChannels.title(terminalId).consume({
    onEvent: () =>
      void reconcile().catch((err) =>
        plog.error({ err }, "title reconcile failed"),
      ),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  // CWD events — session lookup for directory-scoped agents (Codex,
  // OpenCode) keys on the terminal cwd. Without this edge, a `cd` OSC 7
  // that lands after the command title event leaves matching dependent on
  // a later external (WAL) tick. Real-world repro: `cd ~/proj && codex`
  // in one line — the title event fires on the command boundary before
  // the cwd has been published, so the codex provider sees a stale cwd
  // and `findSessionByDirectory` returns null.
  const cleanupCwd = terminalChannels.cwd(terminalId).consume({
    onEvent: () =>
      void reconcile().catch((err) =>
        plog.error({ err }, "cwd reconcile failed"),
      ),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  // Command-run events — fired by OSC 633;E preexec marks. They update
  // the per-terminal agent-command stash (`meta/agent-command.ts`), then
  // a short burst of delayed reconciles samples state at increasing
  // delays so at least one observes the post-exec foreground-process
  // ownership. Closes the codex/opencode bootstrap window for
  // interpreter-shimmed CLIs (kernel basename ≠ agent name) and the
  // null/null indicator surface seen in `codex.feature:15/:20` under
  // 4-worker contention.
  const cleanupCommandRun = terminalChannels.commandRun(terminalId).consume({
    onEvent: () => scheduleCommandRunReconciles(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  // Initial reconcile — covers terminals that already host a session.
  void reconcile().catch((err) =>
    plog.error({ err }, "initial reconcile failed"),
  );

  return () => {
    stopped = true;
    clearCommandRunTimers();
    cleanupTitle();
    cleanupCwd();
    cleanupCommandRun();
    if (registeredForExternal && externalReconciler) {
      const key = activationKey(provider.kind, executor);
      const activation = activations.get(key);
      activation?.reconcilers.delete(externalReconciler);
      if (activation && activation.reconcilers.size === 0) {
        activation.handle?.stop();
        activations.delete(key);
      }
    }
    current?.watcher.destroy();
    plog.debug("stopped");
  };
}
