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
  AgentProvider,
  AgentTerminalState,
  AgentWatcher,
  AgentInfoShape,
  Logger,
} from "anyagent";
import type { AgentInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

/** node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on
 *  NixOS). Normalize to basename so providers can compare against known
 *  binary names. Mirrors `processBasename` in `process.ts`.
 *
 *  Reading `entry.handle.process` can throw if node-pty has already
 *  terminated the process; log and return null so the provider treats the
 *  terminal as having no foreground binary (session match will just fail). */
function readForegroundBasename(
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
  plog: Logger,
): AgentTerminalState {
  return {
    foregroundPid: entry.handle.foregroundPid,
    foregroundBasename: readForegroundBasename(entry, plog),
    cwd: entry.info.meta.cwd,
  };
}

/**
 * Start the provider's agent-detection loop for one terminal. Subscribes
 * to title events and the provider's external-change channel (if any);
 * on each signal, re-resolves the matching session and replaces the
 * running watcher iff the `sessionKey` changed.
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

  plog.debug("started");

  function reconcile() {
    const state = snapshotTerminalState(entry, plog);
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
        updateMetadata(entry, terminalId, (m) => {
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
          updateMetadata(entry, terminalId, (m) => {
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

  // Optional external-change channel — providers whose session-match
  // answer can change between title events (e.g. claude-code's
  // SESSIONS_DIR watcher) opt in by implementing this method. Providers
  // without out-of-band signals (e.g. opencode) omit it entirely and we
  // simply never subscribe.
  const unsubscribeExternal = provider.subscribeExternalChanges
    ? provider.subscribeExternalChanges(
        () => reconcile(),
        (err) => plog.error({ err }, "external-change listener threw"),
        plog,
      )
    : null;

  // Initial reconcile — covers terminals that already host a session.
  reconcile();

  return () => {
    abort.abort();
    unsubscribeExternal?.();
    current?.watcher.destroy();
    plog.debug("stopped");
  };
}
