/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Providers form a DAG:
 *   cwd:<id>  →  git provider  →  git:<id>  →  github provider
 *                                                    ↓
 *   title:<id>  →  process provider  ────────→  metadata:<id>
 *   title:<id> + fs.watch  →  claude provider  →  metadata:<id>
 *
 * Each provider calls updateMetadata() to atomically mutate+publish.
 * No provider subscribes to the aggregated "metadata" channel — that's client-facing only.
 */

import type { TerminalMetadata } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { publishForTerminal } from "../publisher.ts";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startClaudeCodeProvider } from "./claude.ts";
import { startProcessProvider } from "./process.ts";
import { log } from "../log.ts";

/** Create initial metadata state for a new terminal. */
export function createMetadata(
  cwd: string,
  sortOrder: number,
): TerminalMetadata {
  return {
    cwd,
    git: null,
    pr: null,
    claude: null,
    foreground: null,
    sortOrder,
  };
}

/** Atomically mutate metadata and publish the snapshot to all subscribers.
 *  Single place to audit — impossible to forget the publish. */
export function updateMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalMetadata) => void,
): void {
  mutate(entry.info.meta);
  const m = entry.info.meta;
  log.info(
    {
      terminal: terminalId,
      cwd: m.cwd,
      repo: m.git?.repoName,
      branch: m.git?.branch,
      pr: m.pr?.number ?? null,
      checks: m.pr?.checks ?? null,
      // Only include claude/foreground fields when present to avoid noisy null logs
      ...(m.claude && { claude: m.claude.state }),
      ...(m.foreground && { foreground: m.foreground.name }),
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
  const stopProcess = startProcessProvider(entry, terminalId);
  return () => {
    stopGit();
    stopGitHubPr();
    stopClaude();
    stopProcess();
  };
}
