/**
 * Platform → host resolution. Keys are Nix system tuples; values are
 * anything ssh can dial (or `localhost`, which short-circuits the nix-copy
 * transport). Missing platforms silently drop from the fanout — the operator
 * opts in per platform, exactly the justci hosts.json semantics.
 *
 * Lookup order:
 *   1. `$ODU_HOSTS` — explicit file path;
 *   2. `~/.config/odu/hosts.json`;
 *   3. `~/.config/justci/hosts.json` — migration fallback, so replacing
 *      justci needs zero config changes.
 * `--host PLAT=ADDR` upserts on top (and adds the platform when absent —
 * that is how `ci/pu/run.sh` pins the leased pool box).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HostsConfig {
  hosts: Record<string, string>;
  /** Which file won — named in run output so the operator can tell. */
  source: string;
}

export function loadHosts(): HostsConfig {
  const candidates = [
    ...(process.env.ODU_HOSTS !== undefined && process.env.ODU_HOSTS !== ""
      ? [process.env.ODU_HOSTS]
      : []),
    join(homedir(), ".config", "odu", "hosts.json"),
    join(homedir(), ".config", "justci", "hosts.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`odu: ${path} must be a JSON object of platform → host`);
    }
    const hosts: Record<string, string> = {};
    for (const [platform, host] of Object.entries(parsed)) {
      if (typeof host !== "string") {
        throw new Error(
          `odu: ${path}: host for "${platform}" must be a string`,
        );
      }
      hosts[platform] = host;
    }
    return { hosts, source: path };
  }
  return { hosts: {}, source: "(no hosts file)" };
}

/** Apply `--host PLAT=ADDR` pins and `--platform` slices to the config. */
export function resolveLanes(
  config: HostsConfig,
  hostPins: readonly string[],
  platforms: readonly string[],
): Record<string, string> {
  const hosts = { ...config.hosts };
  for (const pin of hostPins) {
    const eq = pin.indexOf("=");
    if (eq <= 0) {
      throw new Error(`odu: --host expects PLATFORM=ADDR, got "${pin}"`);
    }
    hosts[pin.slice(0, eq)] = pin.slice(eq + 1);
  }
  if (platforms.length === 0) return hosts;
  const sliced: Record<string, string> = {};
  for (const platform of platforms) {
    const host = hosts[platform];
    if (host === undefined) {
      throw new Error(
        `odu: --platform ${platform} has no host (configure it or pass --host ${platform}=ADDR)`,
      );
    }
    sliced[platform] = host;
  }
  return sliced;
}
