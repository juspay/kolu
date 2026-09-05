/**
 * Resolve the exact agent derivation a remote host needs from the source flake
 * baked into a caller's Nix wrapper.
 *
 * The source ref is cheap to bake: unlike a `{ system → .drv }` map, it does not
 * evaluate every supported platform while `nix run .` is deciding what to run.
 * The first remote dial probes that host's Nix system, evaluates only the matching
 * package's `.drvPath`, then returns it together with the package installable.
 * Provisioning passes that installable to one `nix build` process, which owns
 * evaluation, transfer, and remote realisation as one lifetime.
 */

import { resolveSystem } from "./arch";
import { looksLikeNetworkError, ResolveDrvError } from "./host";
import type { SshKeepalive } from "./keepalive";
import {
  type AgentBinaryCache,
  readBakedBinaryCache,
} from "./agentBinaryCache";
import { type AgentDerivation, flakeAgentDerivation } from "./agentDerivation";
import type { StepBudget } from "./nixCopy";
import { describeExit, type ExitResult, runCapture } from "./process";
import { appendProgressLine } from "./progressTail";
import agentEnv from "../agent-env.json" with { type: "json" };
import { err, ok, type Result } from "neverthrow";
import QuickLRU from "quick-lru";
import { match, P } from "ts-pattern";

/** The framework-owned wrapper boundary for an agent source flake. */
export const SURFACE_AGENT_FLAKE_REF_ENV = agentEnv.flakeRef;

/** The wrapper-baked source is absent. Typed so a long-lived consumer can
 * project the framework fault into its own entry vocabulary without reading or
 * re-parsing the environment handoff itself. */
export class AgentSourceUnbakedError extends ResolveDrvError {
  constructor() {
    super(
      `${SURFACE_AGENT_FLAKE_REF_ENV} is not set — remote agents need the source flake baked into the build. Run the agent client from its Nix wrapper.`,
      {
        kind: "source-unbaked",
        failureCause: "remote",
        terminal: false,
      },
    );
    this.name = "AgentSourceUnbakedError";
  }
}

/** Read the exact source flake baked by the Nix wrapper. This is the sole
 * process-environment adapter for the Surface Remote provisioning stack. */
export function readBakedAgentSource(): Result<
  string,
  AgentSourceUnbakedError
> {
  const flakeRef = process.env[SURFACE_AGENT_FLAKE_REF_ENV]?.trim();
  return flakeRef ? ok(flakeRef) : err(new AgentSourceUnbakedError());
}

/** A silent evaluation exhausted its connector-owned campaign budget. Its
 * transport cause remains honest (`network`), while terminality is a separate
 * fact the connector must carry into the session immediately. */
export class AgentResolutionExhaustedError extends ResolveDrvError {
  constructor(message: string) {
    super(message, {
      kind: "network-exhausted",
      failureCause: "network",
      terminal: true,
    });
    this.name = "AgentResolutionExhaustedError";
  }
}

/** Bound the shared successful-value cache so repeated exact-source upgrades
 * cannot retain every old store ref for the lifetime of a long-running
 * consumer. In-flight work is not shared because its cancellation and progress
 * belong to one dial. */
const MAX_CACHED_AGENT_DERIVATIONS = 32;
const drvCache = new QuickLRU<string, AgentDerivation>({
  maxSize: MAX_CACHED_AGENT_DERIVATIONS,
});

/** Successfully-read sidecars, keyed by source ref. The read has to stay AHEAD
 *  of the ssh probe (see `resolveAgentDrv`), but the value it produces is
 *  immutable for a given ref — a baked ref is a content-addressed store path —
 *  so re-reading it per dial buys nothing and costs something real: a dial that
 *  `drvCache` would have answered instantly could be failed by a transient read
 *  error (a permissions blip, a concurrent rebuild) on a sidecar already proven
 *  good. Only SUCCESSES are remembered, so a genuinely broken source keeps
 *  failing and a repaired one is picked up. */
const sidecarCache = new Map<string, AgentBinaryCache>();

/** The read, once per source ref per process. Throws the typed fault, like the
 *  uncached read it wraps. */
function readBakedBinaryCacheOnce(flakeRef: string): AgentBinaryCache {
  const remembered = sidecarCache.get(flakeRef);
  if (remembered !== undefined) return remembered;
  const result = readBakedBinaryCache(flakeRef);
  if (result.isErr()) throw result.error;
  sidecarCache.set(flakeRef, result.value);
  return result.value;
}

/** Per-dial lifetime hooks required by the local Nix evaluation. */
export interface AgentDrvResolutionOptions {
  /** The owning dial's cancellation. A recheck/destroy must reap the local Nix
   * evaluation before a replacement dial starts. */
  signal: AbortSignal;
  /** Forward evaluation output into the session's liveness and visible progress
   * path while retaining only a bounded private tail for a final error. */
  onProgress: (line: string) => void;
  /** Advance the owning connector into its long-running provisioning phase
   * immediately before an uncached Nix evaluation starts. */
  onEvaluation: () => void;
  /** Connector-owned campaign budget for the local Nix evaluation. */
  budget: StepBudget;
  /** The owning dial's ssh dead-peer policy, forwarded to this resolver's ONE
   *  ssh — the {@link resolveSystem} arch probe. (The Nix `eval` below is local;
   *  it opens no ssh.)
   *
   *  REQUIRED, with no default: this is an INTERNAL seam (the connector is its
   *  only caller), and every ssh of one dial must carry the SAME policy — they
   *  share a `ControlMaster` keyed by it. A forgotten thread is a compile error
   *  here rather than a silently-second warm master at the default policy. */
  keepalive: SshKeepalive;
}

/** Stable capability exposed to a source resolver. The connector owns the
 * retry policy and binds it behind this operation; consumers choose only the
 * exact source and package they need. */
export interface AgentResolutionContext {
  resolveAgentDrv(
    flakeRef: string,
    packageName: string,
  ): Promise<AgentDerivation>;
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
        : new ResolveDrvError(message, {
            kind: "unavailable",
            failureCause: "remote",
            terminal: false,
          }),
    )
    .with({ kind: P.union("spawn-error", "output-error", "signal") }, () => {
      // These are local resource/setup faults, not transport facts. Retrying a
      // missing executable or externally OOM-killed evaluator inside the host
      // reconnect loop would respawn the same failure indefinitely; keep it
      // terminal until an explicit recheck or a new process starts a campaign.
      return new ResolveDrvError(message, {
        kind: "unavailable",
        failureCause: "remote",
        terminal: false,
      });
    })
    .with(
      { kind: P.union("lifetime-expired", "aborted") },
      () => new Error(message),
    )
    .exhaustive();
}

/**
 * Probe `host`, then resolve only `packages.<host-system>.<packageName>` from
 * `flakeRef` as a flake-backed {@link AgentDerivation}. Host-probe failures remain plain transport errors so the
 * session retries them. Deterministic local Nix failures are terminal build
 * faults; transient fetch and owned-lifetime failures remain retryable.
 */
export async function resolveAgentDrv(
  host: string,
  flakeRef: string,
  packageName: string,
  opts: AgentDrvResolutionOptions,
): Promise<AgentDerivation> {
  // The binary-cache declaration is part of the derivation's identity
  // (provisioning prefetches against it), so read it FIRST — before the ssh
  // arch probe and before any Nix evaluation. A pre-contract wrapper then
  // fails typed and instant, and its DETERMINISTIC local fault always wins the
  // race against a NONDETERMINISTIC network one: read it after `resolveSystem`
  // and an unreachable/unauthorised host reports `auth-required` /
  // `host-key-unverified` / `nix-unavailable` for a binder that would have
  // failed the same way on a perfectly healthy host. The throw sits at this
  // function's existing classification boundary, like every other one here.
  const binaryCache = readBakedBinaryCacheOnce(flakeRef);

  const system = await resolveSystem(host, {
    signal: opts.signal,
    onProgress: opts.onProgress,
    keepalive: opts.keepalive,
  });
  const installable = `${flakeRef}#packages.${system}.${packageName}`;
  const cached = drvCache.get(installable);
  if (cached !== undefined) {
    opts.budget.reset();
    return cached;
  }

  const diagnostics: string[] = [];
  let sawNetworkError = false;
  opts.onEvaluation();
  const result = await runCapture(
    "nix",
    ["eval", "--accept-flake-config", "--raw", `${installable}.drvPath`],
    {
      // Evaluating a fresh exact source may fetch and build its Nix graph.
      // Treat it like the other long-running Nix steps: output proves
      // liveness, while a genuinely silent process is retried by the session.
      policy: opts.budget.policy(),
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
    if (result.kind === "lifetime-expired") {
      throw opts.budget.recordExpiry()
        ? new AgentResolutionExhaustedError(
            `${message} — giving up (silent too many times)`,
          )
        : new Error(message);
    }
    throw evaluationError(message, result, sawNetworkError);
  }
  const drv = result.stdout.trim();
  if (!drv.endsWith(".drv")) {
    throw new ResolveDrvError(
      `${host}: nix eval returned ${JSON.stringify(drv)}, not a derivation path for ${packageName} on system=${system}`,
      {
        kind: "unavailable",
        failureCause: "remote",
        terminal: false,
      },
    );
  }
  const derivation = flakeAgentDerivation(drv, installable, binaryCache);
  opts.budget.reset();
  drvCache.set(installable, derivation);
  return derivation;
}

/** Resolve a package from the wrapper-baked source at the owning dial boundary. */
export function resolveBakedAgentDrv(
  packageName: string,
  ctx: AgentResolutionContext,
): Promise<AgentDerivation> {
  const source = readBakedAgentSource();
  return source.isErr()
    ? Promise.reject(source.error)
    : ctx.resolveAgentDrv(source.value, packageName);
}
