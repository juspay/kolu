/**
 * Resolve a host's kolu-watcher `.drv` for provisioning — the kolu-server
 * analog of kaval-tui's `resolveKavalAgentDrv`.
 *
 * The ONLY genuinely-per-host, genuinely-volatile step in the dial: probe the
 * host's nix-system over ssh (`resolveSystem`), then look that system up in the
 * baked `{ system → kolu-watcher .drv }` map. It is the only thing the deferred
 * `resolveDrvPath` thunk runs, so an unreachable host (or an arch with no baked
 * derivation) folds into the `HostSession`'s reconnect machinery rather than a
 * hard failure at boot.
 */

import { resolveSystem } from "@kolu/surface-nix-host";

export async function resolveWatcherAgentDrv(
  host: string,
  drvBySystem: Record<string, string>,
): Promise<string> {
  const system = await resolveSystem(host);
  const drv = drvBySystem[system];
  if (drv === undefined) {
    const known = Object.keys(drvBySystem).join(", ") || "none";
    throw new Error(
      `${host}: no kolu-watcher derivation baked for system=${system} (have: ${known}).`,
    );
  }
  return drv;
}
