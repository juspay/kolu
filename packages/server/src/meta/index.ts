/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Providers form a DAG:
 *   cwd:<id>  →  git provider  →  git:<id>  →  github provider
 *                                                    ↓
 *   title:<id>  →  process provider  ────────→  metadata:<id>
 *   title:<id> + agent external-change signal  →  agent provider (×N)  →  metadata:<id>
 *   commandRun:<id>  →  agent-command tracker  →  lastAgentCommandName stash
 *                                                 + metadata:<id> (lastAgentCommand)
 *                                                 + activity:changed
 *
 * Providers publish server-derived fields via `updateServerMetadata`; client
 * RPC handlers persist client-owned fields via `updateClientMetadata` (or
 * direct mutation for paths that skip the metadata publish). Both functions
 * share the same publish/auto-save path — the type difference is a
 * compile-time fence so a provider cannot accidentally write canvasLayout
 * and an RPC handler cannot accidentally write git.
 *
 * No provider subscribes to the aggregated "metadata" channel — that's client-facing only.
 *
 * Agent-detection providers (claude-code, codex, opencode, future aider/…)
 * share a single generic orchestrator (`startAgentProvider`) that consumes
 * an `AgentProvider` instance from the integration package. Adding a new
 * agent is a new provider instance and one extra line below — not a new
 * server-side adapter file.
 *
 * Module layout:
 *   - `./state.ts`        — `createMetadata` / `updateServerMetadata` /
 *                           `updateClientMetadata`. Leaf (no imports from
 *                           peer providers).
 *   - `./agent-command.ts`, `./agent.ts`, `./git.ts`, `./github.ts`,
 *     `./process.ts` — per-provider start functions. Each imports from
 *                      `./state.ts` and `../terminal-registry.ts`.
 *   - `./index.ts`        — this file. Composes them via `startProviders`
 *                           and re-exports the metadata mutators so
 *                           external callers (terminals.ts, router.ts)
 *                           keep one import path.
 */

import { claudeCodeProvider } from "kolu-claude-code";
import { codexProvider } from "kolu-codex";
import { opencodeProvider } from "kolu-opencode";
import type { TerminalProcess } from "../terminal-registry.ts";
import { startAgentProvider } from "./agent.ts";
import { startAgentCommandTracker } from "./agent-command.ts";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startProcessProvider } from "./process.ts";

export {
  createMetadata,
  updateClientMetadata,
  updateServerMetadata,
} from "./state.ts";

/**
 * Start all metadata providers for a terminal.
 * Returns a cleanup function that stops all providers.
 */
export function startProviders(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  // Subscribe the tracker before any provider — the stash it maintains is
  // read by `startAgentProvider`'s reconcile via `getLastAgentCommandName`.
  const stopAgentCommand = startAgentCommandTracker(terminalId);
  const stopGit = startGitProvider(entry, terminalId);
  const stopGitHubPr = startGitHubPrProvider(entry, terminalId);
  const stopClaude = startAgentProvider(claudeCodeProvider, entry, terminalId);
  const stopCodex = startAgentProvider(codexProvider, entry, terminalId);
  const stopOpenCode = startAgentProvider(opencodeProvider, entry, terminalId);
  const stopProcess = startProcessProvider(entry, terminalId);
  return () => {
    stopAgentCommand();
    stopGit();
    stopGitHubPr();
    stopClaude();
    stopCodex();
    stopOpenCode();
    stopProcess();
  };
}
