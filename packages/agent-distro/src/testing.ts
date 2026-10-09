/**
 * Test support: a profile bundle's two self-describing files, written the way
 * upstream writes them — the inverse of `./profileFile` and `./versions`, at
 * the paths those modules name — and a stand-in for its picker's
 * `--list --json`. Every test that fakes a bundle (this package's, padi's,
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

/** The profile the stand-in `--list --json` reports in effect for any
 *  `AI_PROFILE` that is not a bundle's name — upstream would evaluate the
 *  reference; the stand-in only proves kolu exported it. */
export const STAND_IN_REFERENCE_PROFILE = {
  name: "fixture-mine",
  description: "Fixture profile from a reference",
} as const;

/** A profile containing this does not resolve: the stand-in fails as upstream
 *  does for a reference it cannot fetch. */
export const STAND_IN_UNRESOLVABLE = "nobody";

/** The stand-in picker's `--list --json` branch (POSIX sh) for `bundle`'s
 *  bundle among `bundles`: upstream's shape with an empty menu (kolu reads only
 *  `profile`). `AI_PROFILE` unset or a bundle's name is that built-in; one
 *  containing {@link STAND_IN_UNRESOLVABLE} fails with upstream's words on
 *  stderr; anything else is {@link STAND_IN_REFERENCE_PROFILE}. */
export function standInListJson(
  bundle: string,
  bundles: readonly string[],
): string {
  const ref = STAND_IN_REFERENCE_PROFILE;
  const builtin = (name: string) =>
    `printf '{"profiles":[],"profile":{"description":"Fixture profile %s","name":"%s","origin":"%s","source":"builtin"}}\\n' "${name}" "${name}" "${name}"`;
  return [
    'if [ "$1" = "--list" ] && [ "$2" = "--json" ]; then',
    '  case "$AI_PROFILE" in',
    `    "") ${builtin(bundle)} ;;`,
    ...bundles.map((b) => `    ${b}) ${builtin("$AI_PROFILE")} ;;`),
    `    *${STAND_IN_UNRESOLVABLE}*)`,
    `      printf 'agent-distro: AI_PROFILE=%s: cannot fetch %s:\\nerror: unable to download: HTTP error 404\\n' "$AI_PROFILE" "$AI_PROFILE" >&2`,
    "      exit 1 ;;",
    `    *) printf '{"profiles":[],"profile":{"description":"${ref.description}","name":"${ref.name}","origin":"%s","source":"variable"}}\\n' "$AI_PROFILE" ;;`,
    "  esac",
    "  exit 0",
    "fi",
  ].join("\n");
}
