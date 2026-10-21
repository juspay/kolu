/**
 * The profile in effect for a launch — the `profile` field of upstream's
 * `agent-distro --list --json`, read with upstream's own parser and words
 * (`@juspay/agent-distro/listing`: `parseListing`, `nameText`, `sourceText`).
 * Upstream composes it (a repository's `plugin.json` over the `AI_PROFILE`
 * stack, bottom to top); kolu never re-derives it, it asks once
 * per terminal and records the answer (`TerminalAgents.effective`).
 *
 * A launch with no profile at all — an empty stack, and no repository — has
 * none: that is `undefined`, never an error.
 */

import {
  nameText,
  parseListing,
  sourceText,
} from "@juspay/agent-distro/listing";
import { Schema } from "effect";

export const ProfileInEffectSchema = Schema.Struct({
  /** The stack in effect, in upstream's words: `juspay + repo`. */
  name: Schema.String.check(Schema.isMinLength(1)),
  /** The top profile's description. */
  description: Schema.String,
  /** Where it came from, in upstream's words: `from
   *  /home/me/repo/plugin.json over AI_PROFILE=/nix/store/…`. */
  source: Schema.String.check(Schema.isMinLength(1)),
});

export type ProfileInEffect = typeof ProfileInEffectSchema.Type;

/** The profile in effect from `agent-distro --list --json`'s stdout, or
 *  `undefined` for a launch that has none. Throws on output that is not
 *  upstream's listing — a format change upstream must be loud. */
export function parseProfileInEffect(
  stdout: string,
): ProfileInEffect | undefined {
  const { profile } = parseListing(JSON.parse(stdout));
  return profile === undefined
    ? undefined
    : {
        name: nameText(profile),
        description: profile.description,
        source: sourceText(profile),
      };
}

/** The arguments that make a package's `bin/agent-distro` print its listing. */
export const LIST_JSON_ARGS: readonly string[] = ["--list", "--json"];
