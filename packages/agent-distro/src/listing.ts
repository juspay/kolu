/**
 * agent-distro's machine listing — what `agent-distro --list --json` prints
 * (agent-distro's U1): the profiles that picker launches, `profiles[0]` its
 * default, each with its description and harnesses. Every profile bundle
 * carries its own picker (`bin/agent-distro`), which lists exactly that
 * profile; kolu runs each floor profile's and joins them, in the floor
 * manifest's order, to offer the profiles in Settings. It never re-describes
 * them.
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

/** The picker's name inside a profile bundle's `bin/`. */
export const PICKER_COMMAND = "agent-distro";

/** The argv that prints the listing, after the picker's path. */
export const LIST_JSON_ARGS: readonly string[] = ["--list", "--json"];

const decodeListOutput = Schema.decodeUnknownSync(AgentDistroListOutputSchema);

/** Parse a picker's `--list --json` stdout. Throws on anything else — a
 *  picker that prints something else is a broken build. */
export function parseAgentDistroList(stdout: string): AgentDistroListing {
  return {
    kind: "available",
    profiles: decodeListOutput(JSON.parse(stdout)).profiles,
  };
}

/** Parse the `--list --json` stdout of profile `name`'s own picker, which
 *  lists exactly that profile. Throws on anything else — a bundle whose picker
 *  lists another profile, or more than one, is a broken build. */
export function parseProfileListing(
  name: string,
  stdout: string,
): AgentDistroProfile {
  const profiles = decodeListOutput(JSON.parse(stdout)).profiles;
  const [only] = profiles;
  if (profiles.length !== 1 || only?.name !== name)
    throw new Error(
      `agent-distro profile '${name}''s picker lists [${profiles.map((p) => p.name).join(", ")}], not exactly '${name}'`,
    );
  return only;
}
