/** The tip in the bar under a tile's title bar — which ONE thing to suggest
 *  for a terminal, given what that terminal is doing, and what its chips type.
 *  Pure: no Solid, no I/O; `TileTip.tsx` feeds it.
 *
 *  A tip is a readout of the terminal's state: it shows whenever its condition
 *  holds and goes when it no longer does. Nothing is remembered. Three rungs:
 *    1. the shell in front, outside any git repo → "cd into a git repo" (the
 *       chip opens the recent repos; picking one types the `cd`);
 *    2. the shell in front, in a repo, this terminal has agents → "launch an
 *       agent", one chip per harness of its profile (a chip types its name and
 *       presses Enter);
 *    3. an agent at its first prompt, this terminal has agents → a plugin skill
 *       (the chip inserts its invocation into the agent's input, no Enter).
 *
 *  Otherwise `quiet`, with why: the state calls for no tip, the tile is not the
 *  active one, or (rungs 1–2) a command is in front of the shell. Pending facts
 *  are not faults; broken invariants throw. */

import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  Foreground,
  GitFact,
} from "@kolu/terminal-vocab/schema";
import type { AgentDistroListing } from "kolu-common/surface";
import { TILE_TIPS, type TileTipCopy, type TipId } from "../settings/tips";
import type { PluginSkill } from "./pluginSkills";

/** What a tip's chip does when clicked. */
export type TipAction =
  /** Open the palette's recent repos; picking one types `cd <repo>` + Enter. */
  | { readonly kind: "pick-repo" }
  /** Type the harness's name and press Enter. */
  | { readonly kind: "launch"; readonly harness: string }
  /** Type `text` into the agent's input, no Enter. */
  | { readonly kind: "insert"; readonly text: string };

/** One click target: the words on it, and what clicking does. */
export interface TipChip {
  readonly label: string;
  readonly action: TipAction;
}

/** Where the suggestion comes from, shown at the bar's right end. */
export type TipSource =
  | { readonly kind: "none" }
  | { readonly kind: "agent-distro"; readonly profile: string }
  | { readonly kind: "kolu-plugin" };

/** What the fold reads off one terminal and the app. */
export interface TerminalTipFacts {
  /** This terminal's tile is the active one. */
  readonly active: boolean;
  /** The terminal's git context. */
  readonly git: GitFact;
  /** What is in front of the shell, or `null` before the first sample. */
  readonly foreground: Foreground | null;
  /** The live agent, or `null` at the shell. */
  readonly agent: Pick<AgentInfo, "kind" | "state"> | null;
  /** When the current agent first went live (`AgentMemory.promptedAt`). */
  readonly promptedAt: number | null;
  /** The agents padi put on this terminal's PATH — absent when none. */
  readonly agents: TerminalAgents | undefined;
  /** The profile listing; `undefined` until its first frame. */
  readonly listing: AgentDistroListing | undefined;
  /** The skills kolu's plugin declares. */
  readonly skills: readonly PluginSkill[];
}

/** `id` names the rung (for `data-tip-id` and tests); nothing is stored
 *  under it. */
export type TerminalTip = Tip | Quiet;

export interface Tip {
  readonly kind: "tip";
  readonly id: TipId;
  readonly copy: TileTipCopy;
  /** One per `copy.chips`, in the same order. */
  readonly chips: readonly TipChip[];
  readonly source: TipSource;
  /** It talks about the shell (rungs 1–2), so it needs the shell in front. */
  readonly atShell: boolean;
}

export type Quiet = { readonly kind: "quiet"; readonly why: string };

export const quiet = (why: string): Quiet => ({ kind: "quiet", why });

/** Pick this terminal's tip: the one its state calls for, if it applies now. */
export function terminalTip(facts: TerminalTipFacts): TerminalTip {
  const c = candidate(facts);
  if (c.kind === "quiet") return c;
  if (!facts.active) return quiet("not the active tile");
  if (c.atShell) {
    // Rungs 1 and 2 talk about the shell, so the shell must be what is in
    // front: `ssh host` or `vim` outside a repo is not a moment to suggest `cd`.
    if (facts.foreground === null) return quiet("foreground not sampled yet");
    if (!facts.foreground.shell) return quiet("a command is running");
  }
  return c;
}

function candidate(facts: TerminalTipFacts): TerminalTip {
  const agent = facts.agent;
  if (agent !== null) {
    if (facts.promptedAt !== null) return quiet("the first prompt went out");
    const bucket = agentBucket(agent.state);
    switch (bucket) {
      case "working":
        return quiet(`${agent.kind} is working`);
      case "awaiting":
        return quiet(`${agent.kind} is asking you something`);
      case "other":
        return quiet(`${agent.kind} is in an unknown state`);
      case "waiting":
        break;
      default:
        throw new Error(
          `terminalTip: unhandled agent bucket ${bucket satisfies never}`,
        );
    }
    if (facts.agents === undefined) return quiet("no agents on this terminal");
    // `PLUGIN_SKILLS` throws at load when the plugin declares none.
    const skill = facts.skills[0];
    if (skill === undefined)
      throw new Error(
        "terminalTip: no plugin skill — PLUGIN_SKILLS guarantees one",
      );
    const copy = TILE_TIPS.skill.copy(agent.kind, skill);
    return {
      kind: "tip",
      id: TILE_TIPS.skill.id(agent.kind),
      copy,
      // Into the agent's input, cursor left after it: the user finishes the
      // message and sends it.
      chips: copy.chips.map((label) => ({
        label,
        action: { kind: "insert", text: `${label} ` },
      })),
      source: { kind: "kolu-plugin" },
      atShell: false,
    };
  }

  switch (facts.git.kind) {
    case "unresolved":
      return quiet("git not resolved yet");
    case "none": {
      const copy = TILE_TIPS.cdRepo.copy();
      return {
        kind: "tip",
        id: TILE_TIPS.cdRepo.id,
        copy,
        chips: copy.chips.map((label) => ({
          label,
          action: { kind: "pick-repo" },
        })),
        source: { kind: "none" },
        atShell: true,
      };
    }
    case "repo":
      break;
    default:
      throw new Error(
        `terminalTip: unhandled git fact ${facts.git satisfies never}`,
      );
  }
  if (facts.agents === undefined) return quiet("no agents on this terminal");
  const listing = facts.listing;
  if (listing === undefined) return quiet("the agents listing is pending");
  if (listing.kind === "unavailable")
    return quiet("this kolu was built without agents");
  const profileName = facts.agents.profile;
  const profile = listing.profiles.find((p) => p.name === profileName);
  if (profile === undefined)
    return quiet(`profile ${profileName} is not in the listing`);
  if (profile.harnesses.length === 0)
    throw new Error(
      `terminalTip: profile ${profileName} has no harness — the listing schema requires one`,
    );
  const copy = TILE_TIPS.launchAgent.copy(profile.harnesses.map((h) => h.name));
  return {
    kind: "tip",
    id: TILE_TIPS.launchAgent.id,
    copy,
    // Launching is the suggestion, so each chip runs its harness.
    chips: copy.chips.map((harness) => ({
      label: harness,
      action: { kind: "launch", harness },
    })),
    source: { kind: "agent-distro", profile: profileName },
    atShell: true,
  };
}
