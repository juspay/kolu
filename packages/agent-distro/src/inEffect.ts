/**
 * The profile in effect for a launch — the `profile` field of upstream's
 * `agent-distro --list --json` (agent-distro's `src/listing.ts`, `InEffect`):
 * which profile a launch from a given directory and environment uses, and
 * where that choice came from. Upstream resolves it (a positional argument, the
 * repository's `agent-distro.nix` found from the working directory up to the
 * git root, `AI_PROFILE`, then the launcher's built-in); kolu never re-derives
 * it, it asks once per terminal and records the answer
 * (`TerminalAgents.effective`).
 *
 * A bundle older than profile references prints no `profile`: that is
 * `undefined`, never an error.
 */

import { Schema } from "effect";

export const ProfileInEffectSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  /** Where upstream resolved it from: the reference, the path to the `agent-distro.nix` found, or the
   *  built-in name. */
  origin: Schema.String.check(Schema.isMinLength(1)),
});

export type ProfileInEffect = typeof ProfileInEffectSchema.Type;

/** The one field kolu reads off the listing; the rest is upstream's menu,
 *  which kolu takes from the bundle's own files instead (`./listing`). */
const ListingProfileSchema = Schema.Struct({
  profile: Schema.optionalKey(ProfileInEffectSchema),
});

const decodeListingProfile = Schema.decodeUnknownSync(ListingProfileSchema);

/** The profile in effect from `agent-distro --list --json`'s stdout, or
 *  `undefined` for a bundle that prints none. Throws on output that is not
 *  JSON, or a `profile` out of upstream's format — a format change upstream
 *  must be loud. */
export function parseProfileInEffect(
  stdout: string,
): ProfileInEffect | undefined {
  return decodeListingProfile(JSON.parse(stdout)).profile;
}

/** The arguments that make a bundle's `bin/agent-distro` print its listing. */
export const LIST_JSON_ARGS: readonly string[] = ["--list", "--json"];
