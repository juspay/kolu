/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel). */

import type { Component } from "solid-js";
import type { AgentInfo } from "kolu-common";
import { ClaudeCodeIcon, OpenCodeIcon, CodexIcon } from "../ui/Icons";

export const agentIcons: Record<
  AgentInfo["kind"],
  Component<{ class?: string }>
> = {
  "claude-code": ClaudeCodeIcon,
  opencode: OpenCodeIcon,
  codex: CodexIcon,
};

export const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

export const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
};
