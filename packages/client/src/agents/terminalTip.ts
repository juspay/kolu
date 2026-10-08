/** The tile title bar's tip — which ONE thing to suggest for a terminal, given
 *  what that terminal is doing. Pure: no Solid, no I/O; `TileTip.tsx` feeds it.
 *
 *  Three rungs, each shown once (`seen` is the user's `seenTips`):
 *    1. the shell in front, outside any git repo → "cd into a git repo";
 *    2. the shell in front, in a repo, this terminal has agents → "launch
 *       <first harness>";
 *    3. an agent at its first prompt, this terminal has agents → a plugin skill,
 *       once per agent kind.
 *  Only the ACTIVE tile, with a title bar wide enough to show it, and only once
 *  the saved `seenTips` have arrived: a tip shown anywhere else would be marked
 *  seen without being seen. Everything else is `quiet`, with the reason —
 *  pending facts are not faults. */

import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  Foreground,
  GitFact,
} from "@kolu/terminal-vocab/schema";
import type { AgentDistroListing } from "kolu-common/surface";
import { TILE_TIPS, type TileTipPart, type TipId } from "../settings/tips";
import type { PluginSkill } from "./pluginSkills";

/** The narrowest title bar a tip shows in. Below it the tip is quiet — the
 *  title keeps the room — and, being quiet, is never marked seen. */
export const TIP_MIN_TITLE_BAR_PX = 640;

/** Where the tip would show, and whether the user's seen list is known. */
export interface TipPlace {
  /** The saved `seenTips` have arrived. Before that, "seen" cannot be answered
   *  (the list reads empty) and marking one would overwrite the real list. */
  readonly seenTipsLoaded: boolean;
  /** This terminal's tile is the active one. */
  readonly active: boolean;
  /** The title bar's measured width; `null` until it is measured. */
  readonly titleBarPx: number | null;
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

export type TerminalTip =
  | {
      readonly kind: "tip";
      readonly id: TipId;
      readonly parts: readonly TileTipPart[];
    }
  | { readonly kind: "quiet"; readonly why: string };

const quiet = (why: string): TerminalTip => ({ kind: "quiet", why });

/** Pick this terminal's tip. `seen` answers "has the user seen this tip?" (a
 *  `Set` of seen ids, or the reactive `hasSeen`). `showing` is the id the tile
 *  displays right now:
 *  it is marked seen the moment it shows, so it is exempt from the seen test —
 *  otherwise it would vanish the tick after it appeared. */
export function terminalTip(
  facts: TerminalTipFacts,
  seen: Pick<ReadonlySet<TipId>, "has">,
  showing: TipId | null,
): TerminalTip {
  const already = (id: TipId) => seen.has(id) && showing !== id;
  const tip = (id: TipId, parts: readonly TileTipPart[]): TerminalTip =>
    already(id) ? quiet(`${id} already seen`) : { kind: "tip", id, parts };

  const place = facts.place;
  if (!place.seenTipsLoaded) return quiet("preferences pending");
  if (!place.active) return quiet("not the active tile");
  if (place.titleBarPx === null) return quiet("title bar not measured yet");
  if (place.titleBarPx < TIP_MIN_TITLE_BAR_PX) return quiet("too narrow");

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
    return tip(
      TILE_TIPS.skill.id(agent.kind),
      TILE_TIPS.skill.parts(agent.kind, skill),
    );
  }

  // Rungs 1 and 2 talk about the shell, so the shell must be what is in front:
  // `ssh host` or `vim` outside a repo is not a moment to suggest `cd`.
  if (facts.foreground === null) return quiet("foreground not sampled yet");
  if (!facts.foreground.shell) return quiet("a command is running");

  switch (facts.git.kind) {
    case "unresolved":
      return quiet("git not resolved yet");
    case "none":
      return tip(TILE_TIPS.cdRepo.id, TILE_TIPS.cdRepo.parts());
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
  return tip(TILE_TIPS.launchAgent.id, TILE_TIPS.launchAgent.parts(first.name));
}
