/**
 * Process provider — detects foreground process and derives agent state.
 *
 * Single poll loop per terminal:
 * 1. Reads foreground process name via node-pty's .process (cross-platform)
 * 2. If process matches a known agent, reads that agent's session state
 * 3. Publishes both meta.process and meta.agent
 *
 * Claude Code gets an optional fs.watch optimization for near-instant
 * state updates between poll ticks.
 */

import path from "node:path";
import type { AgentInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import {
  readClaudeCodeState,
  agentInfoEqual,
  watchTranscript,
} from "./claude.ts";
import { readOpenCodeState } from "./opencode.ts";
import { log } from "../log.ts";

const POLL_INTERVAL_MS = 3_000;

/** Extract the binary name from a process string.
 *  node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on NixOS)
 *  or just the binary name. Always normalize to the basename. */
function processBasename(proc: string): string {
  return path.basename(proc);
}

/**
 * Read agent state for a terminal.
 * Primary: foreground process basename triggers agent-specific reader.
 * Fallback: scan Claude session files via PTY matching (handles cases
 * where node-pty reports the shell name instead of the agent, e.g. on
 * some platforms or in tests).
 */
function readAgentState(
  basename: string,
  entry: TerminalProcess,
): AgentInfo | null {
  if (basename === "claude") {
    return readClaudeCodeState(entry.handle.pid);
  }
  if (basename === "opencode") {
    return readOpenCodeState(entry.handle.cwd);
  }
  // Fallback: scan Claude session files via PTY matching — covers cases where
  // node-pty reports the shell name instead of the agent (e.g. platforms where
  // .process doesn't resolve Claude's binary name, or in e2e tests)
  return readClaudeCodeState(entry.handle.pid);
}

/**
 * Start the process + agent provider for a terminal.
 * Polls foreground process and derives agent state.
 */
export function startProcessProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastProcess: string | null = null;
  let stopWatch: (() => void) | null = null;

  plog.info("started");

  function onAgentStateChange() {
    // Called by fs.watch on Claude JSONL — re-read and publish if changed
    const agentInfo = lastProcess ? readAgentState(lastProcess, entry) : null;
    if (!agentInfoEqual(agentInfo, entry.info.meta.agent)) {
      plog.info(
        { agent: agentInfo?.kind, state: agentInfo?.state },
        "agent state updated (watch)",
      );
      updateMetadata(entry, terminalId, (m) => {
        m.agent = agentInfo;
      });
    }
  }

  function poll() {
    // Normalize to basename — on NixOS, node-pty returns full /nix/store/... paths
    const processName = processBasename(entry.handle.process);

    // Update meta.process on change
    if (processName !== lastProcess) {
      plog.info(
        { from: lastProcess, to: processName },
        "foreground process changed",
      );

      // Clean up previous agent watch
      if (stopWatch) {
        stopWatch();
        stopWatch = null;
      }

      lastProcess = processName;
      updateMetadata(entry, terminalId, (m) => {
        m.process = processName;
      });
    }

    // Read agent state
    const agentInfo = readAgentState(processName, entry);
    if (!agentInfoEqual(agentInfo, entry.info.meta.agent)) {
      plog.info(
        { agent: agentInfo?.kind, state: agentInfo?.state },
        "agent state updated",
      );
      updateMetadata(entry, terminalId, (m) => {
        m.agent = agentInfo;
      });

      // Start/stop Claude transcript watch based on agent state
      if (agentInfo?.kind === "claude-code" && !stopWatch) {
        stopWatch = watchTranscript(entry.handle.pid, onAgentStateChange);
      } else if (agentInfo?.kind !== "claude-code" && stopWatch) {
        stopWatch();
        stopWatch = null;
      }
    }
  }

  // Initial poll + periodic
  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    if (stopWatch) stopWatch();
    plog.info("stopped");
  };
}
