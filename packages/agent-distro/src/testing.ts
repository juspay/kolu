/**
 * Test support: a profile bundle's two self-describing files, written the way
 * upstream writes them — the inverse of `./profileFile` and `./versions`, at
 * the paths those modules name. Every test that fakes a bundle (this package's,
 * kolu-server's boot read, the e2e fixture) spells "a bundle's files" through
 * here, so the layout and the formats are written once on the test side too.
 */

import type { AgentDistroProfile } from "./listing.ts";
import { profileFile } from "./profileFile.ts";
import { versionsFile } from "./versions.ts";

/** `profile`'s `profile.json` and `versions`, keyed by their paths under
 *  `bundle`. */
export function bundleFiles(
  bundle: string,
  profile: Pick<AgentDistroProfile, "name" | "description" | "harnesses">,
): Record<string, string> {
  return {
    // Key order as upstream's `builtins.toJSON` writes it (sorted).
    [profileFile(bundle)]: JSON.stringify({
      description: profile.description,
      name: profile.name,
    }),
    [versionsFile(bundle)]: profile.harnesses
      .map((h) => `${h.name}\t${h.title}\t${h.version}\n`)
      .join(""),
  };
}

/** A `readText` over in-memory files: a path that is not there throws, as a
 *  missing file does. */
export function readFrom(
  files: Record<string, string>,
): (path: string) => string {
  return (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };
}
