/**
 * The harnesses kolu offers, as the package describes them: agent-distro's
 * `share/agent-distro/versions` (one `name\ttitle\tversion` line per harness),
 * read with upstream's own parser (`@juspay/agent-distro/update/versions`).
 * kolu never runs the picker for information, and never re-describes a
 * harness. A profile is not part of the package, so the listing names none.
 */

import { parseVersions } from "@juspay/agent-distro/update/versions";
import { Schema } from "effect";
import { versionsFile } from "./bundle.ts";
import type { AgentDistroManifest } from "./manifest.ts";

/** One harness a package carries — upstream's `Version`, as a wire schema. */
export const AgentVersionSchema = Schema.Struct({
  /** The command name (`claude`). */
  name: Schema.String,
  /** How people know it (`Claude Code`). */
  title: Schema.String,
  version: Schema.String,
});

export type AgentVersion = typeof AgentVersionSchema.Type;

/** What kolu knows of its build's package: its harnesses, at least one
 *  (upstream's own listing parser refuses an empty menu too), or
 *  `unavailable` for a kolu built without agent-distro (explicit absence). */
export const AgentDistroListingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unavailable") }),
  Schema.Struct({
    kind: Schema.Literal("available"),
    harnesses: Schema.Array(AgentVersionSchema).check(Schema.isMinLength(1)),
  }),
]);

export type AgentDistroListing = typeof AgentDistroListingSchema.Type;

const decodeListing = Schema.decodeUnknownSync(AgentDistroListingSchema);

/** The floor's harnesses, read off its package's versions file. Throws on a
 *  file that is missing, out of upstream's format, or names no harness. */
export function floorListing(
  manifest: AgentDistroManifest,
  readText: (path: string) => string,
): AgentDistroListing {
  return decodeListing({
    kind: "available",
    harnesses: parseVersions(readText(versionsFile(manifest.dir))),
  });
}
