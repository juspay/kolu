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

const decodeProfileFile = Schema.decodeUnknownSync(ProfileFileSchema);

/** Parse a `profile.json`. Throws on anything else, and on a field upstream's
 *  parser would refuse too (an unknown one) — a format change upstream must be
 *  loud, never a profile described by half its file. */
export function parseProfileFile(text: string): ProfileFile {
  const value: unknown = JSON.parse(text);
  const file = decodeProfileFile(value);
  const extra = Object.keys(value as object).filter(
    (key) => !(key in ProfileFileSchema.fields),
  );
  if (extra.length > 0)
    throw new Error(
      `agent-distro profile.json has unknown field ${extra[0]}: ${text}`,
    );
  return file;
}
