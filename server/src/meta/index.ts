/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Providers form a reactive DAG via @solidjs/signals:
 *   cwdSignal  →  git provider  →  gitSignal  →  github provider
 *                                                       ↓
 *   claude provider (polling)  ──────────────→  metadataSignal
 *
 * Each provider calls updateMetadata() to atomically mutate + set the signal.
 * No provider reads the aggregated metadata signal — that's client-facing only.
 */

import type { TerminalMetadata } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { setMetadataSignal } from "../signals.ts";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startClaudeCodeProvider } from "./claude.ts";
import { log } from "../log.ts";

/** Create initial metadata state for a new terminal. */
export function createMetadata(
  cwd: string,
  sortOrder: number,
): TerminalMetadata {
  return { cwd, git: null, pr: null, claude: null, sortOrder };
}

/** Atomically mutate metadata and set the signal for all subscribers.
 *  Single place to audit — impossible to forget the signal update. */
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
      // Only include claude field when present to avoid noisy null logs
      ...(m.claude && { claude: m.claude.state }),
    },
    "metadata publish",
  );
  setMetadataSignal(terminalId, { ...m });
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
