/**
 * The profile a bundle holds — upstream's `share/agent-distro/profile.json`,
 * `{ "description": "…", "name": "<profile.name>" }` (agent-distro's U7, typed
 * upstream as `ProfileFile` in its `src/listing.ts`, parsed by
 * `parseProfileFile`). It comes from the same profile attributes as the
 * picker's own listing, so kolu reads it instead of running the picker. With
 * `./versions` it is everything kolu needs to describe a profile.
 */

import { Schema } from "effect";

export const ProfileFileSchema = Schema.Struct({
  /** The profile's name (`AI_PROFILE`): a selector, so no whitespace or `/`. */
  name: Schema.String.check(Schema.isPattern(/^[^\s/]+$/)),
  /** Upstream's one-line description of the profile. */
  description: Schema.String,
});

export type ProfileFile = typeof ProfileFileSchema.Type;

/** Where a bundle describes its profile. */
export function profileFile(bundle: string): string {
  return `${bundle}/share/agent-distro/profile.json`;
}

// An unknown field is refused, as upstream's own parser refuses it.
const decodeProfileFile = Schema.decodeUnknownSync(ProfileFileSchema, {
  onExcessProperty: "error",
});

/** Parse a `profile.json`. Throws on anything else, including a field upstream
 *  does not write — a format change upstream must be loud, never a profile
 *  described by half its file. */
export function parseProfileFile(text: string): ProfileFile {
  return decodeProfileFile(JSON.parse(text));
}
