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
import { probePolicy, PROVISION_STEP_SILENCE_BASE_MS } from "./nixCopy";
import { describeExit, type ExitResult, runCapture } from "./process";
import { appendProgressLine } from "./progressTail";
import agentEnv from "../agent-env.json" with { type: "json" };
import QuickLRU from "quick-lru";
import { match, P } from "ts-pattern";

/** The framework-owned wrapper boundary for an agent source flake. */
export const SURFACE_AGENT_FLAKE_REF_ENV = agentEnv.flakeRef;

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
  return match(result)
    .with({ kind: "exit" }, () =>
      sawNetworkError
        ? new Error(message)
        : new ResolveDrvError(message, "remote"),
    )
    .with({ kind: P.union("spawn-error", "signal") }, () => {
      // These are local resource/setup faults, not transport facts. Retrying a
      // missing executable or externally OOM-killed evaluator inside the host
      // reconnect loop would respawn the same failure indefinitely; keep it
      // terminal until an explicit recheck or a new process starts a campaign.
      return new ResolveDrvError(message, "remote");
    })
    .with(
      { kind: P.union("lifetime-expired", "aborted") },
      () => new Error(message),
    )
    .exhaustive();
}

/** A successful cache entry is only a hint: `.drv` paths are not GC roots.
 * Check the local store before reuse so garbage collection evicts the hint and
 * the exact flake is evaluated again instead of returning a permanently dead
 * path. */
async function cachedDrvIsValid(
  drv: string,
  opts: AgentDrvResolutionOptions,
): Promise<boolean> {
  const result = await runCapture("nix-store", ["--check-validity", drv], {
    policy: probePolicy(),
    signal: opts.signal,
  });
  if (result.ok) return true;
  if (result.kind === "exit") return false;
  throw evaluationError(
    `could not validate cached agent derivation ${drv}: nix-store ${describeExit(result)}`,
    result,
    false,
  );
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
  if (cached !== undefined) {
    if (await cachedDrvIsValid(cached, opts)) return cached;
    drvCache.delete(installable);
  }

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
