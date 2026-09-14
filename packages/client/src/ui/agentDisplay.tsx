/** Shared display strings for agent kinds and states.
 *  Used by both AgentIndicator (compact header) and MetadataInspector (detail panel).
 *
 *  Per-agent facts (display name, brand mark) are read from the agent registry
 *  (`kolu-agents/vocab`) rather than hand-maintained `Record<AgentKind, …>`
 *  tables — adding an agent touches only its own package plus the registry. */

import {
  type AgentMark,
  agentKindFromCommand,
  agentVocab,
  mapAgentVocabs,
} from "kolu-agents/vocab";
import type { AgentInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import { MarkIcon } from "./Icons";

/** The agent's human display name (`"Claude Code"`, `"OpenCode"`). */
export function agentName(kind: AgentInfo["kind"]): string {
  return agentVocab(kind).displayName;
}

/** The agent's brand mark (viewBox + paths), for a caller that renders
 *  `<MarkIcon mark={…}/>` directly. The ONE mark per agent serves both the tile
 *  chrome and the dock pip. */
export function agentMark(kind: AgentInfo["kind"]): AgentMark {
  return agentVocab(kind).mark;
}

/** Stable per-kind icon components for the command palette, which carries an
 *  `icon: Component`. Built ONCE — a fresh component per call would make
 *  `<Dynamic>` tear down and recreate the SVG on every re-render. */
const AGENT_ICONS: Record<
  AgentInfo["kind"],
  Component<{ class?: string }>
> = mapAgentVocabs(
  (vocab): Component<{ class?: string }> =>
    (props) => <MarkIcon mark={vocab.mark} class={props.class} />,
);

// The per-state display WORDS live with the dock row (`@kolu/solid-dockrow`),
// not here. They were duplicated for a moment when the row was extracted, which
// is exactly the fork this table exists to prevent: two `Record<AgentState,
// string>` with byte-identical values and no compiler edge between them, so a
// reworded state would have moved in one and stayed in the other. The row owns
// them because the row also owns the closed-set NARROWING built on the same
// record (`isRowAgentState` is `Object.hasOwn(stateLabels, …)`, and
// `narrowAgentState` reads the label straight off it) — splitting the table
// from its own fence is what would make a sixth state legible in one place and
// not the other. Re-exported here so this module stays the one door the
// AgentIndicator and the Inspector already knock on.
export { stateLabels } from "@kolu/solid-dockrow/rowValues";

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
 *  `AgentInfo` discriminator (aider/goose/gemini/cursor-agent) and for
 *  unknown commands. Bridges the basename axis to the per-kind marks; the
 *  component is a STABLE per-kind reference (see `AGENT_ICONS`). */
export function iconForCommand(
  command: string,
): Component<{ class?: string }> | undefined {
  const kind = agentKindFromCommand(command);
  return kind === null ? undefined : AGENT_ICONS[kind];
}
