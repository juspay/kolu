/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Each provider runs its own async loop, writes to a shared TerminalMetadata
 * object, and calls publishMetadata() to notify subscribers. Providers chain
 * by subscribing to the publisher (e.g. GitHub PR provider watches for branch
 * changes from the git provider).
 */

import type { TerminalMetadata } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { publishForTerminal } from "../publisher.ts";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startClaudeCodeProvider } from "./claude.ts";
import { log } from "../log.ts";

/** Create initial metadata state for a new terminal. */
export function createMetadata(cwd: string): TerminalMetadata {
  return { cwd, git: null, pr: null, claude: null, busy: true };
}

/** Publish the current metadata snapshot to all subscribers. */
export function publishMetadata(entry: TerminalProcess, terminalId: string): void {
  const m = entry.info.meta;
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
    "metadata publish",
  );
  publishForTerminal("metadata", terminalId, { ...m });
}

/**
 * Start all metadata providers for a terminal.
 * Returns a cleanup function that stops all providers.
 */
export function startProviders(
  entry: TerminalProcess,
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
