/** The tile title bar's tip — which ONE thing to suggest for a terminal, given
 *  what that terminal is doing. Pure: no Solid, no I/O; `TileTip.tsx` feeds it.
 *
 *  A tip is a readout of the terminal's state: it shows whenever its condition
 *  holds and goes when it no longer does. Nothing is remembered. Three rungs:
 *    1. the shell in front, outside any git repo → "cd into a git repo";
 *    2. the shell in front, in a repo, this terminal has agents → "launch
 *       <first harness>";
 *    3. an agent at its first prompt, this terminal has agents → a plugin skill.
 *
 *  Otherwise `quiet`, with why: the state calls for no tip, or nobody could see
 *  one here (not the active tile, off-screen, a slot too narrow to read, a
 *  command in front of the shell). Pending facts are not faults; broken
 *  invariants throw. */

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

/** The narrowest tip slot (on-screen px) a tip shows in — below it the pill
 *  would be a few letters. */
export const TIP_MIN_SLOT_PX = 140;

/** Where the tip would show. */
export interface TipPlace {
  /** This terminal's tile is the active one. */
  readonly active: boolean;
  /** The tile is within the canvas viewport. */
  readonly onScreen: boolean;
  /** The room the title and actions leave for the tip, in on-screen px (layout
   *  width × canvas zoom); `null` until it is measured. */
  readonly slotPx: number | null;
}

/** What the fold reads off one terminal and the app. */
export interface TerminalTipFacts {
  readonly place: TipPlace;
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
export type TerminalTip =
  | { readonly kind: "tip"; readonly id: TipId; readonly copy: TileTipCopy }
  | Quiet;

export type Quiet = { readonly kind: "quiet"; readonly why: string };

export const quiet = (why: string): Quiet => ({ kind: "quiet", why });

/** The tip the terminal's state calls for, before asking whether it can be seen.
 *  `shellInFront`: the tip talks about the shell (rungs 1–2), so it needs the
 *  shell to be what is in front. */
type Candidate =
  | {
      readonly kind: "tip";
      readonly id: TipId;
      readonly copy: TileTipCopy;
      readonly shellInFront: boolean;
    }
  | Quiet;

/** Pick this terminal's tip: the one its state calls for, if it can be seen. */
export function terminalTip(facts: TerminalTipFacts): TerminalTip {
  const c = candidate(facts);
  if (c.kind === "quiet") return c;
  const why = unseeableBecause(facts, c.shellInFront);
  if (why !== null) return quiet(why);
  return { kind: "tip", id: c.id, copy: c.copy };
}

/** Why nobody could see a tip on this tile right now, or `null` if they could. */
function unseeableBecause(
  facts: TerminalTipFacts,
  shellInFront: boolean,
): string | null {
  const place = facts.place;
  if (!place.active) return "not the active tile";
  if (!place.onScreen) return "off-screen";
  if (place.slotPx === null) return "tip slot not measured yet";
  if (place.slotPx < TIP_MIN_SLOT_PX) return "too narrow";
  // Rungs 1 and 2 talk about the shell, so the shell must be what is in front:
  // `ssh host` or `vim` outside a repo is not a moment to suggest `cd`.
  if (shellInFront) {
    if (facts.foreground === null) return "foreground not sampled yet";
    if (!facts.foreground.shell) return "a command is running";
  }
  return null;
}

function candidate(facts: TerminalTipFacts): Candidate {
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
    return {
      kind: "tip",
      id: TILE_TIPS.skill.id(agent.kind),
      copy: TILE_TIPS.skill.copy(agent.kind, skill),
      shellInFront: false,
    };
  }

  switch (facts.git.kind) {
    case "unresolved":
      return quiet("git not resolved yet");
    case "none":
      return {
        kind: "tip",
        id: TILE_TIPS.cdRepo.id,
        copy: TILE_TIPS.cdRepo.copy(),
        shellInFront: true,
      };
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
  const first = profile.harnesses[0];
  if (first === undefined)
    throw new Error(
      `terminalTip: profile ${profileName} has no harness — the listing schema requires one`,
    );
  return {
    kind: "tip",
    id: TILE_TIPS.launchAgent.id,
    copy: TILE_TIPS.launchAgent.copy(first.name),
    shellInFront: true,
  };
}
