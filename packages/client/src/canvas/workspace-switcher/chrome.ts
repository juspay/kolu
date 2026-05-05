import type { AgentInfo } from "kolu-common/surface";
import { match, P } from "ts-pattern";
import { agentNames, stateLabels } from "../../ui/agentDisplay";
import type { WorkspaceSwitcherEntry } from "./model";

export function agentBorderClass(
  state: AgentInfo["state"] | undefined,
): string {
  return match(state)
    .with(P.union("thinking", "tool_use"), () => "pill-border pill-border-spin")
    .with("waiting", () => "pill-border pill-border-waiting")
    .with(undefined, () => "")
    .exhaustive();
}

export function agentLabel(agent: AgentInfo | null | undefined): string {
  if (!agent) return "Plain shell";
  return `${agentNames[agent.kind]} · ${stateLabels[agent.state]}`;
}

export function metaLine(entry: WorkspaceSwitcherEntry): string {
  const { meta } = entry.info;
  if (meta.agent?.summary) return meta.agent.summary;
  if (meta.foreground?.title) return meta.foreground.title;
  if (meta.foreground?.name) return meta.foreground.name;
  return meta.cwd;
}

export function prLine(entry: WorkspaceSwitcherEntry): string | null {
  const pr = entry.info.meta.pr;
  if (pr.kind !== "ok") return null;
  const checks = pr.value.checks ? ` · ${pr.value.checks}` : "";
  return `#${pr.value.number} ${pr.value.title}${checks}`;
}

const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function tokenLine(agent: AgentInfo | null | undefined): string | null {
  if (!agent?.contextTokens) return null;
  return tokenFormat.format(agent.contextTokens);
}
