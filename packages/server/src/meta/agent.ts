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
  Logger,
} from "anyagent";
import type { AgentInfo } from "kolu-common";
import { log } from "../log.ts";
import { subscribeForTerminal } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { getLastAgentCommandName } from "./agent-command.ts";
import { updateServerMetadata } from "./state.ts";

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
    cwd: entry.info.meta.cwd,
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
 * Shared across every terminal that uses a given provider kind. Installed
 * at most once per process, the first time any terminal's state reports
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
  /** Per-terminal reconcile callbacks. Keying by terminal id (rather
   *  than holding the bare functions in a Set) lets diagnostics enumerate
   *  the fan-out membership without giving callers access to the
   *  reconcile closures. Add/delete keep the same O(1) characteristics. */
  reconcilers: Map<string, () => void>;
  installed: boolean;
}
const activations = new Map<string, ExternalChangesActivation>();

function getActivation(kind: string): ExternalChangesActivation {
  let entry = activations.get(kind);
  if (!entry) {
    entry = { reconcilers: new Map(), installed: false };
    activations.set(kind, entry);
  }
  return entry;
}

/** Snapshot of installed external-change activations for diagnostics —
 *  one entry per provider kind whose shared watcher is currently running
 *  (e.g. a directory watch on `~/.claude/projects`). Provider kinds whose
 *  watcher hasn't been installed (never foregrounded, or installed=false
 *  for any other reason) are excluded — callers don't need the lifecycle
 *  flag, only the live set. */
export function installedActivations(): Array<{
  kind: string;
  /** Terminal IDs currently subscribed to this shared singleton. */
  terminalIds: readonly string[];
}> {
  const out: Array<{ kind: string; terminalIds: readonly string[] }> = [];
  for (const [kind, a] of activations) {
    if (!a.installed) continue;
    out.push({ kind, terminalIds: [...a.reconcilers.keys()] });
  }
  return out;
}

/**
 * Start the provider's agent-detection loop for one terminal. Subscribes
 * to title events and — lazily, on first `isPresent` match — joins the
 * process-wide external-change fan-out for this provider; on each signal,
 * re-resolves the matching session and replaces the running watcher iff
 * the `sessionKey` changed.
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

  let current: { watcher: AgentWatcher; key: string } | null = null;
  let registeredForExternal = false;

  plog.debug("started");

  function reconcile() {
    const state = snapshotTerminalState(entry, terminalId, plog);

    // Lazy external-change registration. On the first reconcile where the
    // agent is foregrounded in *this* terminal, join the provider's
    // fan-out set and — if we're the first across the whole process —
    // install the underlying watcher.
    if (!registeredForExternal && provider.externalChanges?.isPresent(state)) {
      const activation = getActivation(provider.kind);
      activation.reconcilers.set(terminalId, reconcile);
      registeredForExternal = true;
      if (!activation.installed) {
        activation.installed = true;
        const slog = log.child({ provider: provider.kind });
        provider.externalChanges.install(
          () => {
            // Snapshot before iteration so a reconcile that registers or
            // unregisters synchronously can't skip a peer for this event.
            for (const fn of [...activation.reconcilers.values()]) {
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
      }
    }

    const next = provider.resolveSession(state, plog);
    const nextKey = next ? provider.sessionKey(next) : null;
    if ((current?.key ?? null) === nextKey) return;

    const hadCurrent = current !== null;
    current?.watcher.destroy();
    current = null;

    if (!next || !nextKey) {
      if (hadCurrent) plog.debug("agent session ended");
      // Only clear metadata if the terminal's agent is ours to clear.
      // Other providers of different kinds share the same `m.agent` slot.
      if (entry.info.meta.agent?.kind === provider.kind) {
        updateServerMetadata(entry, terminalId, (m) => {
          m.agent = null;
        });
      }
      return;
    }

    plog.debug({ session: nextKey }, "agent session matched");
    current = {
      key: nextKey,
      watcher: provider.createWatcher(
        next,
        (info) => {
          updateServerMetadata(entry, terminalId, (m) => {
            // Widen Info to AgentInfo — every concrete Info variant is a
            // member of the AgentInfo discriminated union by construction
            // (its schema is one of the union's branches). The cast lives
            // at the sole metadata-write site for agent info, so widening
            // is confined to this one line rather than smeared across
            // every provider.
            m.agent = info as unknown as AgentInfo;
          });
        },
        plog,
      ),
    };
  }

  // Title events — fired by OSC 2 preexec hook. Every shell command
  // boundary is a potential session-match change.
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, () => reconcile());

  // Initial reconcile — covers terminals that already host a session.
  reconcile();

  return () => {
    abort.abort();
    if (registeredForExternal) {
      activations.get(provider.kind)?.reconcilers.delete(terminalId);
    }
    current?.watcher.destroy();
    plog.debug("stopped");
  };
}
