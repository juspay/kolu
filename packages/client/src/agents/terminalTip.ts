/** The tip in the bar under a tile's title bar — which ONE thing to suggest
 *  for a terminal, given what that terminal is doing, and what its chips type.
 *  Pure: no Solid, no I/O; `TileTip.tsx` feeds it.
 *
 *  A tip is a readout of the terminal's state: it shows whenever its condition
 *  holds and goes when it no longer does. Nothing is remembered. Both rungs
 *  need agents on this terminal, and read the profile's harnesses off the
 *  listing:
 *    - the shell in front, in a repo → "launch an agent", one chip per harness
 *      of its profile (a chip types its name and presses Enter);
 *    - one of those harnesses in front (by its command name — known the moment
 *      it starts, before kolu has detected the agent) and no live turn yet → a
 *      plugin skill (the chip inserts its invocation, no Enter).
 *
 *  Otherwise `quiet`, with why: the state calls for no tip, or the tile is not
 *  the active one. Pending facts are not faults; broken invariants throw. */

import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  Foreground,
  GitFact,
} from "@kolu/terminal-vocab/schema";
import type { AgentDistroListing } from "kolu-common/surface";
import {
  skillInvocation,
  TILE_TIPS,
  type TileTipCopy,
  type TipId,
} from "../settings/tips";
import type { PluginSkill } from "./pluginSkills";

/** What a tip's chip does when clicked. */
export type TipAction =
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
  /** The detected agent, or `null` (none yet, or at the shell). */
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
}

export type Quiet = { readonly kind: "quiet"; readonly why: string };

export const quiet = (why: string): Quiet => ({ kind: "quiet", why });

/** Pick this terminal's tip: the one its state calls for, on the active tile. */
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
  const profileName = facts.agents.profile;
  const profile = listing.profiles.find((p) => p.name === profileName);
  if (profile === undefined)
    return quiet(`profile ${profileName} is not in the listing`);
  if (profile.harnesses.length === 0)
    throw new Error(
      `terminalTip: profile ${profileName} has no harness — the listing schema requires one`,
    );
  const harnesses = profile.harnesses.map((h) => h.name);

  const fg = facts.foreground;
  if (fg === null) return quiet("foreground not sampled yet");
  if (!fg.shell) {
    // A harness of this profile in front, by name: it is known as the process
    // starts, while the agent itself is detected only once it has a session.
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
  const copy = TILE_TIPS.launchAgent.copy(harnesses);
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
  };
}

/** The skill tip for `harness` in front: until its first live turn. */
function skillTip(facts: TerminalTipFacts, harness: string): TerminalTip {
  const agent = facts.agent;
  // Not detected yet is the usual case right after launch; once detected, it
  // must still be waiting for the first message.
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
      case "waiting":
        break;
      default:
        throw new Error(
          `terminalTip: unhandled agent bucket ${bucket satisfies never}`,
        );
    }
  }
  // `PLUGIN_SKILLS` throws at load when the plugin declares none.
  const skill = facts.skills[0];
  if (skill === undefined)
    throw new Error(
      "terminalTip: no plugin skill — PLUGIN_SKILLS guarantees one",
    );
  const copy = TILE_TIPS.skill.copy(harness, skill);
  const { text } = skillInvocation(harness, skill.name);
  return {
    kind: "tip",
    id: TILE_TIPS.skill.id(harness),
    copy,
    // Into the agent's input, cursor left after it: the user finishes the
    // message and sends it.
    chips: copy.chips.map((label) => ({
      label,
      action: { kind: "insert", text },
    })),
    source: { kind: "kolu-plugin" },
  };
}
