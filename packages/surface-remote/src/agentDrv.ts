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
import { ResolveDrvError } from "./host";
import type { SshKeepalive } from "./keepalive";
import {
  type AgentBinaryCache,
  readBakedBinaryCache,
} from "./agentBinaryCache";
import { type AgentDerivation, flakeAgentDerivation } from "./agentDerivation";
import type { StepBudget } from "./nixCopy";
import { describeNixRunWithDetail, resolverErrorOf, runNix } from "./nixLog";
import agentEnv from "../agent-env.json" with { type: "json" };
import { err, ok, type Result } from "neverthrow";
import QuickLRU from "quick-lru";

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

/** Evaluated output paths, keyed by installable — the same bounded,
 *  success-only memo as {@link drvCache}, and as safe: a caller hands
 *  {@link resolveFlakeOutPath} a LOCKED ref, whose output never changes. */
const outPathCache = new QuickLRU<string, string>({
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
  /** Every stderr line of the evaluation, narrated or not — the owner's silence
   *  watchdog's liveness (see `ProvisionOptions.onActivity`). */
  onActivity: () => void;
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

  opts.onEvaluation();
  const result = await runLocalEvaluation(
    ["nix", "eval", "--accept-flake-config", "--raw", `${installable}.drvPath`],
    `${host}: could not resolve ${packageName} for system=${system} from the baked agent flake: nix eval failed`,
    opts,
  );
  const drv = result.trim();
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
  drvCache.set(installable, derivation);
  return derivation;
}

/** The lifetime hooks of a LOCAL flake evaluation (`nix eval`, `nix flake
 *  metadata`): the same contract `resolveAgentDrv` runs its evaluation under. */
export interface FlakeEvaluationOptions {
  /** Narrated evaluation output (a bounded tail is kept for the error). */
  onProgress: (line: string) => void;
  /** Every stderr line — the owner's silence watchdog's liveness. */
  onActivity: () => void;
  /** The progress-liveness budget: an evaluation may fetch its inputs'
   *  sources for minutes, so output proves liveness and only silence kills. */
  budget: StepBudget;
  signal?: AbortSignal;
}

/** Run one LOCAL Nix evaluation command under `opts.budget`'s progress
 *  liveness, and answer its stdout — or throw the classified fault: Nix's own
 *  root error and its detail after `what`, a budget-exhausting silence as
 *  {@link AgentResolutionExhaustedError}, deterministic failures as a
 *  non-retryable `ResolveDrvError`, transient ones as a plain `Error`
 *  (`resolverErrorOf`). The ONE evaluator of this package: `resolveAgentDrv`,
 *  {@link lockFlake} and {@link resolveFlakeOutPath} all run through it. */
async function runLocalEvaluation(
  argv: readonly [string, ...string[]],
  what: string,
  opts: FlakeEvaluationOptions,
): Promise<string> {
  const result = await runNix("localhost", argv, {
    // Evaluating a fresh exact source may fetch and build its Nix graph.
    // Treat it like the other long-running Nix steps: output proves
    // liveness, while a genuinely silent process is retried by its owner.
    policy: opts.budget.policy(),
    onActivity: opts.onActivity,
    signal: opts.signal,
    narrate: opts.onProgress,
  });
  if (!result.ok) {
    // Nix's own root error, then its detail (an evaluation trace, or a failed
    // fetch's last log lines) — never a scrolled tail of whatever came last.
    const message = `${what}: ${describeNixRunWithDetail(result)}`;
    if (result.kind === "lifetime-expired") {
      throw opts.budget.recordExpiry()
        ? new AgentResolutionExhaustedError(
            `${message} — giving up (silent too many times)`,
          )
        : new Error(message);
    }
    throw resolverErrorOf(message, result);
  }
  opts.budget.reset();
  return result.stdout;
}

/** Lock `flakeRef` NOW (`nix flake metadata --refresh`): the locked
 *  reference — `github:owner/repo/<rev>?narHash=…` — that every later
 *  evaluation of one run names, so they all see the same revision. Throws the
 *  classified fault (see {@link FlakeEvaluationOptions}). */
export async function lockFlake(
  flakeRef: string,
  opts: FlakeEvaluationOptions,
): Promise<string> {
  const stdout = await runLocalEvaluation(
    [
      "nix",
      "flake",
      "metadata",
      "--refresh",
      "--json",
      "--accept-flake-config",
      flakeRef,
    ],
    `could not lock ${flakeRef}: nix flake metadata failed`,
    opts,
  );
  const url = (JSON.parse(stdout) as { url?: unknown }).url;
  if (typeof url !== "string" || url === "")
    throw new ResolveDrvError(
      `nix flake metadata ${flakeRef} named no locked url`,
      { kind: "unavailable", failureCause: "remote", terminal: false },
    );
  return url;
}

/** The OUTPUT path of `packages.<system>.<packageName>` at `flakeRef` — the
 *  path a binary cache serves and `deliverClosure` delivers — evaluated
 *  locally, never built. `system` is a host's own (`resolveSystem`). */
export async function resolveFlakeOutPath(
  flakeRef: string,
  system: string,
  packageName: string,
  opts: FlakeEvaluationOptions,
): Promise<string> {
  const installable = `${flakeRef}#packages.${system}.${packageName}`;
  const cached = outPathCache.get(installable);
  if (cached !== undefined) return cached;
  const out = (
    await runLocalEvaluation(
      [
        "nix",
        "eval",
        "--accept-flake-config",
        "--raw",
        `${installable}.outPath`,
      ],
      `could not resolve ${packageName} for system=${system} from ${flakeRef}: nix eval failed`,
      opts,
    )
  ).trim();
  if (!out.startsWith("/nix/store/"))
    throw new ResolveDrvError(
      `nix eval returned ${JSON.stringify(out)}, not a store path for ${packageName} on system=${system}`,
      { kind: "unavailable", failureCause: "remote", terminal: false },
    );
  outPathCache.set(installable, out);
  return out;
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
