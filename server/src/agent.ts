/** Agent detection — pure functions to identify AI agents in terminal output. */

import type { AgentState, AgentStatus } from "kolu-common";

/** Known agent profile: patterns to match against output and screen state. */
interface AgentProfile {
  id: string;
  /** Patterns matched against PTY output to identify the agent. */
  outputPatterns: RegExp[];
  /** Patterns matched against screen buffer to detect "waiting for input" state. */
  waitingPatterns: RegExp[];
}

const PROFILES: AgentProfile[] = [
  {
    id: "claude-code",
    // Claude Code prints its banner on startup with these distinctive markers.
    // The ╭ box-drawing char is used in tool-use blocks.
    // "Claude Code" appears in the startup banner.
    outputPatterns: [/Claude Code/, /claude-code@/, /╭─/],
    // When idle, Claude Code shows a prompt: ">" or permission prompts like "(y/n)".
    // The ❯ (U+276F) prompt is used in some versions.
    // Match common approval patterns too.
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
 * Scan a PTY output chunk for a known agent signature.
 * Strips ANSI escape sequences first — agent banners are styled.
 * Returns the agent ID (e.g. "claude-code") or null if no match.
 */
export function detectAgent(data: string): string | null {
  const plain = stripAnsi(data);
  const match = PROFILES.find((p) =>
    p.outputPatterns.some((re) => re.test(plain)),
  );
  return match?.id ?? null;
}

/**
 * Classify agent state from the terminal's screen buffer content.
 * Called when the terminal goes idle (no output for the idle threshold).
 */
export function classifyAgentState(
  screenState: string,
  agent: string,
): AgentState {
  const profile = PROFILES.find((p) => p.id === agent);
  if (!profile) return "idle";

  // Strip ANSI/VT escape sequences for cleaner pattern matching
  const plain = stripAnsi(screenState);

  return profile.waitingPatterns.some((re) => re.test(plain))
    ? "waiting"
    : "idle";
}

/** Build an AgentStatus from entry state, or null if no agent detected. */
export function resolveAgentStatus(
  detectedAgent: string | null,
  isActive: boolean,
  screenState: string,
): AgentStatus | null {
  if (!detectedAgent) return null;
  const state: AgentState = isActive
    ? "thinking"
    : classifyAgentState(screenState, detectedAgent);
  return { agent: detectedAgent, state };
}

/** Strip ANSI/VT escape sequences for plain-text pattern matching. */
function stripAnsi(s: string): string {
  // CSI sequences (\x1b[...X), OSC sequences (\x1b]...\x07 or \x1b]...\x1b\\),
  // character set designators (\x1b(X, \x1b)X), and simple two-byte escapes (\x1bX)
  // eslint-disable-next-line no-control-regex
  return s.replace(
    /\x1b(?:\[[0-9;]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][^\n]|[a-zA-Z])/g,
    "",
  );
}
