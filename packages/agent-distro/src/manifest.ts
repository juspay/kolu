/**
 * The FLOOR manifest — how kolu's local bundle of every profile describes
 * itself, written by this package's Nix half (`default.nix`) from the very
 * values that build the directories, at `share/kolu/agent-distro.json` inside
 * the bundle:
 *
 *     { default, profiles: [{ name, dir, bin, hash }] }
 *
 * Each profile's directory is agent-distro's bundle as is: its harness
 * commands and its own picker in `bin/`, and the two files that describe it
 * (`./listing`). Readers (padi resolving a profile's directory, kolu-server
 * reading each profile's bundle) go through this file and never through a
 * directory layout of their own. The
 * default profile is typed once, in `../defaults.json`, which the Nix half
 * reads as well.
 */

import { Schema } from "effect";
import defaults from "../defaults.json" with { type: "json" };

/** The bundle kolu lists first (`defaults.json`) — the one kolu's default
 *  Agents profile, a reference, rides. */
export const DEFAULT_AGENT_PROFILE: string = defaults.defaultProfile;

export const AgentDistroManifestSchema = Schema.Struct({
  /** The default profile, as the build that wrote this manifest knew it. */
  default: Schema.String,
  profiles: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      /** The profile's directory — what a terminal pins (its chip's bundle). */
      dir: Schema.String,
      /** `dir`'s `bin/` — what goes on a terminal's PATH, the profile's own
       *  picker (`agent-distro`) among its commands. */
      bin: Schema.String,
      /** `dir`'s store hash. */
      hash: Schema.String,
    }),
  ).check(Schema.isMinLength(1)),
});

export type AgentDistroManifest = typeof AgentDistroManifestSchema.Type;

/** Where the manifest sits inside a floor bundle. */
export function manifestFile(bundle: string): string {
  return `${bundle}/share/kolu/agent-distro.json`;
}

const decodeManifest = Schema.decodeUnknownSync(AgentDistroManifestSchema);

/** Parse a manifest's text. Throws on anything else — a floor without a valid
 *  manifest is a broken build. */
export function parseAgentDistroManifest(text: string): AgentDistroManifest {
  return decodeManifest(JSON.parse(text));
}

/** `name`'s entry, or `undefined` when the floor does not carry it. */
export function manifestProfile(
  manifest: AgentDistroManifest,
  name: string,
): AgentDistroManifest["profiles"][number] | undefined {
  return manifest.profiles.find((p) => p.name === name);
}
