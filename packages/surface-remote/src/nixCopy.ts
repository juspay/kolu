/**
 * Target-store provisioning for a remote agent.
 *
 * The preferred model: the caller names one exact source flake and package.
 * The connector has already selected the target system, and one Nix build
 * evaluates, transfers, and realises that installable against the target
 * store. A direct `.drv` remains the lower-level input for callers that
 * already own derivation selection. No pre-built linux closure is smuggled
 * onto a darwin host.
 *
 *   Preamble: the caller passes a `/nix/store/…-agent.drv` path. The
 *      package doesn't care HOW the caller obtained it. Source-based callers
 *      normally use `resolveAgentDrv`; direct-derivation callers are
 *      responsible for selecting the remote's architecture.
 *   1. (Remote, warm) an ASK-ONLY check (#1908 D1a): compute the `.drv`'s
 *      output path(s) LOCALLY on the sender (`nix-store -q --outputs`, no
 *      network), then ask the host, bounded, whether they are already valid
 *      there (`nix-store --check-validity`). Present ⇒ warm hit: refresh the
 *      GC root and short-circuit, skipping the redundant remote-store build.
 *      The check NEVER substitutes (the old fused `--realise` did — the
 *      #1908 wedge). If GC races the check, restoration belongs to the required
 *      step-3 root commit, narrated as provisioning.
 *   2. One `nix build --eval-store auto --store ssh-ng://$host` evaluates
 *      locally, transfers the derivation, and realises it remotely. One Nix
 *      process owns the temporary roots across that whole handoff, so a
 *      concurrent GC cannot collect the just-transferred derivation between
 *      separate copy and build commands. Plain `-v` lets Nix's own transfer and
 *      build lines reach the connect overlay.
 *   3. `ssh $host nix-store --realise $out --add-root $link --indirect`
 *      atomically proves the output still exists (restoring it if possible)
 *      and commits it behind a per-agent GC root on the target, so a
 *      `nix-collect-garbage` there can't delete the agent out from
 *      under a live session (or force a rebuild on the next reconnect).
 *      This command is the provisioning commit point: any failure is returned,
 *      and no agent path escapes unrooted.
 *      See `agentGcRootPath` for the "latest"-link semantics.
 *   Spawn: the output path becomes `agentPath`; the caller then spawns
 *      `ssh $host $agentPath/bin/<binary> --stdio` via the connector.
 *
 * Localhost shortcut: `nix build` and the root commit both target the local store.
 *
 * **Lifetime ownership (#1908 D1b/D1c).** Every child spawns through
 * `process.ts` with a REQUIRED {@link LifetimePolicy}: the quick steps
 * (arch probe and warm check) get a hard `deadline`; the minutes-long build
 * and required root commit get `progress-liveness` (killed only on real silence),
 * with a per-step doubling + kill budget ({@link StepBudget}) the CALLER
 * owns across retries so a healthy slow transfer is never livelocked. A
 * per-dial abort `signal` (recheck's abort-in-flight, R6b) group-kills any
 * in-flight child.
 *
 * **Nix is the contract, not the implementation.** No tarball, Docker,
 * or prebuilt-binary fallback exists or will.
 */

import {
  buildSshProbeCommand,
  forEachLine,
  isLocalHost,
  looksLikeNetworkError,
  nixSshOpts,
} from "./host";
import {
  describeExit,
  type ExitResult,
  type LifetimePolicy,
  runCapture,
} from "./process";

/** Hard deadline for the QUICK ssh/local steps — the arch probe and warm
 *  `check-validity`. A genuine round-trip; generous so a slow link doesn't
 *  false-fail, far short of the 10-minute wedge this bounds. */
export const PROVISION_PROBE_DEADLINE_MS = 30_000;

/** Base progress-silence bound for the minutes-long provisioning step (#1908
 *  R4/C1). nix's stderr is per-path, so one large NAR on a slow link is legitimately
 *  silent for a while — MINUTES-scale, not seconds. Doubles per consecutive expiry
 *  (see {@link StepBudget}). */
export const PROVISION_STEP_SILENCE_BASE_MS = 120_000;

/** How many consecutive `lifetime-expired` kills of the SAME step before it is
 *  genuinely terminal (#1908 R4c/C5). With base 120s and N=4 the last budgeted
 *  silence is 120×2³ = 960s (16 min); the session-level backstop (R8b) sits above
 *  that so R4 always fires first during provisioning. */
export const PROVISION_STEP_MAX_EXPIRIES = 4;

/** A per-step progress-liveness budget (#1908 R4/C5):
 *
 *   - `policy()`       — the current `progress-liveness` policy; `silenceMs = base ×
 *                        2^(consecutive expiries)`, so a genuinely slow path gets more
 *                        room each retry.
 *   - `recordExpiry()` — count one expiry; returns `true` when the budget is EXHAUSTED
 *                        (the step is now genuinely TERMINAL — the caller must fail the
 *                        session, not retry). Doubles the next bound.
 *   - `reset()`        — on step SUCCESS or CAMPAIGN BIRTH.
 *
 *  Terminal-ness is DECOUPLED from the session's `MAX_CONSECUTIVE_FAILURES` give-up
 *  counter: an exhausted budget makes provisioning fail TERMINALLY at once (a
 *  distinct give-up), so a permanently silent provision reaches `failed` in a bounded
 *  number of attempts — NOT the "one `remote` of five" the pre-connected backstop
 *  would otherwise reset before it ever counted (the composed-mechanism hole the
 *  architecture gate caught). */
export interface StepBudget {
  policy(): LifetimePolicy;
  recordExpiry(): boolean;
  reset(): void;
}

/** Build a {@link StepBudget}. `baseMs` doubles per consecutive expiry; `maxExpiries`
 *  is the terminal count. The maximum silence it ever asks for is `base × 2^(maxExpiries
 *  − 1)` (the last non-terminal grant), which MUST stay under the session's pre-connected
 *  backstop bound so the step's own kill always fires first during provisioning — see
 *  `PROVISION_STEP_*` and `DEFAULT_PRE_CONNECTED_LIVENESS_MS`. */
export function makeStepBudget(
  baseMs: number,
  maxExpiries: number,
): StepBudget {
  let expiries = 0;
  return {
    policy: () => ({
      kind: "progress-liveness",
      silenceMs: baseMs * 2 ** expiries,
    }),
    recordExpiry: () => {
      expiries += 1;
      return expiries >= maxExpiries;
    },
    reset: () => {
      expiries = 0;
    },
  };
}

/** The provisioning step budgets fused into ONE value the connector holds: local
 *  evaluation and the atomic transfer/build plus campaign-epoch reconciliation. */
export interface ProvisionBudgets {
  readonly evaluation: StepBudget;
  readonly provisioning: StepBudget;
  /** Reset every step budget when the campaign changes (a fresh episode / user verb).
   *  Idempotent within a campaign — a no-op until `epoch` moves. The connector
   *  (session↔nixCopy bridge) must call this with `ctx.campaignEpoch` before
   *  `provisionAgent` — provisionAgent itself is campaign-ignorant. */
  onCampaign(epoch: number): void;
}

/** Build a {@link ProvisionBudgets}. One construction per connector (persists across a
 *  campaign's retry dials); the campaign reset lives INSIDE it. */
export function makeProvisionBudgets(): ProvisionBudgets {
  const evaluation = makeStepBudget(
    PROVISION_STEP_SILENCE_BASE_MS,
    PROVISION_STEP_MAX_EXPIRIES,
  );
  const provisioning = makeStepBudget(
    PROVISION_STEP_SILENCE_BASE_MS,
    PROVISION_STEP_MAX_EXPIRIES,
  );
  let lastEpoch = -1;
  return {
    evaluation,
    provisioning,
    onCampaign(epoch: number): void {
      // MONOTONIC (F6): reset only on a STRICTLY NEWER campaign. A stale dial N whose
      // `resolveDrvPath` resolved after dial N+1 already began provisioning would
      // otherwise roll `lastEpoch` backwards and ERASE N+1's accumulated expiries,
      // defeating the terminal kill budget. `campaignEpoch` only ever increases
      // (`startEpisode` bumps it), so an epoch `<= lastEpoch` is a superseded dial —
      // ignore it.
      if (epoch <= lastEpoch) return;
      lastEpoch = epoch;
      evaluation.reset();
      provisioning.reset();
    },
  };
}

export interface ProvisionOptions {
  host: string;
  /** The derivation to provision. A direct store derivation is used as-is;
   *  a flake-backed derivation keeps its installable so one `nix build` process
   *  owns evaluation, transfer, and realisation without a GC race. */
  derivation: AgentDerivation;
  onProgress: (line: string) => void;
  /** Fired once immediately before this call's first potentially long required
   *  operation: the cold target build or a warm target's GC-root commit. */
  onProvisioning?: () => void;
  /** The fused per-step progress-liveness budgets (#1908 R4/C5) — CONNECTOR-owned so
   *  their doubling/terminal state persists across a campaign's retries. The connector
   *  reconciles the per-campaign reset (`budgets.onCampaign(ctx.campaignEpoch)`) at the
   *  session↔nixCopy bridge BEFORE calling here, so `provisionAgent` stays campaign-
   *  ignorant — it only reads `policy()` / charges `recordExpiry()`. */
  budgets: ProvisionBudgets;
  /** Per-dial abort (recheck's abort-in-flight, #1908 R6b): aborting group-kills the
   *  in-flight provisioning child and settles the run as `"aborted"` — a retryable,
   *  budget-EXEMPT fault. Threaded into every child. */
  signal?: AbortSignal;
}

const agentDerivationBrand = Symbol("AgentDerivation");

/** A derivation source whose variants make the GC ownership contract explicit.
 *
 * A direct `.drv` caller already owns keeping that store path valid. A flake
 * caller carries both the evaluated path (needed for the warm probe) and the
 * installable that one `nix build` can evaluate and provision as an owned unit.
 * The private symbol makes the sum nominal: callers cannot hand-assemble a
 * mismatched path/installable pair. */
export type AgentDerivation =
  | {
      kind: "drv-path";
      drvPath: string;
      readonly [agentDerivationBrand]: "drv-path";
    }
  | {
      kind: "flake-installable";
      drvPath: string;
      installable: string;
      readonly [agentDerivationBrand]: "flake-installable";
    };

/** Construct the public direct-path arm. The caller owns keeping this path valid. */
export function directAgentDerivation(drvPath: string): AgentDerivation {
  if (!drvPath.endsWith(".drv")) {
    throw new Error(
      `agent derivation must be a .drv store path, got ${JSON.stringify(drvPath)}`,
    );
  }
  return {
    kind: "drv-path",
    drvPath,
    [agentDerivationBrand]: "drv-path",
  };
}

/** Package-internal constructor for the flake arm. Deliberately not re-exported
 * from `@kolu/surface-remote`: only `resolveAgentDrv` may pair these values. */
export function flakeAgentDerivation(
  drvPath: string,
  installable: string,
): AgentDerivation {
  if (!drvPath.endsWith(".drv") || installable.trim().length === 0) {
    throw new Error(
      `invalid flake agent derivation: drvPath=${JSON.stringify(drvPath)}, installable=${JSON.stringify(installable)}`,
    );
  }
  return {
    kind: "flake-installable",
    drvPath,
    installable,
    [agentDerivationBrand]: "flake-installable",
  };
}

export type ProvisionResult =
  | { ok: true; agentPath: string }
  // `cause` lets the session keep retrying a host that went unreachable
  // *mid-provision* (asleep/roaming after the arch probe) instead of burning the
  // give-up budget — while a genuine `"remote"` rejection (`trusted-users`) fails
  // loudly. `terminal` marks a fault that must give up NOW regardless of the retry
  // counter — a budget-EXHAUSTED silent step (decoupled from `MAX_CONSECUTIVE_FAILURES`
  // so the backstop can't reset it away).
  | {
      ok: false;
      reason: string;
      cause: "network" | "remote";
      terminal?: boolean;
    };

/** Per-agent GC-root path for the realised output, or `null` when one
 *  can't be formed (see the localhost case below). Keyed on the .drv's
 *  name with its store hash stripped, so every version of the *same*
 *  agent maps to one fixed symlink: each realise overwrites it, the
 *  previous output drops out of the root set and becomes GC-eligible.
 *
 *  Remote: the path is relative, so it resolves against the ssh login
 *  user's home dir. Local: anchor to this process's `$HOME` explicitly.
 *  If `$HOME` is unset we return `null`; provisioning then fails because
 *  returning an unrooted agent would violate its ownership contract. */
export function agentGcRootPath(
  isLocal: boolean,
  drvPath: string,
): string | null {
  const name = drvPath
    .replace(/^.*\//, "") // drop the /nix/store/ prefix
    .replace(/\.drv$/, "") // drop the .drv suffix
    .replace(/^[0-9a-z]{32}-/, ""); // drop the store hash
  const rel = `.local/state/kolu/surface-remote/gcroots/${name}`;
  if (!isLocal) return rel;
  const home = process.env.HOME;
  return home ? `${home}/${rel}` : null;
}

/** A hard-`deadline` {@link LifetimePolicy} for the QUICK ssh/local steps — the arch
 *  probe and warm `check-validity`. One place so every quick step shares the
 *  "how long a quick nix/ssh round-trip may run" bound (exported so `arch.ts` rides
 *  the same shape rather than re-spelling the literal). */
export function probePolicy(): LifetimePolicy {
  return { kind: "deadline", ms: PROVISION_PROBE_DEADLINE_MS };
}

/** Non-blank store-path lines from a `nix-store` invocation's stdout — reuses the repo's
 *  one `\n`-split-skip-blank helper. */
function parseOutputs(stdout: string): string[] {
  const outputs: string[] = [];
  forEachLine(stdout, (line) => outputs.push(line.trim()));
  return outputs;
}

/** The agent is at `<out>/bin/<binary>`, so the derivation MUST be single-output —
 *  `nix-store -q --outputs` / `--realise` neither name nor order their lines
 *  (`debug`/`dev` can precede `out`), so "the agent output" is only unambiguous at one
 *  output. A multi-output drv fails LOUD (a terminal `remote` config error) rather than
 *  silently picking line 0 (#1908 F7). One place — warm (`-q --outputs`) and cold
 *  (`--realise`) both go through it. (Supporting a multi-output agent by selecting `out`
 *  explicitly is a recorded follow-up; kolu's agent packages are single-output.) */
function multiOutputError(host: string, count: number): ProvisionResult {
  return {
    ok: false,
    reason: `${host}: agent derivation is multi-output (${count} outputs) — only single-output agent derivations are supported`,
    cause: "remote",
  };
}

/** Shape the `ProvisionResult` for a step that went silent and got killed
 *  (`lifetime-expired`) — the shared derivation provisioning uses (#1908
 *  C5). Charges the step's budget: `recordExpiry()` returns `true` when the budget is
 *  EXHAUSTED, making the step GENUINELY TERMINAL (`terminal: true`) so the session gives
 *  up NOW, decoupled from the retry counter — a permanently silent provision can't loop
 *  forever. The `cause` stays honest `"network"` (a silent-then-killed step is a transport
 *  fault); `terminal` is the orthogonal give-up axis the session's gate keys off. */
function expiredResult(
  host: string,
  cmdLabel: string,
  budget: StepBudget,
  res: ExitResult,
): ProvisionResult {
  const terminal = budget.recordExpiry();
  return {
    ok: false,
    reason: `${host}: '${cmdLabel}' ${describeExit(res)}${
      terminal ? " — giving up (silent too many times)" : ""
    }`,
    cause: "network",
    ...(terminal ? { terminal: true } : {}),
  };
}

/** Commit `target` behind the target store's indirect per-agent GC root.
 *
 * `nix-store --realise ... --add-root` makes validity and durable ownership one
 * target-store operation. The preceding warm check/cold build may race a GC,
 * but their unrooted output is never treated as success: this operation either
 * re-establishes the target and its root together or fails the dial. */
async function pinGcRoot(
  host: string,
  target: string,
  rootPath: string,
  onProgress: (line: string) => void,
  budget: StepBudget,
  signal: AbortSignal | undefined,
): Promise<ProvisionResult | null> {
  onProgress(`${host}: pinning GC root at '${rootPath}'…`);
  let sawNetworkError = false;
  const pin = buildSshProbeCommand(
    host,
    "nix-store",
    "--realise",
    target,
    "--add-root",
    rootPath,
    "--indirect",
  );
  const pinRes = await runCapture(pin.command, pin.args, {
    onProgress: (line) => {
      sawNetworkError ||= looksLikeNetworkError(line);
      onProgress(line);
    },
    policy: budget.policy(),
    signal,
  });
  if (pinRes.ok) return null;
  if (pinRes.kind === "lifetime-expired") {
    return expiredResult(
      host,
      "nix-store --realise --add-root",
      budget,
      pinRes,
    );
  }
  const network =
    pinRes.kind === "aborted" ||
    sawNetworkError ||
    (pinRes.kind === "exit" && pinRes.code === 255);
  return {
    ok: false,
    reason: `${host}: could not establish the agent GC root: ${describeExit(pinRes)}`,
    cause: network ? "network" : "remote",
  };
}

/** Realise an agent derivation in `$host`'s store and commit its required GC
 *  root. A flake-backed derivation gives one remote-store `nix build` ownership
 *  of evaluation, transfer, and realisation. Returns the target-store output
 *  path, ready for `ssh $host $agentPath/bin/...`. */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const isLocal = isLocalHost(opts.host);
  const { signal, budgets } = opts;
  const { drvPath } = opts.derivation;
  // Already aborted before we start ⇒ do NO work: a user abort is a budget-EXEMPT,
  // retryable `"network"` fault (C3/F6). (The connector already reconciled the campaign
  // budget reset via `budgets.onCampaign` before calling here — that is monotonic, so a
  // stale/superseded dial can't roll a newer campaign's budget back.)
  if (signal?.aborted) {
    return {
      ok: false,
      reason: `${opts.host}: provisioning aborted before it started`,
      cause: "network",
    };
  }

  // Watch the streamed output for ssh/nix connection errors as it flows by, so a
  // host that went unreachable mid-provision (which exits with Nix's code, not
  // ssh's 255) is still classified `"network"`. We only flip a flag.
  let sawNetworkError = false;
  const scanForNetworkError = (line: string): void => {
    if (looksLikeNetworkError(line)) sawNetworkError = true;
  };
  const onProgress = (line: string): void => {
    scanForNetworkError(line);
    opts.onProgress(line);
  };
  // The warm check's stderr is scanned for the network classification but NOT echoed
  // to the user-visible ring (a cold miss can write a scary line).
  const onProbeProgress = scanForNetworkError;
  // A direct-ssh command surfaces ssh's own 255 on a transport failure. Keys on the
  // EXIT arm's numeric code; an `aborted` (user verb) is RETRYABLE `"network"` — never
  // the bounded `"remote"` default — so a user abort never burns the give-up budget.
  // A `signal`/`spawn-error`/plain non-255 exit falls to the bounded `"remote"`.
  // `lifetime-expired` (our kill) never reaches here: each step intercepts its own kill
  // inline via `expiredResult` (with its budget), before it ever calls `causeFor`.
  const causeFor = (res: ExitResult): "network" | "remote" => {
    if (res.kind === "aborted") return "network";
    return sawNetworkError || (res.kind === "exit" && res.code === 255)
      ? "network"
      : "remote";
  };

  const rootPath = agentGcRootPath(isLocal, drvPath);

  // 1. Warm fast-path (remote only) — the ASK-ONLY check (#1908 D1a). Compute the
  //    output path(s) LOCALLY (no network, instant), then ask the host whether they
  //    are already valid there. A HIT skips the redundant copy/realise. A MISS (or
  //    the local query failing because GC collected the evaluated .drv) falls through
  //    to the full provision. A flake source is re-evaluated inside the provisioning
  //    process, which owns a temporary root across the handoff; a direct drv-path
  //    caller owns keeping its path valid. Localhost never copies, so the fast-path
  //    is remote-only.
  if (!isLocal && rootPath !== null) {
    // One SYNTHESIZED, truthful line at check start (NOT raw nix stderr).
    onProgress(`${opts.host}: checking for a cached agent…`);
    // Local compute of the derivation's output path(s) — no ssh, no substitution.
    const outsRes = await runCapture(
      "nix-store",
      ["-q", "--outputs", drvPath],
      { policy: probePolicy(), signal },
    );
    // `-q --outputs` prints ONE line PER OUTPUT — the agent contract is single-output
    // (see `multiOutputError`), so a >1 result fails loud and a 0 result falls through to
    // the cold provision.
    const outputs = parseOutputs(outsRes.stdout);
    if (outsRes.ok && outputs.length > 1) {
      return multiOutputError(opts.host, outputs.length);
    }
    // The sole output (length ≤ 1 here — the multi-output case already returned), or
    // `undefined` when the local query missed — both fall through to the cold provision.
    const agentPath = outputs[0];
    if (outsRes.ok && agentPath !== undefined) {
      // Ask the host, bounded, whether the output is already valid there. This is a pure
      // store query — it NEVER substitutes (verified: `--check-validity` on an absent path
      // returns non-zero instantly, no fetch).
      const check = buildSshProbeCommand(
        opts.host,
        "nix-store",
        "--check-validity",
        agentPath,
      );
      const checkRes = await runCapture(check.command, check.args, {
        onProgress: onProbeProgress,
        policy: probePolicy(),
        signal,
      });
      if (checkRes.ok) {
        // Warm hit. The shared root operation is the commit point: only a rooted,
        // still-valid target may short-circuit as success.
        opts.onProvisioning?.();
        const bail = await pinGcRoot(
          opts.host,
          agentPath,
          rootPath,
          opts.onProgress,
          budgets.provisioning,
          signal,
        );
        if (bail) return bail;
        budgets.provisioning.reset();
        onProgress(
          `${opts.host}: already provisioned at ${agentPath} — skipped copy`,
        );
        return { ok: true, agentPath };
      }
    }
  }

  // 2. Provision the cold target in ONE Nix process. `--eval-store auto`
  //    keeps flake evaluation in the caller's store while `--store ssh-ng://…`
  //    makes the destination store own transfer and realisation. Nix therefore
  //    carries its temporary roots across the whole evaluation→copy→build
  //    lifetime; there is no command boundary at which remote GC can collect the
  //    transferred derivation. Localhost uses the same installable without the
  //    remote-store split.
  // The cold command establishes its own current transport evidence. Do not let
  // a speculative warm-probe miss poison the classification of this operation.
  sawNetworkError = false;
  opts.onProvisioning?.();
  onProgress(
    isLocal
      ? `localhost: realising '${drvPath}'…`
      : `${opts.host}: provisioning '${drvPath}' on remote…`,
  );
  const installable =
    opts.derivation.kind === "flake-installable"
      ? opts.derivation.installable
      : `${drvPath}^*`;
  const provisionArgs = [
    "-v",
    "build",
    "--accept-flake-config",
    ...(isLocal
      ? []
      : ["--eval-store", "auto", "--store", `ssh-ng://${opts.host}`]),
    "--print-out-paths",
    "--no-link",
    installable,
  ];
  const realiseRes = await runCapture("nix", provisionArgs, {
    onProgress,
    policy: budgets.provisioning.policy(),
    env: isLocal ? undefined : { NIX_SSHOPTS: nixSshOpts() },
    signal,
  });
  if (realiseRes.kind === "lifetime-expired") {
    return expiredResult(
      opts.host,
      "nix build",
      budgets.provisioning,
      realiseRes,
    );
  }
  if (!realiseRes.ok) {
    return {
      ok: false,
      reason: `${opts.host}: 'nix build' ${describeExit(realiseRes)}`,
      cause: causeFor(realiseRes),
    };
  }
  // Same single-output contract as the warm path (see `multiOutputError`): a multi-output
  // realise is ambiguous — fail loud rather than pick the wrong output.
  const outPaths = parseOutputs(realiseRes.stdout);
  if (outPaths.length > 1) {
    return multiOutputError(opts.host, outPaths.length);
  }
  const agentPath = outPaths[0];
  if (agentPath === undefined) {
    return {
      ok: false,
      reason: `${opts.host}: realise returned no output path`,
      // The build ran and returned cleanly but empty — a remote-state anomaly.
      cause: "remote",
    };
  }
  onProgress(`${opts.host}: agent realised at ${agentPath}`);

  // 3. Commit the realised output behind a stable, per-agent GC root. This is
  //    the same required operation as the warm-hit path; provision success
  //    means both "valid" and "durably rooted", never merely "was built".
  if (rootPath === null) {
    return {
      ok: false,
      reason: `${opts.host}: HOME is unset, so the agent GC root path cannot be formed`,
      cause: "remote",
    };
  } else {
    const bail = await pinGcRoot(
      opts.host,
      agentPath,
      rootPath,
      opts.onProgress,
      budgets.provisioning,
      signal,
    );
    if (bail) return bail;
  }

  budgets.provisioning.reset();
  return { ok: true, agentPath };
}
