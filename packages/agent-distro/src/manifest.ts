/**
 * The FLOOR manifest — how kolu's local copy of agent-distro's package
 * describes itself, written by this package's Nix half (`default.nix`) from
 * the very value that builds it, at `share/kolu/agent-distro.json`:
 *
 *     { dir, bin }
 *
 * `dir` is agent-distro's one package as upstream builds it (every harness
 * launcher and the picker, `bin/agent-distro`, in `bin/`, and
 * `share/agent-distro/versions`). It carries no profile: profiles are built
 * and delivered on their own (`./landing.ts`). Readers go through this file
 * and never through a directory layout of their own.
 */

import { Schema } from "effect";

export const AgentDistroManifestSchema = Schema.Struct({
  /** The package's directory — what a terminal pins (its chip's hash). */
  dir: Schema.String.check(Schema.isMinLength(1)),
  /** `dir`'s `bin/` — what goes on a terminal's PATH. */
  bin: Schema.String.check(Schema.isMinLength(1)),
});

export type AgentDistroManifest = typeof AgentDistroManifestSchema.Type;

/** Where the manifest sits inside the floor. */
export function manifestFile(floor: string): string {
  return `${floor}/share/kolu/agent-distro.json`;
}

const decodeManifest = Schema.decodeUnknownSync(AgentDistroManifestSchema);

/** Parse a manifest's text. Throws on anything else — a floor without a valid
 *  manifest is a broken build. */
export function parseAgentDistroManifest(text: string): AgentDistroManifest {
  return decodeManifest(JSON.parse(text));
}
