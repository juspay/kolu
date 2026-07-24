/**
 * Detect a host's nix-system identifier by asking the host's own Nix.
 *
 * The companion piece to source-based agent resolution. `resolveSystem(host,
 * opts)` is the canonical target-system probe — it returns the
 * nix-system string (`x86_64-linux`, `aarch64-darwin`, …) that
 * `resolveAgentDrv` uses to select one package from the baked source flake.
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
 * `nix build` (and a GC-root pin) on the host over the same non-interactive
 * ssh (see `nixCopy.ts`), so the host's Nix is already a hard requirement
 * reachable on that PATH — `nix-instantiate` ships in the same
 * package. The probe adds no dependency the build step didn't.
 *
 * Typical low-level use. `resolveAgentDrv` is the higher-level source-flake
 * composition used by Kolu:
 *
 *   const session = makeSession({
 *     connectOnce: sshConnector({
 *       host,
 *       binary,
 *       localEnv,  // the composed env a `localhost` dial spawns with (never ambient process.env)
 *       resolveDrvPath: async (ctx) => {
 *         const sys = await resolveSystem(host, ctx);
 *         return resolveDrvForSystem(sys);
 *       },
 *     }),
 *   });
 */

import { buildSshProbeCommand } from "./host";
import { probePolicy } from "./nixCopy";
import { describeExit, runCapture } from "./process";

/** Sanity-guard shape for a nix-system identifier: `<cpu>-<os>`, e.g.
 *  `x86_64-linux`, `aarch64-darwin`. Deliberately NOT a closed
 *  allow-list — a host reporting a system this library has never seen
 *  (`riscv64-linux`, …) passes the probe; resolution succeeds only when the
 *  baked agent flake exposes `packages.<system>.<package>`. The guard only
 *  rejects output that clearly isn't a system string (empty, a warning line,
 *  multi-token noise). */
const NIX_SYSTEM_RE = /^[a-z0-9_]+-[a-z0-9_]+$/;

/** In-memory, per-process arch cache keyed by host. A host's nix-system is
 *  stable for the lifetime of this process, so the ssh round-trip the probe
 *  costs needn't be re-paid on every dial. Only SETTLED facts are cached:
 *  unresolved probes belong to one dial's cancellation lifetime and must not
 *  be shared with a replacement dial after recheck/destroy.
 *
 *  Deliberately in-memory only: an on-disk arch cache is REJECTED — a third
 *  source of truth that goes stale on a reimage / hostname reuse, the same
 *  reason the provisioned-state cache was rejected. A cold process re-probes
 *  once; that is always correct. */
const archCache = new Map<string, string>();

export interface ResolveSystemOptions {
  signal: AbortSignal;
  onProgress: (line: string) => void;
}

/** Ask `host`'s Nix for its `builtins.currentSystem` and return it,
 *  memoized per host for this process (see `archCache`). Runs locally for
 *  `isLocalHost`, over `ssh` otherwise. Rejects if the probe can't run, or
 *  returns something that isn't a nix-system — a rejection is NOT cached
 *  (see `delete`-on-reject below): a host unreachable at probe time is a
 *  transport fault, not a fact about the host, so the next dial re-probes. */
export async function resolveSystem(
  host: string,
  opts: ResolveSystemOptions,
): Promise<string> {
  const cached = archCache.get(host);
  if (cached !== undefined) return cached;
  const system = await probeSystem(host, opts);
  archCache.set(host, system);
  return system;
}

/** The actual ssh arch probe, un-memoized — `resolveSystem` wraps it with
 *  the per-host cache. */
async function probeSystem(
  host: string,
  opts: ResolveSystemOptions,
): Promise<string> {
  const { command, args } = buildSshProbeCommand(
    host,
    "nix-instantiate",
    "--eval",
    "--expr",
    "builtins.currentSystem",
  );
  const res = await runCapture(command, args, {
    // The arch probe (#1908 D1b) is a quick `nix-instantiate --eval` round-trip — never a
    // build — so it rides the shared QUICK-step deadline `probePolicy()` (the warm check
    // and pin use it too): the "how long a quick nix/ssh round-trip may run" policy shape
    // lives in ONE place, not re-spelled here.
    policy: probePolicy(),
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
  if (!res.ok) {
    throw new Error(
      `${host}: \`nix-instantiate --eval builtins.currentSystem\` ${describeExit(res)}`,
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
