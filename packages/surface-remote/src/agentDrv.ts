/**
 * Resolve the exact agent derivation a remote host needs from the source flake
 * baked into a caller's Nix wrapper.
 *
 * The source ref is cheap to bake: unlike a `{ system → .drv }` map, it does not
 * evaluate every supported platform while `nix run .` is deciding what to run.
 * The first remote dial probes that host's Nix system, evaluates only the matching
 * package's `.drvPath`, then the existing provisioning path copies and realises
 * that derivation remotely.
 */

import { resolveSystem } from "./arch";
import { looksLikeNetworkError, ResolveDrvError } from "./host";
import { PROVISION_STEP_SILENCE_BASE_MS } from "./nixCopy";
import { describeExit, type ExitResult, runCapture } from "./process";
import { appendProgressLine } from "./progressTail";
import agentEnv from "../agent-env.json" with { type: "json" };
import QuickLRU from "quick-lru";

/** The framework-owned wrapper boundary for an agent source flake. */
export const SURFACE_AGENT_FLAKE_REF_ENV = agentEnv.flakeRef;

/** Validate the already-read wrapper value before a dial starts. */
export function requireAgentFlakeRef(raw: string | undefined): string {
  const ref = raw?.trim();
  if (!ref) {
    throw new Error(
      `${SURFACE_AGENT_FLAKE_REF_ENV} is not set — remote agents need the source flake baked into the build. Run the agent client from its Nix wrapper.`,
    );
  }
  return ref;
}

/** A running Kolu normally sees two entries (padi + kaval). Bound the shared
 * successful-value cache so repeated exact-source upgrades cannot retain every
 * old store ref for the lifetime of a long-running server. In-flight work is not
 * shared because its cancellation and progress belong to one dial. */
const MAX_CACHED_AGENT_DERIVATIONS = 32;
const drvCache = new QuickLRU<string, string>({
  maxSize: MAX_CACHED_AGENT_DERIVATIONS,
});

/** Per-dial lifetime hooks required by the local Nix evaluation. */
export interface AgentDrvResolutionOptions {
  /** The owning dial's cancellation. A recheck/destroy must reap the local Nix
   * evaluation before a replacement dial starts. */
  signal: AbortSignal;
  /** Forward evaluation output into the session's liveness and visible progress
   * path while retaining only a bounded private tail for a final error. */
  onProgress: (line: string) => void;
}

function evaluationError(
  message: string,
  result: ExitResult,
  sawNetworkError: boolean,
): Error {
  switch (result.kind) {
    case "exit":
      return sawNetworkError
        ? new Error(message)
        : new ResolveDrvError(message, "remote");
    case "spawn-error":
    case "signal":
      return new ResolveDrvError(message, "remote");
    case "lifetime-expired":
    case "aborted":
      return new Error(message);
  }
}

/**
 * Probe `host`, then evaluate only `packages.<host-system>.<packageName>.drvPath`
 * from `flakeRef`. Host-probe failures remain plain transport errors so the
 * session retries them. Deterministic local Nix failures are terminal build
 * faults; transient fetch and owned-lifetime failures remain retryable.
 */
export async function resolveAgentDrv(
  host: string,
  flakeRef: string,
  packageName: string,
  opts: AgentDrvResolutionOptions,
): Promise<string> {
  const system = await resolveSystem(host);
  const installable = `${flakeRef}#packages.${system}.${packageName}.drvPath`;
  const cached = drvCache.get(installable);
  if (cached !== undefined) return cached;

  const diagnostics: string[] = [];
  let sawNetworkError = false;
  const result = await runCapture(
    "nix",
    ["eval", "--accept-flake-config", "--raw", installable],
    {
      // Evaluating a fresh exact source may fetch and build its Nix graph.
      // Treat it like the other long-running Nix steps: output proves
      // liveness, while a genuinely silent process is retried by the session.
      policy: {
        kind: "progress-liveness",
        silenceMs: PROVISION_STEP_SILENCE_BASE_MS,
      },
      signal: opts.signal,
      onProgress: (line) => {
        sawNetworkError ||= looksLikeNetworkError(line);
        appendProgressLine(diagnostics, line);
        opts.onProgress(line);
      },
    },
  );
  if (!result.ok) {
    const detail =
      diagnostics.length === 0 ? "" : `\n${diagnostics.join("\n")}`;
    const message = `${host}: could not resolve ${packageName} for system=${system} from the baked agent flake: nix eval ${describeExit(result)}${detail}`;
    throw evaluationError(message, result, sawNetworkError);
  }
  const drv = result.stdout.trim();
  if (!drv.endsWith(".drv")) {
    throw new ResolveDrvError(
      `${host}: nix eval returned ${JSON.stringify(drv)}, not a derivation path for ${packageName} on system=${system}`,
      "remote",
    );
  }
  drvCache.set(installable, drv);
  return drv;
}
