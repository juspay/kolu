/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Providers form a DAG:
 *   cwd:<id>  →  git provider  →  git:<id>  →  github provider
 *                                                    ↓
 *   title:<id>  →  process provider  ────────→  metadata:<id>
 *   title:<id> + agent external-change signal  →  agent provider (×N)  →  metadata:<id>
 *
 * Each provider calls updateMetadata() to atomically mutate+publish.
 * No provider subscribes to the aggregated "metadata" channel — that's client-facing only.
 *
 * Agent-detection providers (claude-code, opencode, future aider/codex/…)
 * share a single generic orchestrator (`startAgentProvider`) that consumes
 * an `AgentProvider` instance from the integration package. Adding a new
 * agent is a new provider instance and one extra line below — not a new
 * server-side adapter file.
 */

import type { TerminalMetadata } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { publishForTerminal, publishSystem } from "../publisher.ts";
import { claudeCodeProvider } from "kolu-claude-code";
import { opencodeProvider } from "kolu-opencode";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startAgentProvider } from "./agent.ts";
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
    agent: null,
    foreground: null,
    sortOrder,
  };
}

/** Atomically mutate metadata, publish the snapshot to subscribers, and
 *  trigger a debounced session auto-save. Single place to audit —
 *  impossible to forget either the client publish or the session save. */
export function updateMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalMetadata) => void,
): void {
  mutate(entry.info.meta);
  const m = entry.info.meta;
  log.debug(
    {
      terminal: terminalId,
      cwd: m.cwd,
      repo: m.git?.repoName,
      branch: m.git?.branch,
      pr: m.pr?.number ?? null,
      checks: m.pr?.checks ?? null,
      // Only include agent/foreground fields when present to avoid noisy null logs
      ...(m.agent && { agent: `${m.agent.kind}:${m.agent.state}` }),
      ...(m.foreground && { foreground: m.foreground.name }),
    },
    "metadata publish",
  );
  publishForTerminal("metadata", terminalId, { ...m });
  publishSystem("terminals:dirty", {});
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
  const stopClaude = startAgentProvider(claudeCodeProvider, entry, terminalId);
  const stopOpenCode = startAgentProvider(opencodeProvider, entry, terminalId);
  const stopProcess = startProcessProvider(entry, terminalId);
  return () => {
    stopGit();
    stopGitHubPr();
    stopClaude();
    stopOpenCode();
    stopProcess();
  };
}
