/**
 * The agents a bundle holds, with their versions — upstream's
 * `share/agent-distro/versions` file, one `name\ttitle\tversion` line per
 * harness (agent-distro's `src/update/update.ts` `versions()` reads it the same
 * way: a version may itself contain tabs). Kolu reads it for the bundle a host
 * serves, so Settings names what that machine actually has, not what kolu was
 * built with — and words what a delivery changed from it ({@link bundleChanges}).
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

/** What changed between two bundles' versions, in upstream's words —
 *  agent-distro's `changes()` (`src/update/update.ts`), mirrored so the history
 *  line padi writes for a delivery reads as the updater's does: `Claude Code
 *  2.0.1 → 2.0.3, Pi added 0.4`. `previous` is `undefined` when nothing served
 *  before (every agent is then named with its version); `next` is `undefined`
 *  when the new bundle records no versions. */
export function bundleChanges(
  previous: readonly AgentVersion[] | undefined,
  next: readonly AgentVersion[] | undefined,
): string {
  if (next === undefined) return "versions not recorded by this bundle";
  const before = new Map(previous?.map((v) => [v.name, v]));
  const result: string[] = [];
  for (const { name, title, version } of next) {
    const old = before.get(name);
    if (previous === undefined) result.push(`${title} ${version}`);
    else if (old === undefined) result.push(`${title} added ${version}`);
    else if (old.version !== version)
      result.push(`${title} ${old.version} → ${version}`);
  }
  const after = new Set(next.map((v) => v.name));
  for (const { name, title } of previous ?? [])
    if (!after.has(name)) result.push(`${title} removed`);
  return result.join(", ") || "no harness version changed";
}
