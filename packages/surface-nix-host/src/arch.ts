/**
 * Detect a host's nix-system identifier by asking the host's own Nix.
 *
 * The companion piece to `provisionAgent`'s docstring contract: the
 * library deliberately takes one `.drv` per session and ships exactly
 * that, leaving arch selection to the caller. `resolveSystem(host)` is
 * the canonical probe to feed that selection — it returns the
 * nix-system string (`x86_64-linux`, `aarch64-darwin`, …) the caller
 * keys its per-system `.drv` map on.
 *
 * Why ask Nix rather than parse `uname -ms`: the host's own Nix is the
 * authoritative answer to "what system will this machine build for",
 * which is exactly the question that decides which agent `.drv` to
 * realise here. It needs no hand-maintained `uname → nix-system` table
 * (which silently drifts as platforms are added — Intel Mac, RISC-V, …)
 * and it stays correct under emulation / cross setups where `uname`
 * and Nix's `system` disagree.
 *
 * Why this is safe to depend on: `provisionAgent` already runs
 * `nix-store --realise` on the host over the same non-interactive ssh
 * (see `nixCopy.ts`), so the host's Nix is already a hard requirement
 * reachable on that PATH — `nix-instantiate` ships in the same
 * package. The probe adds no dependency the realise step didn't.
 *
 * Typical use, paired with a per-system `.drv` map the caller builds at
 * its own build time:
 *
 *   const sys = await resolveSystem(host);
 *   const drv = myDrvBySystem[sys];
 *   if (!drv) throw new Error(`${host}: no .drv for ${sys}`);
 *   const session = getHostSession({ host, drvPath: drv, binary });
 */

import { buildSshProbeCommand } from "./host";
import { runCapture } from "./process";

/** Sanity-guard shape for a nix-system identifier: `<cpu>-<os>`, e.g.
 *  `x86_64-linux`, `aarch64-darwin`. Deliberately NOT a closed
 *  allow-list — a host reporting a system this library has never seen
 *  (`riscv64-linux`, …) resolves fine, as long as the caller baked a
 *  matching `.drv`. The guard only rejects output that clearly isn't a
 *  system string (empty, a warning line, multi-token noise). */
const NIX_SYSTEM_RE = /^[a-z0-9_]+-[a-z0-9_]+$/;

/** Ask `host`'s Nix for its `builtins.currentSystem` and return it.
 *  Runs locally for `isLocalHost`, over `ssh` otherwise. Throws if the
 *  probe can't run, or returns something that isn't a nix-system. */
export async function resolveSystem(host: string): Promise<string> {
  const { command, args } = buildSshProbeCommand(
    host,
    "nix-instantiate",
    "--eval",
    "--expr",
    "builtins.currentSystem",
  );
  const res = await runCapture(command, args);
  if (!res.ok) {
    throw new Error(
      `${host}: \`nix-instantiate --eval builtins.currentSystem\` exited ${res.code}`,
    );
  }
  // nix-instantiate prints the Nix string repr — `"x86_64-linux"\n` —
  // which is valid JSON for a plain string, so JSON.parse strips the
  // surrounding quotes.
  let sys: unknown;
  try {
    sys = JSON.parse(res.stdout.trim());
  } catch {
    throw new Error(
      `${host}: could not parse nix-system from probe output ${JSON.stringify(res.stdout.trim())}`,
    );
  }
  if (typeof sys !== "string" || !NIX_SYSTEM_RE.test(sys)) {
    throw new Error(
      `${host}: probe returned ${JSON.stringify(sys)}, not a nix-system string`,
    );
  }
  return sys;
}
