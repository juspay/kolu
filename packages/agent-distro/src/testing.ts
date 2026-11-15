/**
 * Test support: the files agent-distro's package and a built profile describe
 * themselves with, written the way upstream writes them — the inverse of
 * `./listing` and `./profileFile`, at the paths those modules name — a failed
 * line of a host's update log, and a stand-in for the picker's
 * `--list --json`. Every test that fakes a package or a profile (this
 * package's, padi's, kolu-server's boot read, the e2e fixture) spells "its
 * files" through here, so the layout and the formats are written once on the
 * test side too.
 */

import { historyLine } from "@juspay/agent-distro/update/history";
import { versionsFile } from "./bundle.ts";
import type { AgentModels } from "./models.ts";
import type { AgentVersion } from "./listing.ts";
import { type ProfileFile, profileFile } from "./profileFile.ts";

/** The package's `versions`, keyed by its path under `bundle`. */
export function packageFiles(
  bundle: string,
  harnesses: readonly AgentVersion[],
): Record<string, string> {
  return {
    [versionsFile(bundle)]: harnesses
      .map((h) => `${h.name}\t${h.title}\t${h.version}\n`)
      .join(""),
  };
}

/** A built profile's `profile.json`, keyed by its path under `path` — as
 *  upstream's `mkProfile` writes it (sorted keys, with the fields a launch
 *  reads). */
export function builtProfileFiles(
  path: string,
  profile: ProfileFile,
): Record<string, string> {
  return {
    [profileFile(path)]: JSON.stringify({
      description: profile.description,
      env: {},
      name: profile.name,
      reader: "fixture-agent-distro-runtime",
      settings: {},
    }),
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

/** A failed run's line in a host's update log, written by upstream's own
 *  writer as agent-distro's updater appends it — what a fixture seeds to stand
 *  in for a failed update. */
export function failedUpdateLine(reason: string, date?: Date): string {
  return historyLine(`failed: ${reason}`, date);
}

/** The profile the stand-in `--list --json` reports in effect for any
 *  non-empty `AI_PROFILE` — upstream would read the built profiles; the
 *  stand-in only proves kolu exported them. */
export const STAND_IN_PROFILE = {
  name: "fixture-stack",
  description: "Fixture profile stack",
} as const;

/** The stand-in picker's `--list --json` branch (POSIX sh): upstream's shape
 *  (`{ harnesses, profile? }`), with `harnesses` as given. `AI_PROFILE` unset
 *  or empty has no profile in effect; anything else is
 *  {@link STAND_IN_PROFILE}, from that variable. */
export function standInListJson(harnesses: readonly AgentVersion[]): string {
  const menu = JSON.stringify(
    harnesses.map((h) => ({
      name: h.name,
      tagline: `${h.title} fixture`,
      title: h.title,
      version: h.version.split("+")[0] ?? h.version,
    })),
  );
  const p = STAND_IN_PROFILE;
  return [
    'if [ "$1" = "--list" ] && [ "$2" = "--json" ]; then',
    '  if [ -z "$AI_PROFILE" ]; then',
    `    printf '%s\\n' '{"harnesses":${menu}}'`,
    "  else",
    `    printf '{"harnesses":${menu.replaceAll("%", "%%")},"profile":{"description":"${p.description}","name":"${p.name}","origin":"%s","source":"variable"}}\\n' "$AI_PROFILE"`,
    "  fi",
    "  exit 0",
    "fi",
  ].join("\n");
}

/** What the stand-in picker answers for one harness's `--models`: upstream's
 *  `Models`, or a list command that fails with these words on stderr. */
export type StandInModels = AgentModels | { readonly fails: string };

/** The stand-in picker's `--models <harness>` branch (POSIX sh), answering
 *  each harness as given — a harness not named fails, as upstream's picker
 *  refuses one it does not carry. */
export function standInModels(
  answers: Readonly<Record<string, StandInModels>>,
): string {
  const arms = Object.entries(answers).map(([harness, answer]) =>
    "fails" in answer
      ? `    ${harness}) printf '%s\\n' ${shellWord(answer.fails)} >&2; exit 1 ;;`
      : `    ${harness}) printf '%s\\n' ${shellWord(JSON.stringify(answer))}; exit 0 ;;`,
  );
  return [
    'if [ "$1" = "--models" ]; then',
    '  case "$2" in',
    ...arms,
    '    *) echo "agent-distro picker: error: --models takes a harness this package carries" >&2; exit 2 ;;',
    "  esac",
    "fi",
  ].join("\n");
}

/** One POSIX single-quoted word. */
const shellWord = (text: string): string =>
  `'${text.replaceAll("'", "'\\''")}'`;
