/**
 * Where agent-distro's things are on THIS host — the host-side lookups over the
 * layout `@kolu/agent-distro` names: the host's state home (`$XDG_STATE_HOME`,
 * else `~/.local/state`), and the set this host serves — the one kolu last
 * landed here (its record, `landed.json`), else the floor's package with no
 * profile. Its volatility is agent-distro's state layout and the host's
 * environment, not kolu's policy.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  type DeliveredSet,
  parseDeliveredSet,
} from "@kolu/agent-distro/landing";
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

/** `path` resolved, or `undefined` when it does not exist. ONE `realpathSync`,
 *  never an exists-then-resolve pair: `current` is flipped atomically, and
 *  a spawn landing between a separate check and the resolve would throw on a link
 *  that is merely mid-flip. Only `ENOENT` is "absent"; anything else is thrown. */
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

/** Throw unless every path of `set` is in this host's store: the package's
 *  `bin/` and each profile's `profile.json`. kolu-server rooted them here, so
 *  one missing is a broken delivery (or a hand-collected store), never a set
 *  to serve half of. */
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

/** The set this host serves right now: the last one kolu landed here, else
 *  the floor's package with no profile; `undefined` when neither exists (a
 *  remote host before its first delivery). Throws on a record that does not
 *  parse or names a path this host does not hold ({@link assertSetOnHost}).
 *  A landed set older than a newer kolu's floor still wins, deliberately:
 *  kolu-server delivers upstream's newest as the restarted padi reconnects;
 *  offline the host keeps serving what it has. */
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
  // Resolved, as a landed path is, so the pinned path is the exact package.
  const floorDir = realpathOrUndefined(bake.floor.dir);
  if (floorDir === undefined)
    throw new Error(
      `agent-distro floor manifest names ${bake.floor.dir}, which does not exist`,
    );
  return { bundle: floorDir, profiles: [] };
}
