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
