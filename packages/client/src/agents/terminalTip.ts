import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { agentChipProfile } from "@kolu/agent-distro/status";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  Foreground,
  GitFact,
} from "@kolu/terminal-vocab/schema";
import type { AgentDistroListing } from "kolu-common/surface";
import type { PluginSkill } from "./pluginSkills";

export type TipAction =
  | { readonly kind: "launch"; readonly harness: string }
  | { readonly kind: "insert"; readonly text: string };

export interface TipChip {
  readonly label: string;
  readonly action: TipAction;
}

export type TipSource =
  | {
      readonly kind: "agent-distro";
      readonly profile: string | undefined;
    }
  | { readonly kind: "kolu-plugin" };

export interface TerminalTipFacts {
  readonly active: boolean;
  readonly git: GitFact;
  readonly foreground: Foreground | null;
  readonly agent: Pick<AgentInfo, "kind" | "state"> | null;
  readonly promptedAt: number | null;
  readonly agents: TerminalAgents | undefined;
  readonly listing: AgentDistroListing | undefined;
  readonly skill: PluginSkill;
}

export type TerminalTip = Tip | Quiet;

export interface Tip {
  readonly kind: "tip";
  readonly id: string;
  readonly lead: string;
  readonly chips: readonly TipChip[];
  readonly rest: string;
  readonly source: TipSource;
}

export type Quiet = { readonly kind: "quiet"; readonly why: string };

export const quiet = (why: string): Quiet => ({ kind: "quiet", why });

export function tileTipSentence(tip: Tip): string {
  const said = `${tip.lead}: ${tip.chips.map((c) => c.label).join(", ")}`;
  return tip.rest === "" ? said : `${said} ${tip.rest}`;
}

export function skillInvocation(harness: string, name: string): string {
  switch (harness) {
    case "claude":
    case "omp":
    case "pi":
    case "codex":
    case "opencode":
      return `/${name}`;
    default:
      throw new Error(
        `skillInvocation: no invocation decided for harness ${harness}`,
      );
  }
}

export function terminalTip(facts: TerminalTipFacts): TerminalTip {
  const c = candidate(facts);
  if (c.kind === "quiet") return c;
  if (!facts.active) return quiet("not the active tile");
  return c;
}

function candidate(facts: TerminalTipFacts): TerminalTip {
  if (facts.agents === undefined) return quiet("no agents on this terminal");
  const listing = facts.listing;
  if (listing === undefined) return quiet("the agents listing is pending");
  if (listing.kind === "unavailable")
    return quiet("this kolu was built without agents");
  if (listing.harnesses.length === 0)
    throw new Error(
      "terminalTip: the agent-distro package has no harness — the listing schema requires one",
    );
  const harnesses = listing.harnesses.map((h) => h.name);

  const fg = facts.foreground;
  if (fg === null) return quiet("foreground not sampled yet");
  if (!fg.shell) {
    if (!harnesses.includes(fg.name)) return quiet(`${fg.name} is running`);
    return skillTip(facts, fg.name);
  }

  switch (facts.git.kind) {
    case "unresolved":
      return quiet("git not resolved yet");
    case "none":
      return quiet("not in a git repo");
    case "repo":
      break;
    default:
      throw new Error(
        `terminalTip: unhandled git fact ${facts.git satisfies never}`,
      );
  }
  return {
    kind: "tip",
    id: "tip-launch-agent",
    lead: "Launch an agent",
    chips: harnesses.map((harness) => ({
      label: harness,
      action: { kind: "launch", harness },
    })),
    rest: "",
    source: { kind: "agent-distro", profile: agentChipProfile(facts.agents) },
  };
}

function skillTip(facts: TerminalTipFacts, harness: string): TerminalTip {
  const agent = facts.agent;
  if (agent !== null) {
    if (facts.promptedAt !== null) return quiet("the first prompt went out");
    const bucket = agentBucket(agent.state);
    switch (bucket) {
      case "working":
        return quiet(`${harness} is working`);
      case "awaiting":
        return quiet(`${harness} is asking you something`);
      case "other":
        return quiet(`${harness} is in an unknown state`);
      case "starting":
        return quiet(`${harness} is still starting`);
      case "fresh":
      case "waiting":
        break;
      default:
        throw new Error(
          `terminalTip: unhandled agent bucket ${bucket satisfies never}`,
        );
    }
  }
  const label = skillInvocation(harness, facts.skill.name);
  return {
    kind: "tip",
    id: `tip-skill:${harness}`,
    lead: "Try a skill",
    chips: [{ label, action: { kind: "insert", text: `${label} ` } }],
    rest: `— ${facts.skill.blurb}`,
    source: { kind: "kolu-plugin" },
  };
}
