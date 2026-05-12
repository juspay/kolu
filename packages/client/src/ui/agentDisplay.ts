/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel). */

import type { AgentInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon } from "../ui/Icons";

export const agentIcons: Record<
  AgentInfo["kind"],
  Component<{ class?: string }>
> = {
  "claude-code": ClaudeCodeIcon,
  codex: CodexIcon,
  opencode: OpenCodeIcon,
};

/** Maps a normalized agent CLI invocation (first token + stable flags, the
 *  shape `parseAgentCommand` produces and `RecentAgent.command` carries)
 *  to its `AgentInfo["kind"]`. Returns `null` for unrecognized commands
 *  and for detection-only agents (aider/goose/gemini/cursor-agent) — those
 *  have no icon mapping. The basename axis (`claude`/`codex`/`opencode`)
 *  and the kind axis (`claude-code`/`codex`/`opencode`) differ only for
 *  Claude; this is the single place that bridges them. */
const COMMAND_BASENAME_TO_KIND: Record<string, AgentInfo["kind"]> = {
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode",
};

export function agentKindFromCommand(
  command: string,
): AgentInfo["kind"] | null {
  const head = command.trim().split(/\s+/, 1)[0] ?? "";
  const slash = head.lastIndexOf("/");
  const basename = slash === -1 ? head : head.slice(slash + 1);
  return COMMAND_BASENAME_TO_KIND[basename] ?? null;
}

export const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

export const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
};
