/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Each provider runs its own async loop, writes to a shared TerminalMetadata
 * object, and calls emitMetadata() to notify subscribers. Providers chain by
 * listening to the "metadata" event for upstream changes (e.g. GitHub PR
 * provider watches for branch changes from the git provider).
 */

import type { TerminalMetadata, ProcessInfo } from "kolu-common";
import type { TerminalEntry } from "../terminals.ts";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startClaudeCodeProvider } from "./claude.ts";
import { startProcessProvider } from "./process.ts";
import { log } from "../log.ts";

/** Create initial metadata state for a new terminal. */
export function createMetadata(cwd: string): TerminalMetadata {
  return { cwd, git: null, pr: null, process: null };
}

/**
 * Combine processName + processMeta into the wire-format ProcessInfo.
 *
 * Enrichment providers (claude, etc.) take priority: if an enrichment
 * exists, it produces a specialized variant regardless of the generic
 * process name. This means providers don't need to know about each other —
 * only this combiner knows the priority order.
 */
function resolveProcess(entry: TerminalEntry): ProcessInfo | null {
  const { processMeta, processName } = entry;

  if (processMeta.claude) {
    return { kind: "claude", name: "claude", ...processMeta.claude };
  }

  if (!processName) return null;
  return { kind: "generic", name: processName };
}

/**
 * Resolve process state from internal slots and emit if changed.
 * Called by both the process provider and enrichment providers (claude, etc.).
 */
export function updateProcess(entry: TerminalEntry, terminalId: string): void {
  const resolved = resolveProcess(entry);
  const prev = entry.metadata.process;

  // Quick equality check — avoid emitting unchanged state
  if (resolved === null && prev === null) return;
  if (
    resolved &&
    prev &&
    resolved.kind === prev.kind &&
    JSON.stringify(resolved) === JSON.stringify(prev)
  )
    return;

  entry.metadata.process = resolved;
  emitMetadata(entry, terminalId);
}

/** Emit the current metadata snapshot to all subscribers. */
export function emitMetadata(entry: TerminalEntry, terminalId: string): void {
  const m = entry.metadata;
  log.info(
    {
      terminal: terminalId,
      cwd: m.cwd,
      repo: m.git?.repoName,
      branch: m.git?.branch,
      pr: m.pr?.number ?? null,
      checks: m.pr?.checks ?? null,
      // Only include process field when present to avoid noisy null logs
      ...(m.process && {
        process: m.process.name,
        ...(m.process.kind === "claude" && { claudeState: m.process.state }),
      }),
    },
    "metadata emit",
  );
  entry.emitter.emit("metadata", { ...m });
}

/**
 * Start all metadata providers for a terminal.
 * Returns a cleanup function that stops all providers.
 */
export function startProviders(
  entry: TerminalEntry,
  terminalId: string,
): () => void {
  const stopGit = startGitProvider(entry, terminalId);
  const stopGitHubPr = startGitHubPrProvider(entry, terminalId);
  const stopProcess = startProcessProvider(entry, terminalId);
  const stopClaude = startClaudeCodeProvider(entry, terminalId);
  return () => {
    stopGit();
    stopGitHubPr();
    stopProcess();
    stopClaude();
  };
}
