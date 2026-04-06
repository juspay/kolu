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

/** Read agent state based on the foreground process name. */
function readAgentState(
  processName: string,
  entry: TerminalProcess,
): AgentInfo | null {
  // node-pty returns the binary name; Claude Code appears as "claude"
  if (processName === "claude") {
    return readClaudeCodeState(entry.handle.pid);
  }
  if (processName === "opencode") {
    return readOpenCodeState(entry.handle.cwd);
  }
  return null;
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
    const processName = entry.handle.process;

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

      // Start Claude transcript watch for near-instant state updates
      if (processName === "claude") {
        stopWatch = watchTranscript(entry.handle.pid, onAgentStateChange);
      }
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
