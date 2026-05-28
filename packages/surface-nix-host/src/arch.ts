/**
 * Detect a remote host's nix-system identifier via `uname -ms`.
 *
 * The companion piece to `provisionAgent`'s docstring contract: the
 * library deliberately takes one `.drv` per session and ships exactly
 * that, leaving arch selection to the caller. `resolveSystem(host)` is
 * the canonical probe to feed into that selection — one mapping table
 * covers both the local (`uname -ms` directly) and remote
 * (`ssh $host uname -ms`) cases.
 *
 * Typical use, paired with a per-system `.drv` map the caller builds at
 * its own build time:
 *
 *   const sys = await resolveSystem(host);
 *   const drv = myDrvBySystem[sys];
 *   if (!drv) throw new Error(`${host}: no .drv for ${sys}`);
 *   const session = getHostSession({ host, drvPath: drv, binary });
 *
 * The mapping table lives here (not in the caller) because every kolu
 * consumer that ships agents cross-arch hits the same `uname -ms` →
 * nix-system translation; consolidating it avoids per-consumer copies
 * that drift on additions like Intel Mac or RISC-V.
 */

import { isLocalHost } from "./host";
import { runCapture } from "./process";

/** Known `uname -ms` outputs and their nix-system identifiers.
 *  `Darwin x86_64` (Intel Mac) is included for completeness; consumers
 *  that don't bake a `.drv` for it will get a clear "no .drv" error
 *  from their own map lookup rather than a misleading
 *  "unsupported system" from the probe. */
export const UNAME_TO_NIX_SYSTEM: Readonly<Record<string, string>> = {
  "Linux x86_64": "x86_64-linux",
  "Linux aarch64": "aarch64-linux",
  "Darwin arm64": "aarch64-darwin",
  "Darwin x86_64": "x86_64-darwin",
};

/** Pure mapping from `uname -ms` output → nix-system, or `null` for
 *  unsupported. Split from `resolveSystem` so the table can be tested
 *  without spawning `uname`/`ssh`. */
export function unameToNixSystem(unameOut: string): string | null {
  return UNAME_TO_NIX_SYSTEM[unameOut.trim()] ?? null;
}

/** Run `uname -ms` against `host` and return the nix-system identifier.
 *  Throws if the host is reachable but reports a uname this library
 *  doesn't know how to map, or if the probe itself fails (ssh down,
 *  uname missing, etc.). */
export async function resolveSystem(host: string): Promise<string> {
  const argv = isLocalHost(host)
    ? (["uname", "-ms"] as const)
    : (["ssh", "-o", "BatchMode=yes", host, "uname", "-ms"] as const);
  const res = await runCapture(argv[0], argv.slice(1), () => {
    /* uname probe doesn't surface stderr to a progress channel; the
       error path below carries enough context for the caller. */
  });
  if (!res.ok) {
    throw new Error(`${host}: \`${argv.join(" ")}\` exited ${res.code}`);
  }
  const sys = unameToNixSystem(res.stdout);
  if (sys === null) {
    const known = Object.keys(UNAME_TO_NIX_SYSTEM)
      .map((k) => JSON.stringify(k))
      .join(", ");
    throw new Error(
      `${host}: unsupported \`uname -ms\` output ${JSON.stringify(res.stdout.trim())} (known: ${known})`,
    );
  }
  return sys;
}
