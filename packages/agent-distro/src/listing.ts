/**
 * The profiles kolu offers, as their bundles describe themselves. Each of the
 * floor's profile bundles carries two files (agent-distro's README, "Bundle
 * layout"): `share/agent-distro/profile.json` (its name and description,
 * `./profileFile`) and `share/agent-distro/versions` (its harnesses with titles
 * and versions, `./versions`). kolu reads those and never runs a picker for
 * information; it never re-describes a profile either.
 */

import { Schema } from "effect";
import type { AgentDistroManifest } from "./manifest.ts";
import { parseProfileFile, profileFile } from "./profileFile.ts";
import { AgentVersionSchema, parseVersions, versionsFile } from "./versions.ts";

/** One harness a profile ships: a line of its bundle's `versions`. */
export const AgentDistroHarnessSchema = AgentVersionSchema;

/** One profile: its name, the one-line description, its harnesses. */
export const AgentDistroProfileSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  harnesses: Schema.Array(AgentDistroHarnessSchema),
});

export type AgentDistroProfile = typeof AgentDistroProfileSchema.Type;

/** What kolu knows of a build's profiles: at least one, `profiles[0]` the
 *  default, or `unavailable` for a kolu built without agent-distro (explicit
 *  absence). */
export const AgentDistroListingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unavailable") }),
  Schema.Struct({
    kind: Schema.Literal("available"),
    profiles: Schema.Array(AgentDistroProfileSchema).check(
      Schema.isMinLength(1),
    ),
  }),
]);

export type AgentDistroListing = typeof AgentDistroListingSchema.Type;

/** The ONE composition of a profile's entry from its bundle's two files.
 *  `name` is the profile the caller expects at `bundle`; a `profile.json` that
 *  names another is a broken build and throws, as does either file missing or
 *  out of upstream's format. */
export function profileOfBundle(
  name: string,
  bundle: string,
  readText: (path: string) => string,
): AgentDistroProfile {
  const file = parseProfileFile(readText(profileFile(bundle)));
  if (file.name !== name)
    throw new Error(
      `agent-distro bundle ${bundle} describes profile '${file.name}', but the floor manifest names it '${name}'`,
    );
  return {
    name,
    description: file.description,
    harnesses: [...parseVersions(readText(versionsFile(bundle)))],
  };
}

/** Every floor profile, in the manifest's order (the default first, as the Nix
 *  half writes it), each read off its own bundle. */
export function floorListing(
  manifest: AgentDistroManifest,
  readText: (path: string) => string,
): AgentDistroListing {
  return {
    kind: "available",
    profiles: manifest.profiles.map((p) =>
      profileOfBundle(p.name, p.dir, readText),
    ),
  };
}
