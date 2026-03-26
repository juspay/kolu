/**
 * Agent detection — generic dispatcher.
 *
 * Identifies agents by foreground process name, delegates state
 * classification and file watching to per-agent modules in agents/.
 * Adding a new agent = new file in agents/ + new entry in PROFILES.
 */

import type { AgentState, AgentStatus } from "kolu-common";
import * as claudeCode from "./agents/claude-code.ts";

/** Per-agent profile: process names for detection + hooks for state/watching. */
interface AgentProfile {
  id: string;
  processNames: string[];
  classifyState: (terminalCwd: string) => AgentState;
  watchState: (terminalCwd: string, onChange: () => void) => WatchResult;
}

const PROFILES: AgentProfile[] = [
  {
    id: "claude-code",
    processNames: ["claude"],
    classifyState: claudeCode.classifyState,
    watchState: claudeCode.watchState,
  },
];

function findProfile(processName: string): AgentProfile | undefined {
  return PROFILES.find((p) => p.processNames.includes(processName));
}

/** Detect which agent (if any) is the foreground process. */
export function detectAgentByProcess(processName: string): string | null {
  return findProfile(processName)?.id ?? null;
}

/** Resolve agent status from foreground process + terminal CWD. */
export function resolveAgentStatus(
  foregroundProcess: string,
  terminalCwd: string,
): AgentStatus | null {
  const profile = findProfile(foregroundProcess);
  if (!profile) return null;
  return { agent: profile.id, state: profile.classifyState(terminalCwd) };
}

export interface WatchResult {
  cleanup: () => void;
  active: boolean;
}

/** Watch for agent state changes. active=false if no session found yet (retry later). */
export function watchAgentState(
  foregroundProcess: string,
  terminalCwd: string,
  onChange: () => void,
): WatchResult {
  const profile = findProfile(foregroundProcess);
  if (!profile) return { cleanup: () => {}, active: false };
  return profile.watchState(terminalCwd, onChange);
}
