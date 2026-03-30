/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Each provider runs its own async loop, writes to a shared TerminalMetadata
 * object, and calls emitMetadata() to notify subscribers. Providers chain by
 * listening to the "metadata" event for upstream changes (e.g. GitHub PR
 * provider watches for branch changes from the git provider).
 */

import type { TerminalMetadata } from "kolu-common";
import type { TerminalEntry } from "../terminals.ts";
import { publisher } from "../publisher.ts";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startClaudeCodeProvider } from "./claude.ts";
import { log } from "../log.ts";

/** Create initial metadata state for a new terminal. */
export function createMetadata(cwd: string): TerminalMetadata {
  return { cwd, git: null, pr: null, claude: null };
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
      // Only include claude field when present to avoid noisy null logs
      ...(m.claude && { claude: m.claude.state }),
    },
    "metadata emit",
  );
  entry.emitter.emit("metadata", { ...m });
  void publisher.publish("metadata", { terminalId, metadata: { ...m } });
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
  const stopClaude = startClaudeCodeProvider(entry, terminalId);
  return () => {
    stopGit();
    stopGitHubPr();
    stopClaude();
  };
}
