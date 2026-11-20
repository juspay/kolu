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
