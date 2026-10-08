/**
 * The agents a bundle holds, with their versions — upstream's
 * `share/agent-distro/versions` file, one `name\ttitle\tversion` line per
 * harness (agent-distro's `src/update/update.ts` `versions()` reads it the same
 * way: a version may itself contain tabs). Kolu reads it for the bundle a host
 * serves, so Settings names what that machine actually has, not what kolu was
 * built with.
 */

import { Schema } from "effect";

export const AgentVersionSchema = Schema.Struct({
  /** The harness's command name (`claude`). */
  name: Schema.String,
  /** How people know it (`Claude Code`). */
  title: Schema.String,
  version: Schema.String,
});

export type AgentVersion = typeof AgentVersionSchema.Type;

/** Where a bundle lists its harnesses and versions. */
export function versionsFile(bundle: string): string {
  return `${bundle}/share/agent-distro/versions`;
}

/** Parse a versions file. Throws on a line without three fields — a format
 *  change upstream must be loud, never an empty agents line. */
export function parseVersions(text: string): readonly AgentVersion[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name, title, ...version] = line.split("\t");
      if (
        name === undefined ||
        name === "" ||
        title === undefined ||
        version.length === 0
      )
        throw new Error(
          `agent-distro versions line is not name\\ttitle\\tversion: ${JSON.stringify(line)}`,
        );
      return { name, title, version: version.join("\t") };
    });
}
