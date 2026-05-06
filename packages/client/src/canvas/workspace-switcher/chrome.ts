import type { AgentInfo } from "kolu-common/surface";
import { agentNames, stateLabels } from "../../ui/agentDisplay";
import type { WorkspaceSwitcherEntry } from "./model";

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

/** Structured PR summary for renderers that style number, title, checks
 *  separately (eyebrow vs. headline). Returns null when the PR is not
 *  resolved (`absent`/`pending`/`unavailable`). */
export type PrSummary = {
  number: number;
  title: string;
  checks: string | null;
};

export function prSummary(entry: WorkspaceSwitcherEntry): PrSummary | null {
  const pr = entry.info.meta.pr;
  if (pr.kind !== "ok") return null;
  return {
    number: pr.value.number,
    title: pr.value.title,
    checks: pr.value.checks ?? null,
  };
}

const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function tokenLine(agent: AgentInfo | null | undefined): string | null {
  if (!agent?.contextTokens) return null;
  return tokenFormat.format(agent.contextTokens);
}
