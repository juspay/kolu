/**
 * Agent detection — identify AI agents by foreground process name,
 * classify state from screen buffer content.
 */

import type { AgentState, AgentStatus } from "kolu-common";

/** Known agent: binary names to match + prompt patterns for "waiting" detection. */
interface AgentProfile {
  id: string;
  /** Process names that identify this agent (matched against PTY foreground process). */
  processNames: string[];
  /** Screen buffer patterns that indicate the agent is waiting for user input. */
  waitingPatterns: RegExp[];
}

const PROFILES: AgentProfile[] = [
  {
    id: "claude-code",
    processNames: ["claude"],
    waitingPatterns: [
      /^>\s*$/m, // bare prompt line
      /❯\s*$/m, // heavy right-pointing angle
      /\(y\/n\)/i, // permission prompt
      /\(Y\)es/i, // "Yes/No" prompt variant
      /Do you want to proceed/i,
    ],
  },
];

/**
 * Detect which agent (if any) is the foreground process.
 * Returns the agent ID or null.
 */
export function detectAgentByProcess(processName: string): string | null {
  const match = PROFILES.find((p) =>
    p.processNames.some((name) => processName === name),
  );
  return match?.id ?? null;
}

/**
 * Classify agent state from the terminal's screen buffer.
 * - "waiting" if a known prompt pattern is visible
 * - "idle" otherwise (agent is doing something but not prompting)
 */
export function classifyAgentState(
  screenState: string,
  agent: string,
): AgentState {
  const profile = PROFILES.find((p) => p.id === agent);
  if (!profile) return "idle";

  const plain = stripAnsi(screenState);
  return profile.waitingPatterns.some((re) => re.test(plain))
    ? "waiting"
    : "idle";
}

/**
 * Resolve full agent status from foreground process + activity + screen buffer.
 * Returns null if foreground process is not a known agent.
 */
export function resolveAgentStatus(
  foregroundProcess: string,
  isActive: boolean,
  screenState: string,
): AgentStatus | null {
  const agent = detectAgentByProcess(foregroundProcess);
  if (!agent) return null;
  const state: AgentState = isActive
    ? "thinking"
    : classifyAgentState(screenState, agent);
  return { agent, state };
}

/** Strip ANSI/VT escape sequences for plain-text pattern matching. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(
    /\x1b(?:\[[0-9;]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][^\n]|[a-zA-Z])/g,
    "",
  );
}
