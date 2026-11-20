import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  type DeliveredSet,
  parseDeliveredSet,
} from "@kolu/agent-distro/landing";
import {
  PACKAGE_ANSWERS_FILE,
  parsePackageAnswers,
} from "@kolu/agent-distro/models";
import { profileFile } from "@kolu/agent-distro/profileFile";
import type { AgentDistroBake } from "./bake.ts";

/** The host's state home, where agent-distro keeps `current` — the same
 *  `$XDG_STATE_HOME` (default `~/.local/state`) its Home Manager module uses. */
export function hostStateHome(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg !== undefined && xdg !== ""
    ? xdg
    : join(homedir(), ".local", "state");
}

export function realpathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** `path`'s text, or `undefined` when it does not exist. Only `ENOENT` is
 *  "absent"; anything else is thrown. */
export function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export class AgentPackageUnreadable extends Error {
  override readonly name = "AgentPackageUnreadable";
}

/** What the package's own picker answers: a package built before kolu asked
 *  for the file has none, which is an AGE, not a breakage. */
export type PackageAnswers =
  | { readonly kind: "pre-models" }
  | { readonly kind: "answers"; readonly flags: ReadonlyArray<string> };

export const packageAnswers = (bundle: string): PackageAnswers => {
  const file = join(bundle, PACKAGE_ANSWERS_FILE);
  const text = readOrUndefined(file);
  if (text === undefined) return { kind: "pre-models" };
  const flags = parsePackageAnswers(text);
  if (flags.length === 0)
    throw new AgentPackageUnreadable(
      `the agents delivered to this host are broken: ${file} names no call kolu can make, and every published package names at least one`,
    );
  return { kind: "answers", flags };
};

export function assertSetOnHost(set: DeliveredSet): void {
  if (!existsSync(agentBinDir(set.bundle)))
    throw new Error(
      `the agents that landed here name ${set.bundle}, but this host has no ${agentBinDir(set.bundle)}`,
    );
  for (const p of set.profiles)
    if (!existsSync(profileFile(p.path)))
      throw new Error(
        `the agents that landed here name the ${p.name} profile at ${p.path}, but this host has no ${profileFile(p.path)}`,
      );
}

export function servedSetOnHost(
  bake: AgentDistroBake,
): DeliveredSet | undefined {
  const text = readOrUndefined(bake.landedFile);
  if (text !== undefined) {
    const set = parseDeliveredSet(text);
    assertSetOnHost(set);
    return set;
  }
  if (bake.floor === undefined) return undefined;
  const floorDir = realpathOrUndefined(bake.floor.dir);
  if (floorDir === undefined)
    throw new Error(
      `agent-distro floor manifest names ${bake.floor.dir}, which does not exist`,
    );
  return { bundle: floorDir, profiles: [] };
}
