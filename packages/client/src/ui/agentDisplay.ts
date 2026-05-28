/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel). */

import { agentKindFromCommand } from "@kolu/anyagent/cli";
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

export const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

export const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
  awaiting_user: "Awaiting input",
};

/** Resolve the icon for a raw agent command string (e.g. `"claude --model
 *  sonnet"`). Returns `undefined` for detection-only agents that have no
 *  AgentInfo discriminator (aider/goose/gemini/cursor-agent) and for
 *  unknown commands. Grouped with `agentIcons`/`agentNames` because it
 *  bridges the basename axis to this module's per-kind display tables. */
export function iconForCommand(
  command: string,
): Component<{ class?: string }> | undefined {
  const kind = agentKindFromCommand(command);
  return kind ? agentIcons[kind] : undefined;
}
