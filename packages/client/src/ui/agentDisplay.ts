/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel). */

import { agentKindFromCommand } from "anyagent/cli";
import type { AgentInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import {
  ClaudeCodeIcon,
  CodexIcon,
  GrokIcon,
  OpenCodeIcon,
  XyneIcon,
} from "../ui/Icons";

export const agentIcons: Record<
  AgentInfo["kind"],
  Component<{ class?: string }>
> = {
  "claude-code": ClaudeCodeIcon,
  codex: CodexIcon,
  opencode: OpenCodeIcon,
  grok: GrokIcon,
  xyne: XyneIcon,
};

export const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  grok: "Grok",
  xyne: "Xyne",
};

export const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
  awaiting_user: "Awaiting input",
  running_background: "Running in background",
};

/** Context-token count in compact notation: "47392" → "47K", "1183456" → "1.2M".
 *  `maximumFractionDigits: 1` keeps "1.2M" but avoids "47.0K". Lives here — with
 *  the other agent-display tables — because BOTH readouts of the same number
 *  need it (the header `AgentIndicator` badge and the Inspector's status card),
 *  and the locale/precision choice has to stay one decision rather than two
 *  literals to keep in sync. */
const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const formatContextTokens = (tokens: number): string =>
  tokenFormat.format(tokens);

/** Semantic bucket per state — THE shared "which color family" fact, so the
 *  compact header cluster (AgentIndicator) and the Inspector's status card
 *  paint the same state the same way. `alert-linger` is post-turn `waiting`:
 *  needs-you violet at reduced strength (same distinction the dock StatePip
 *  draws), vs full-strength `alert` for a genuine `awaiting_user` block. */
export type AgentStateTone = "busy" | "alert" | "alert-linger";
export const stateTones: Record<AgentInfo["state"], AgentStateTone> = {
  thinking: "busy",
  tool_use: "busy",
  waiting: "alert-linger",
  awaiting_user: "alert",
  running_background: "busy",
};

/** Claude-Code's dynamic-workflow fan-out info, or null. Narrows the
 *  `AgentInfo` union: only the `claude-code` member carries `workflow`.
 *  Centralized here so the inspector and the canvas meta row read it the
 *  same way without re-deriving the kind check.
 *
 *  Also gates on `running_background`, the only state the field is meaningful
 *  in. This is the single read choke-point for the "`workflow` is non-null
 *  only while `running_background`" invariant — enforcing it here keeps a
 *  stale or mis-set field from ever rendering a badge in the wrong state,
 *  without nesting a second discriminant into the shared `AgentInfo` union. */
export function agentWorkflow(agent: AgentInfo | null | undefined) {
  return agent?.kind === "claude-code" && agent.state === "running_background"
    ? agent.workflow
    : null;
}

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
