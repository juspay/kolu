/**
 * The agent-distro profiles Settings offers — read ONCE at boot from the picker
 * this kolu's build baked (named by the floor's manifest, `@kolu/agent-distro`'s
 * Nix half), through agent-distro's own machine listing (`--list --json`). kolu never imports agent-distro's code or re-describes its
 * profiles: the names, descriptions and versions are whatever the pinned build
 * prints.
 *
 * Unbaked (a from-source `just dev` / test kolu) is `unavailable` — explicit
 * absence, the same stance as the agent-tools bake. A baked picker that fails or
 * prints something else is a broken build, and throws at boot.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type AgentDistroListing,
  LIST_JSON_ARGS,
  parseAgentDistroList,
} from "@kolu/agent-distro/listing";
import {
  manifestFile,
  parseAgentDistroManifest,
} from "@kolu/agent-distro/manifest";
import { plainProfileDescription } from "@kolu/agent-distro/status";
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";

/** Read the listing off the baked picker the floor's manifest names, and
 *  check it leads with the manifest's default profile (`env` / `run` /
 *  `readText` injectable for tests). */
export function readAgentDistroListing(
  env: Record<string, string | undefined> = process.env,
  run: (bin: string, args: string[]) => string = (bin, args) =>
    execFileSync(bin, args, { encoding: "utf8" }),
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentDistroListing {
  const bundle = env[AGENT_DISTRO_BUNDLE_ENV];
  if (bundle === undefined || bundle === "") return { kind: "unavailable" };
  const manifest = parseAgentDistroManifest(readText(manifestFile(bundle)));
  return assertDefaultAgentProfile(
    parseAgentDistroList(run(manifest.picker, [...LIST_JSON_ARGS])),
    manifest.default,
  );
}
/** Refuse a listing with a profile kolu has no plain words for. Settings
 *  describes each profile to people who have never heard of agent-distro
 *  (`PROFILE_PLAIN`); a pin bump that adds a profile must say what it is, so
 *  kolu stops at boot rather than showing upstream jargon or nothing. */
export function assertPlainProfiles(
  listing: AgentDistroListing,
): AgentDistroListing {
  if (listing.kind === "available")
    for (const profile of listing.profiles) plainProfileDescription(profile);
  return listing;
}

/** The default profile is typed once (`@kolu/agent-distro`'s `defaults.json`,
 *  read by the Nix half into the manifest and by `DEFAULT_PREFERENCES`), but the
 *  picker's LISTING ORDER is agent-distro's — so a build whose picker does not
 *  lead with that default would hand a fresh install a profile the listing does
 *  not lead with (or does not have). It fails at boot. */
export function assertDefaultAgentProfile(
  listing: AgentDistroListing,
  defaultProfile: string,
): AgentDistroListing {
  if (
    listing.kind === "available" &&
    listing.profiles[0]?.name !== defaultProfile
  )
    throw new Error(
      `agent-distro listing leads with '${listing.profiles[0]?.name}', but kolu's default Agents profile is '${defaultProfile}' — the floor's picker and packages/agent-distro/defaults.json disagree`,
    );
  return listing;
}
