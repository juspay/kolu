/**
 * The ssh-host registry (P3) — which remote hosts kolu-server can dial, and how
 * to resolve each one's kolu-watcher derivation.
 *
 * Two nix-baked env inputs, mirroring kaval-tui's `--host` config axis:
 *   - `KOLU_HOSTS_JSON` — a `{ hostId: sshTarget }` map of the configured
 *     remote hosts. `hostId` is the user-facing name (the host chip label + the
 *     `daemonStatus` collection key); `sshTarget` is passed verbatim to ssh
 *     (an alias, `user@host`, …). Absent / empty ⇒ no remote hosts (the
 *     pre-P3, local-only world).
 *   - `KOLU_WATCHER_AGENT_DRVS_JSON` — the `{ system → kolu-watcher .drv }` map
 *     baked onto the kolu server wrapper, so a dial can ship the target-arch
 *     watcher closure cross-arch.
 *
 * The static-config axes (env present / valid JSON / right shape) are validated
 * EAGERLY when a host's config is built, so a misconfiguration surfaces as a
 * clear error at endpoint construction — never misclassified as a retryable
 * "network" fault deep inside the session's reconnect loop. Only the per-host
 * arch probe stays deferred (`resolveWatcherAgentDrv`).
 */

import { LOCAL_HOST_ID } from "../ptyHost/index.ts";
import { resolveWatcherAgentDrv } from "./watcherDrv.ts";

export interface ConfiguredHost {
  /** The user-facing host id (daemonStatus key, host chip label). */
  hostId: string;
  /** The ssh target dialed (verbatim to ssh). */
  host: string;
}

export interface HostDialConfig {
  host: string;
  resolveDrvPath: () => Promise<string>;
}

/** Parse + validate a `{ key: string }` JSON env map, or throw a clear config
 *  error. Shared shape-check for both the hosts map and the drv map. */
function parseStringMap(
  raw: string | undefined,
  envName: string,
): Record<string, string> {
  if (raw === undefined || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${envName} is not valid JSON: ${(err as Error).message}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(`${envName} must be a JSON object of string values.`);
  }
  return parsed as Record<string, string>;
}

function watcherDrvBySystem(): Record<string, string> {
  return parseStringMap(
    process.env.KOLU_WATCHER_AGENT_DRVS_JSON,
    "KOLU_WATCHER_AGENT_DRVS_JSON",
  );
}

/** The configured remote hosts (excludes the implicit local host). Parsed
 *  fresh each call so a host added to the env between reads is picked up; the
 *  map is tiny. */
export function listConfiguredHosts(): ConfiguredHost[] {
  const map = parseStringMap(process.env.KOLU_HOSTS_JSON, "KOLU_HOSTS_JSON");
  return Object.entries(map).map(([hostId, host]) => ({ hostId, host }));
}

/** Resolve a host's dial config. A `hostId` in KOLU_HOSTS_JSON dials its named
 *  ssh target; any OTHER non-empty hostId is dialed AS the ssh target verbatim
 *  (so a user can type `nix@box` straight into the palette without pre-config —
 *  KOLU_HOSTS_JSON just provides friendly aliases). Returns undefined only for
 *  an empty/local hostId. Validates the drv map eagerly (a config error throws
 *  here, synchronously), leaving only the per-host arch probe deferred. */
export function hostConfigFor(hostId: string): HostDialConfig | undefined {
  if (!hostId || hostId === LOCAL_HOST_ID) return undefined;
  const found = listConfiguredHosts().find((h) => h.hostId === hostId);
  const host = found?.host ?? hostId;
  const drvBySystem = watcherDrvBySystem();
  return {
    host,
    resolveDrvPath: () => resolveWatcherAgentDrv(host, drvBySystem),
  };
}
