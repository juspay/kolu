/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel). */

import type { Component } from "solid-js";
import type { AgentInfo } from "kolu-common";
import { ClaudeCodeIcon, OpenCodeIcon } from "../ui/Icons";

export const agentIcons: Record<
  AgentInfo["kind"],
  Component<{ class?: string }>
> = {
  "claude-code": ClaudeCodeIcon,
  opencode: OpenCodeIcon,
};

export const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};

/** Unified display config per agent state — label, color, and animation in one
 *  table so adding a new state variant can't drift across separate lookups. */
export const stateDisplay: Record<
  AgentInfo["state"],
  { label: string; color: string; animation: string }
> = {
  thinking: {
    label: "Thinking",
    color: "text-busy",
    animation: "animate-pulse",
  },
  tool_use: {
    label: "Running tools",
    color: "text-busy",
    animation: "animate-spin",
  },
  waiting: {
    label: "Waiting for input",
    color: "text-warning",
    animation: "animate-pulse",
  },
  monitoring: {
    label: "Monitoring",
    color: "text-busy",
    animation: "animate-pulse",
  },
};

/** Convenience accessor for display labels only. */
export const stateLabels: Record<AgentInfo["state"], string> =
  Object.fromEntries(
    Object.entries(stateDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<AgentInfo["state"], string>;
