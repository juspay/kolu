/**
 * What a BUILT profile says of itself — upstream's
 * `share/agent-distro/profile.json` (agent-distro's `lib/mk-profile.nix`):
 * its name and description, beside the `env`, `settings` and `reader` a launch
 * reads, which kolu leaves to upstream. kolu-server reads it off each profile
 * it builds, to name the profile in Settings and in a host's history.
 */

import { Schema } from "effect";

export const ProfileFileSchema = Schema.Struct({
  /** The profile's name: a selector, so no whitespace or `/`. */
  name: Schema.String.check(Schema.isPattern(/^[^\s/]+$/)),
  /** Upstream's one-line description of the profile. */
  description: Schema.String,
});

export type ProfileFile = typeof ProfileFileSchema.Type;

/** Where a built profile describes itself. */
export function profileFile(profile: string): string {
  return `${profile}/share/agent-distro/profile.json`;
}

const decodeProfileFile = Schema.decodeUnknownSync(ProfileFileSchema);

/** Parse a built profile's `profile.json` — its name and description; the
 *  fields a launch reads are upstream's. Throws on a file without them. */
export function parseProfileFile(text: string): ProfileFile {
  return decodeProfileFile(JSON.parse(text));
}
