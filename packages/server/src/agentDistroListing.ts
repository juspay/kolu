/**
 * The agent-distro profiles Settings offers — read ONCE at boot off the floor
 * this kolu's build baked: each profile's bundle, as its manifest names it
 * (`@kolu/agent-distro`'s Nix half), describes itself in two files, and
 * `@kolu/agent-distro/listing` composes them. Nothing is spawned: the picker in
 * each bundle is a command for people, not a source of facts. kolu never
 * imports agent-distro's code or re-describes its profiles: the names,
 * descriptions and versions are whatever the pinned bundles say.
 *
 * Unbaked (a from-source `just dev` / test kolu) is `unavailable` — explicit
 * absence, the same stance as the agent-tools bake. A baked floor whose files
 * are missing or out of format is a broken build, and throws at boot.
 */

import { readFileSync } from "node:fs";
import {
  type AgentDistroListing,
  floorListing,
} from "@kolu/agent-distro/listing";
import {
  manifestFile,
  parseAgentDistroManifest,
} from "@kolu/agent-distro/manifest";
import { plainProfileDescription } from "@kolu/agent-distro/status";
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";

/** THE boot read: the listing off the floor's bundles, in its manifest's
 *  order, with every boot check applied — it leads with the manifest's default
 *  profile, and kolu has plain words for each profile. kolu-server's boot and
 *  the Nix floor proof both call exactly this, so a new check lands in both
 *  (`env` / `readText` injectable for tests). */
export function readAgentDistroListing(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentDistroListing {
  const bundle = env[AGENT_DISTRO_BUNDLE_ENV];
  if (bundle === undefined || bundle === "") return { kind: "unavailable" };
  const manifest = parseAgentDistroManifest(readText(manifestFile(bundle)));
  return assertPlainProfiles(
    assertDefaultAgentProfile(
      floorListing(manifest, readText),
      manifest.default,
    ),
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
 *  read by the Nix half into the manifest and by `DEFAULT_PREFERENCES`), and the
 *  listing's order is the manifest's — so a manifest that does not lead with
 *  that default would hand a fresh install a profile the listing does not lead
 *  with (or does not have). It fails at boot. */
export function assertDefaultAgentProfile(
  listing: AgentDistroListing,
  defaultProfile: string,
): AgentDistroListing {
  if (
    listing.kind === "available" &&
    listing.profiles[0]?.name !== defaultProfile
  )
    throw new Error(
      `agent-distro listing leads with '${listing.profiles[0]?.name}', but kolu's default Agents profile is '${defaultProfile}' — the floor manifest's order and packages/agent-distro/defaults.json disagree`,
    );
  return listing;
}
