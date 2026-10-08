/**
 * agent-distro's machine listing — what `agent-distro --list --json` prints
 * (agent-distro's U1): every profile the pinned build ships, `profiles[0]` the
 * default, each with its description and harnesses. kolu reads it to offer the
 * profiles in Settings; it never re-describes them.
 */

import { Schema } from "effect";

/** One harness a profile ships. */
export const AgentDistroHarnessSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  tagline: Schema.String,
  version: Schema.String,
});

/** One profile: its name, the one-line description, its harnesses. */
export const AgentDistroProfileSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  harnesses: Schema.Array(AgentDistroHarnessSchema),
});

export type AgentDistroProfile = typeof AgentDistroProfileSchema.Type;

/** The `--list --json` document. At least one profile; `profiles[0]` is the
 *  default. */
export const AgentDistroListOutputSchema = Schema.Struct({
  profiles: Schema.Array(AgentDistroProfileSchema).check(Schema.isMinLength(1)),
});

/** What kolu knows of a build's listing: the profiles, or `unavailable` for a
 *  kolu built without agent-distro (explicit absence). */
export const AgentDistroListingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unavailable") }),
  Schema.Struct({
    kind: Schema.Literal("available"),
    profiles: AgentDistroListOutputSchema.fields.profiles,
  }),
]);

export type AgentDistroListing = typeof AgentDistroListingSchema.Type;

/** The argv that prints the listing, after the picker's path. */
export const LIST_JSON_ARGS: readonly string[] = ["--list", "--json"];

const decodeListOutput = Schema.decodeUnknownSync(AgentDistroListOutputSchema);

/** Parse the picker's `--list --json` stdout. Throws on anything else — a
 *  picker that prints something else is a broken build. */
export function parseAgentDistroList(stdout: string): AgentDistroListing {
  return {
    kind: "available",
    profiles: decodeListOutput(JSON.parse(stdout)).profiles,
  };
}
