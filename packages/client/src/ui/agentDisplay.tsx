import {
  type AgentMark,
  agentVocab,
  isAgentKind,
  mapAgentVocabs,
} from "kolu-agents/vocab";
import type { AgentInfo, TaskProgress } from "kolu-common/surface";
import type { Component } from "solid-js";
import { MarkIcon } from "./Icons";

/** The agent's human display name (`"Claude Code"`, `"OpenCode"`). */
export function agentName(kind: AgentInfo["kind"]): string {
  return agentVocab(kind).displayName;
}

/** The agent's brand mark (viewBox + paths). */
export function agentMark(kind: AgentInfo["kind"]): AgentMark {
  return agentVocab(kind).mark;
}

/** Stable per-kind icon components for the command palette: a fresh component
 *  per call would make `<Dynamic>` recreate the SVG on every re-render. */
const AGENT_ICONS: Record<
  AgentInfo["kind"],
  Component<{ class?: string }>
> = mapAgentVocabs(
  (vocab): Component<{ class?: string }> =>
    (props) => <MarkIcon mark={vocab.mark} class={props.class} />,
);

export { stateLabels } from "@kolu/solid-dockrow/rowValues";

/** Context-token count in compact notation: "47392" → "47K", "1183456" → "1.2M". */
const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const formatContextTokens = (tokens: number): string =>
  tokenFormat.format(tokens);

/** An agent's task progress as the fraction every surface prints — `"7/12"`. */
export const formatTaskProgress = (progress: TaskProgress): string =>
  `${progress.completed}/${progress.total}`;

/** The same fraction as the sentence a tooltip says. */
export const taskProgressTitle = (progress: TaskProgress): string =>
  `${formatTaskProgress(progress)} tasks completed`;

/** Semantic bucket per state — the shared "which color family" fact.
 *  `alert-linger` is post-turn `waiting` (needs-you violet at reduced
 *  strength); `quiet` is the muted family for an agent that is merely
 *  present. */
export type AgentStateTone = "busy" | "alert" | "alert-linger" | "quiet";
export const stateTones: Record<AgentInfo["state"], AgentStateTone> = {
  thinking: "busy",
  tool_use: "busy",
  waiting: "alert-linger",
  awaiting_user: "alert",
  running_background: "busy",
  starting: "quiet",
  fresh: "quiet",
  prompted: "busy",
};

/** Claude-Code's dynamic-workflow fan-out info, or null. Narrows the
 *  `AgentInfo` union and gates on `running_background`, the only state the
 *  field is meaningful in. */
export function agentWorkflow(agent: AgentInfo | null | undefined) {
  return agent?.kind === "claude-code" && agent.state === "running_background"
    ? agent.workflow
    : null;
}

/** Resolve the icon for an agent KIND. `undefined` for a kind this build no
 *  longer knows. */
export function iconForKind(
  kind: string,
): Component<{ class?: string }> | undefined {
  return isAgentKind(kind) ? AGENT_ICONS[kind] : undefined;
}
