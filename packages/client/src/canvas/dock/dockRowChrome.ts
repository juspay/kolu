import { activeArm, type AgentInfo } from "kolu-common/surface";
import { agentNames, stateLabels } from "../../ui/agentDisplay";
import type { DockEntry } from "../dockModel";

export function agentLabel(agent: AgentInfo | null | undefined): string {
  if (!agent) return "Plain shell";
  return `${agentNames[agent.kind]} · ${stateLabels[agent.state]}`;
}

export function metaLine(entry: DockEntry): string {
  const { meta } = entry.info;
  const arm = activeArm(meta);
  if (!arm) return meta.cwd; // sleeping: no live overlay
  if (arm.agent?.summary) return arm.agent.summary;
  if (arm.foreground?.title) return arm.foreground.title;
  if (arm.foreground?.name) return arm.foreground.name;
  return arm.cwd;
}

const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function tokenLine(agent: AgentInfo | null | undefined): string | null {
  if (!agent?.contextTokens) return null;
  return tokenFormat.format(agent.contextTokens);
}
