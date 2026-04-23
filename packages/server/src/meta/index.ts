/**
 * Terminal metadata aggregation — unified state from independent providers.
 *
 * Providers form a DAG:
 *   cwd:<id>  →  git provider  →  git:<id>  →  github provider
 *                                                    ↓
 *   title:<id>  →  process provider  ────────→  metadata:<id>
 *   title:<id> + agent external-change signal  →  agent provider (×N)  →  metadata:<id>
 *   commandRun:<id>  →  agent-command tracker  →  lastAgentCommandName stash + activity:changed
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
 */

import type {
  TerminalMetadata,
  TerminalServerMetadata,
  TerminalClientMetadata,
} from "kolu-common";
import { prValue, prUnavailableReason } from "kolu-common";
import {
  type TerminalProcess,
  recomputeDisplaySuffixes,
  getTerminal,
} from "../terminals.ts";
import { publishForTerminal, publishSystem } from "../publisher.ts";
import { claudeCodeProvider } from "kolu-claude-code";
import { codexProvider } from "kolu-codex";
import { opencodeProvider } from "kolu-opencode";
import { startGitProvider } from "./git.ts";
import { startGitHubPrProvider } from "./github.ts";
import { startAgentProvider } from "./agent.ts";
import { startAgentCommandTracker } from "./agent-command.ts";
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
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    sortOrder,
  };
}

/** Log + publish the current metadata snapshot and trigger debounced
 *  session auto-save. Shared tail for both `updateServerMetadata` and
 *  `updateClientMetadata` so the publish/audit path is identical regardless
 *  of who wrote the fields.
 *
 *  Also recomputes `displaySuffix` across the live set: any cwd/git
 *  change can flip another terminal between "unique" and "collision"
 *  status. Affected terminals get their own metadata republish so each
 *  per-terminal stream stays in sync. */
function publishMetadata(entry: TerminalProcess, terminalId: string): void {
  const m = entry.info.meta;
  const pr = prValue(m.pr);
  const prUnavailable = prUnavailableReason(m.pr);
  log.debug(
    {
      terminal: terminalId,
      cwd: m.cwd,
      repo: m.git?.repoName,
      branch: m.git?.branch,
      pr: pr?.number ?? null,
      checks: pr?.checks ?? null,
      prStatus: m.pr.kind,
      ...(prUnavailable && { prUnavailable }),
      // Only include agent/foreground fields when present to avoid noisy null logs
      ...(m.agent && { agent: `${m.agent.kind}:${m.agent.state}` }),
      ...(m.foreground && { foreground: m.foreground.name }),
    },
    "metadata publish",
  );
  const suffixChanges = recomputeDisplaySuffixes();
  publishForTerminal("metadata", terminalId, { ...m });
  for (const id of suffixChanges) {
    if (id === terminalId) continue; // already published above
    const other = getTerminal(id);
    if (other) publishForTerminal("metadata", id, { ...other.info.meta });
  }
  publishSystem("terminals:dirty", {});
}

/** Atomically mutate server-derived metadata (cwd, git, pr, agent,
 *  foreground) and publish. The mutator is narrowed to
 *  `TerminalServerMetadata` so providers cannot accidentally write
 *  client-owned fields. */
export function updateServerMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalServerMetadata) => void,
): void {
  mutate(entry.info.meta);
  publishMetadata(entry, terminalId);
}

/** Atomically mutate client-owned metadata (themeName, parentId, sortOrder,
 *  canvasLayout, subPanel) and publish. The mutator is narrowed to
 *  `TerminalClientMetadata` so RPC handlers cannot accidentally overwrite
 *  provider-owned state. */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.info.meta);
  publishMetadata(entry, terminalId);
}

/**
 * Start all metadata providers for a terminal.
 * Returns a cleanup function that stops all providers.
 */
export function startProviders(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  // Tracker starts first so its subscription exists before any
  // `commandRun` event could fire. Ordering between the tracker and the
  // agent-reconcile subscribers isn't load-bearing: at preexec time the
  // `shellIdle` gate in `snapshotTerminalState` skips any reconcile, so
  // the stash is only ever read once the command has actually taken over
  // the foreground — by which point both the `commandRun` and `title`
  // events from that preexec have long since drained.
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
