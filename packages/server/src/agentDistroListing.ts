/**
 * The agent-distro profiles Settings offers — read ONCE at boot from the picker
 * this kolu's build baked (`$KOLU_AGENT_DISTRO_BUNDLE/bin/agent-distro`, built by
 * `nix/agent-distro.nix`), through agent-distro's own machine listing
 * (`--list --json`). kolu never imports agent-distro's code or re-describes its
 * profiles: the names, descriptions and versions are whatever the pinned build
 * prints.
 *
 * Unbaked (a from-source `just dev` / test kolu) is `unavailable` — explicit
 * absence, the same stance as the agent-tools bake. A baked picker that fails or
 * prints something else is a broken build, and throws at boot.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { Schema } from "effect";
import {
  type AgentDistroListing,
  AgentDistroListOutputSchema,
} from "kolu-common/surface";

const decodeListOutput = Schema.decodeUnknownSync(AgentDistroListOutputSchema);

/** Parse the picker's `--list --json` stdout. Throws on anything else. */
export function parseAgentDistroList(stdout: string): AgentDistroListing {
  return {
    kind: "available",
    profiles: decodeListOutput(JSON.parse(stdout)).profiles,
  };
}

/** Read the listing off the baked picker (`env` / `run` injectable for tests). */
export function readAgentDistroListing(
  env: Record<string, string | undefined> = process.env,
  run: (bin: string, args: string[]) => string = (bin, args) =>
    execFileSync(bin, args, { encoding: "utf8" }),
): AgentDistroListing {
  const bundle = env[AGENT_DISTRO_BUNDLE_ENV];
  if (bundle === undefined || bundle === "") return { kind: "unavailable" };
  return parseAgentDistroList(
    run(join(bundle, "bin", "agent-distro"), ["--list", "--json"]),
  );
}

/** kolu's default profile (`DEFAULT_PREFERENCES.agentDistro.profile`) and the
 *  default this build's listing names first (`nix/agent-distro.nix`'s
 *  `defaultProfile`) are two spellings of one decision on two clocks — a
 *  preference default edit, an agent-distro pin bump. A build where they
 *  disagree would hand a fresh install a profile the listing does not lead with
 *  (or does not have), so it fails at boot. */
export function assertDefaultAgentProfile(
  listing: AgentDistroListing,
  defaultProfile: string,
): AgentDistroListing {
  if (
    listing.kind === "available" &&
    listing.profiles[0]?.name !== defaultProfile
  )
    throw new Error(
      `agent-distro listing leads with '${listing.profiles[0]?.name}', but kolu's default Agents profile is '${defaultProfile}' — nix/agent-distro.nix and DEFAULT_PREFERENCES disagree`,
    );
  return listing;
}
