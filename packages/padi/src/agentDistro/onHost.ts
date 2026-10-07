/**
 * Where agent-distro's things are on THIS host — the host-side lookups over the
 * layout `@kolu/agent-distro/bundle` names: the host's state home (`$XDG_STATE_HOME`, else
 * `~/.local/state`), the `current` link agent-distro's updater flips under it,
 * the floor's `profiles/<name>` dirs, and the host's own `nix`. Its volatility is
 * agent-distro's state layout and the host's environment, not kolu's policy.
 */

import { accessSync, constants as fsConstants, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { currentLink, floorProfileDir } from "@kolu/agent-distro/bundle";
import {
  type AgentDistroBake,
  type AgentDistroProfileBake,
  hostUpdaterConfig,
} from "./bake.ts";

/** The host's state home, where agent-distro keeps `current` — the same
 *  `$XDG_STATE_HOME` (default `~/.local/state`) its Home Manager module uses. */
export function hostStateHome(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg !== undefined && xdg !== ""
    ? xdg
    : join(homedir(), ".local", "state");
}

/** `path` resolved, or `undefined` when it does not exist. ONE `realpathSync`,
 *  never an exists-then-resolve pair: the updater flips `current` atomically, and
 *  a spawn landing between a separate check and the resolve would throw on a link
 *  that is merely mid-flip. Only `ENOENT` is "absent"; anything else is thrown. */
function realpathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Where `profile`'s bundle is on this host right now: the `current` the updater
 *  maintains, else the floor; `undefined` when neither exists (a remote host
 *  before its first download). Always a resolved store path, so whoever
 *  receives it pins that exact bundle. */
export function bundleOnHost(
  bake: AgentDistroBake,
  profile: AgentDistroProfileBake,
): string | undefined {
  const { stateDir } = hostUpdaterConfig(bake, profile, hostStateHome());
  const current = realpathOrUndefined(currentLink(stateDir));
  if (current !== undefined) return current;
  if (bake.floor === undefined) return undefined;
  const floorDir = realpathOrUndefined(
    floorProfileDir(bake.floor, profile.name),
  );
  if (floorDir === undefined) {
    // The floor is a build fact; a profile the listing names but the floor lacks
    // is a broken build, not a state to degrade from.
    throw new Error(
      `agent-distro floor ${bake.floor} has no profiles/${profile.name}, though the updater listing names it`,
    );
  }
  return floorDir;
}

/** The host's `nix`, as the updater will find it — on padi's own PATH. A padi
 *  started over a non-login ssh session on a non-NixOS host (or macOS) often
 *  lacks the Nix profile on PATH, and the updater would then die with a bare
 *  spawn error; naming it here gives the host tab the real fix. */
export function nixOnPath(): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, "nix");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not in this PATH entry; the next one may have it.
    }
  }
  return undefined;
}
