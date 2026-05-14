/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel). */

import { agentKindFromCommand } from "anyagent/cli";
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

/** True when the agent state means "user action needed now" — collapses
 *  `waiting` (turn ended cleanly, no more compute happening) and
 *  `awaiting_user` (agent blocked on a question) into one predicate so
 *  the alert layer and the switcher bucket agree on the equivalence
 *  class. Add a new state here when it joins the attention class;
 *  miss this and one consumer fires while the other ignores it.
 *
 *  Accepts `string | undefined` because callers reading from reactive
 *  history (`createEffect`'s previous-value tracking) lose the literal
 *  type — equality comparisons inside still narrow correctly. */
export function isAttentionState(state: string | undefined): boolean {
  return state === "waiting" || state === "awaiting_user";
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
