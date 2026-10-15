/**
 * The harnesses Settings shows — read ONCE at boot off the floor this kolu's
 * build baked: agent-distro's package, as its manifest names it
 * (`@kolu/agent-distro`'s Nix half), lists its harnesses in its own
 * `versions`, and `@kolu/agent-distro/listing` reads them with upstream's
 * parser. Nothing is spawned: the picker in the package is a command for
 * people, not a source of facts. kolu never re-describes a harness: the names
 * and versions are whatever the pinned package says.
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
import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";

/** THE boot read: the listing off the floor's package. kolu-server's boot and
 *  the Nix floor proof both call exactly this, so a new check lands in both
 *  (`env` / `readText` injectable for tests). */
export function readAgentDistroListing(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentDistroListing {
  const bundle = env[AGENT_DISTRO_BUNDLE_ENV];
  if (bundle === undefined || bundle === "") return { kind: "unavailable" };
  return floorListing(
    parseAgentDistroManifest(readText(manifestFile(bundle))),
    readText,
  );
}
