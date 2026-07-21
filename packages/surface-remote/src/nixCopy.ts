/**
 * `.drv`-copy provisioning for a remote agent.
 *
 * The model: the caller has a *derivation* (`.drv`) — a platform-
 * neutral description of how to build the agent — and ships THAT to
 * the remote, which realises (builds) it for its own architecture. No
 * pre-built linux closure smuggled onto a darwin host.
 *
 *   Preamble: the caller passes a `/nix/store/…-agent.drv` path. The
 *      package doesn't care HOW the caller obtained it; `nix eval --raw
 *      .#packages.<system>.<agent>.drvPath` is the typical recipe
 *      (use `resolveSystem(host)` to get the remote's `<system>` first,
 *      so the derivation is for the *remote's* architecture).
 *   1. (Remote, warm) an ASK-ONLY check (#1908 D1a): compute the `.drv`'s
 *      output path(s) LOCALLY on the sender (`nix-store -q --outputs`, no
 *      network), then ask the host, bounded, whether they are already valid
 *      there (`nix-store --check-validity`). Present ⇒ warm hit: refresh the
 *      GC root and short-circuit, skipping the redundant copy/realise/pin.
 *      The check NEVER substitutes (the old fused `--realise` did — the
 *      #1908 wedge); substitution belongs to step 3, narrated as a build.
 *   2. `nix copy --derivation --to ssh-ng://$host $drvPath` pushes the
 *      .drv (plus its inputs' .drvs and source paths the remote
 *      doesn't have).
 *   3. `ssh $host nix-store --realise $drvPath` builds it on the
 *      remote, returning the output path on the remote's store.
 *   4. `ssh $host nix-store --realise $out --add-root $link --indirect`
 *      pins that output behind a per-agent GC root on the target, so a
 *      `nix-collect-garbage` there can't delete the agent out from
 *      under a live session (or force a rebuild on the next reconnect).
 *      See `agentGcRootPath` for the "latest"-link semantics.
 *   Spawn: the output path becomes `agentPath`; the caller then spawns
 *      `ssh $host $agentPath/bin/<binary> --stdio` via the connector.
 *
 * Localhost shortcut: the .drv is already in the local store, so
 * `nix-store --realise` is a local build. The copy step is a no-op.
 *
 * **Lifetime ownership (#1908 D1b/D1c).** Every child spawns through
 * `process.ts` with a REQUIRED {@link LifetimePolicy}: the quick steps
 * (arch probe, warm check, pin) get a hard `deadline`; the minutes-long
 * `copy`/`build` get `progress-liveness` (killed only on real silence),
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
  isLocalHost,
  looksLikeNetworkError,
  nixSshOpts,
} from "./host";
import {
  describeExit,
  type ExitResult,
  type LifetimePolicy,
  runCapture,
  runProgress,
} from "./process";

/** Hard deadline for the QUICK ssh/local steps — the arch probe, the warm
 *  `check-validity`, the GC-root pin. A genuine round-trip; generous so a slow
 *  link doesn't false-fail, far short of the 10-minute wedge this bounds. */
export const PROVISION_PROBE_DEADLINE_MS = 30_000;

/** Base progress-silence bound for the minutes-long `copy`/`build` steps (#1908
 *  R4/C1). nix's stderr is per-path, so one large NAR on a slow link is legitimately
 *  silent for a while — MINUTES-scale, not seconds. Doubles per consecutive expiry
 *  (see {@link StepBudget}). */
export const PROVISION_STEP_SILENCE_BASE_MS = 120_000;

/** How many consecutive `lifetime-expired` kills of the SAME step before it is
 *  genuinely terminal (#1908 R4c/C5). With base 120s and N=4 the last budgeted
 *  silence is 120×2³ = 960s (16 min); the session-level backstop (R8b) sits above
 *  that so R4 always fires first on a copy/build step. */
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
 *  distinct give-up), so a permanently-silent copy/build reaches `failed` in a bounded
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
 *  backstop bound so the step's own kill always fires first on a copy/build — see
 *  `PROVISION_STEP_*` and `MakeSessionOptions.preConnectedLivenessMs`. */
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

/** The two provisioning step budgets fused into ONE value the connector holds and
 *  `provisionAgent` takes whole (#1908 C5 + the C3 ergonomics fusion): the copy and
 *  build {@link StepBudget}s plus the campaign-epoch reconciliation, so a connector
 *  keeps ONE object and does NO hand-kept `lastCampaignEpoch` bookkeeping. */
export interface ProvisionBudgets {
  readonly copy: StepBudget;
  readonly build: StepBudget;
  /** Reset both step budgets when the campaign changes (a fresh episode / user verb).
   *  Idempotent within a campaign — a no-op until `epoch` moves. Called by
   *  `provisionAgent` at the top of every dial, so the connector needn't track it. */
  onCampaign(epoch: number): void;
}

/** Build a {@link ProvisionBudgets}. One construction per connector (persists across a
 *  campaign's retry dials); the campaign reset lives INSIDE it. */
export function makeProvisionBudgets(): ProvisionBudgets {
  const copy = makeStepBudget(
    PROVISION_STEP_SILENCE_BASE_MS,
    PROVISION_STEP_MAX_EXPIRIES,
  );
  const build = makeStepBudget(
    PROVISION_STEP_SILENCE_BASE_MS,
    PROVISION_STEP_MAX_EXPIRIES,
  );
  let lastEpoch = -1;
  return {
    copy,
    build,
    onCampaign(epoch: number): void {
      if (epoch === lastEpoch) return;
      lastEpoch = epoch;
      copy.reset();
      build.reset();
    },
  };
}

export interface ProvisionOptions {
  host: string;
  /** `KOLU_AGENT_DRV` from the operator — a `/nix/store/…-agent.drv`
   *  path. The derivation is what gets shipped; the realisation
   *  happens on the target host. */
  drvPath: string;
  onProgress: (line: string) => void;
  /** Fired ONCE, on the COLD path, right before `nix copy --derivation` starts —
   *  the moment a real copy actually begins (the warm check has already MISSED). The
   *  connector uses it to advance its phase `probing → copying`. Optional. */
  onCopying?: () => void;
  /** Fired ONCE, on the COLD path, at the copy→realise boundary — right before
   *  `nix-store --realise` starts the BUILD. Advances `copying → building`. Optional. */
  onBuilding?: () => void;
  /** The fused per-step progress-liveness budgets (#1908 R4/C5) — CONNECTOR-owned so
   *  their doubling/terminal state persists across a campaign's retries. `provisionAgent`
   *  reconciles the campaign reset itself via {@link campaignEpoch}. */
  budgets: ProvisionBudgets;
  /** The current campaign generation (from `ctx.campaignEpoch`). `provisionAgent` resets
   *  the budgets when it changes — so the connector holds the budgets and passes the
   *  epoch, doing no reset bookkeeping of its own. */
  campaignEpoch: number;
  /** Per-dial abort (recheck's abort-in-flight, #1908 R6b): aborting group-kills the
   *  in-flight provisioning child and settles the run as `"aborted"` — a retryable,
   *  budget-EXEMPT fault. Threaded into every child. */
  signal?: AbortSignal;
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
 *  user's home dir. Local: anchor to this process's `$HOME` explicitly —
 *  and if `$HOME` is unset we return `null` rather than a cwd-relative
 *  path; the caller then skips the (best-effort) pin. */
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

/** A hard-`deadline` {@link LifetimePolicy} for the quick steps, carrying the
 *  per-dial abort. One place so the probe/pin/check all share it. */
function probePolicy(): LifetimePolicy {
  return { kind: "deadline", ms: PROVISION_PROBE_DEADLINE_MS };
}

/** Pin `target` behind the indirect per-agent GC root at `rootPath` — the SHARED
 *  best-effort step both the warm-HIT path and the cold step-4 use (#1908 R5d: one
 *  pin, one failure semantics). Re-realising an already-valid path is instant and
 *  cannot substitute; a `deadline` expiry here is ALSO non-fatal (the agent still
 *  runs, unpinned). Best-effort throughout. */
async function pinGcRoot(
  host: string,
  target: string,
  rootPath: string,
  onProgress: (line: string) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  onProgress(`${host}: pinning GC root at '${rootPath}'…`);
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
    onProgress,
    policy: probePolicy(),
    signal,
  });
  if (!pinRes.ok) {
    onProgress(
      `${host}: GC-root pin ${describeExit(pinRes)}; agent runs but is unpinned`,
    );
  }
}

/** Ship the `.drv` to `$host` and realise it there. Returns the
 *  output path on the *target* host, ready for
 *  `ssh $host $agentPath/bin/...`. */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const isLocal = isLocalHost(opts.host);
  const { signal, budgets } = opts;
  // Reconcile the campaign reset HERE (not in the connector): a fresh campaign zeroes
  // the step budgets' doubling/terminal state; a retry within the campaign is a no-op.
  budgets.onCampaign(opts.campaignEpoch);

  // Watch the streamed output for ssh/nix connection errors as it flows by, so a
  // host that went unreachable mid-`nix copy` (which exits with nix's code, not
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
  // EXIT arm's numeric code; a `lifetime-expired` (our kill) and an `aborted` (user
  // verb) are RETRYABLE `"network"` — never the bounded `"remote"` default — so a
  // wedged-then-killed step retries and a user abort never burns the give-up budget.
  // A `signal`/`spawn-error`/plain non-255 exit falls to the bounded `"remote"`.
  const causeFor = (res: ExitResult): "network" | "remote" => {
    if (res.kind === "lifetime-expired" || res.kind === "aborted")
      return "network";
    return sawNetworkError || (res.kind === "exit" && res.code === 255)
      ? "network"
      : "remote";
  };

  const rootPath = agentGcRootPath(isLocal, opts.drvPath);

  // 1. Warm fast-path (remote only) — the ASK-ONLY check (#1908 D1a). Compute the
  //    output path(s) LOCALLY (the sender holds the .drv it just resolved; no network,
  //    instant), then ask the host whether they are already valid there. A HIT skips
  //    the redundant copy/realise. A MISS (or the local compute failing — the sender
  //    GC'd the .drv) falls through to the full provision, whose copy fails loudly if
  //    the .drv is genuinely gone (#1908 R5c — the honest replacement for "no
  //    regression"). Localhost never copies, so the fast-path is remote-only.
  if (!isLocal && rootPath !== null) {
    // One SYNTHESIZED, truthful line at check start (NOT raw nix stderr).
    onProgress(`${opts.host}: checking for a cached agent…`);
    // Local compute of the derivation's output path(s) — no ssh, no substitution.
    const outsRes = await runCapture(
      "nix-store",
      ["-q", "--outputs", opts.drvPath],
      { policy: probePolicy(), signal },
    );
    // `-q --outputs` prints ONE line PER OUTPUT (#1908 R5a) — handle the multi-line
    // stdout; a single-output agent drv yields exactly one.
    const outputs = outsRes.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (outsRes.ok && outputs.length > 0) {
      // Ask the host, bounded, whether ALL outputs are already valid there. This is a
      // pure store query — it NEVER substitutes (verified: `--check-validity` on an
      // absent path returns non-zero instantly, no fetch). A partial closure is a miss.
      const check = buildSshProbeCommand(
        opts.host,
        "nix-store",
        "--check-validity",
        ...outputs,
      );
      const checkRes = await runCapture(check.command, check.args, {
        onProgress: onProbeProgress,
        policy: probePolicy(),
        signal,
      });
      if (checkRes.ok) {
        // Warm hit. The primary output is the agent path (the agent drv is
        // single-output; for a multi-output drv this is its first output). Refresh the
        // GC root via the SHARED best-effort pin, then short-circuit.
        const agentPath = outputs[0]!;
        await pinGcRoot(
          opts.host,
          agentPath,
          rootPath,
          opts.onProgress,
          signal,
        );
        onProgress(
          `${opts.host}: already provisioned at ${agentPath} — skipped copy`,
        );
        return { ok: true, agentPath };
      }
    }
  }

  // 2. Copy the .drv (and its build-inputs) to the remote. Skipped for localhost.
  if (!isLocal) {
    // The warm check MISSED (cold path) — signal the `probing → copying` boundary.
    opts.onCopying?.();
    onProgress(`${opts.host}: copying derivation '${opts.drvPath}'…`);
    const copyRes = await runProgress(
      "nix",
      [
        "copy",
        "--no-check-sigs",
        "--derivation",
        "--to",
        `ssh-ng://${opts.host}`,
        opts.drvPath,
      ],
      {
        onProgress,
        // The copy is a transfer that can sit idle for minutes; progress-liveness kills
        // it only on real silence (#1908 R4). The ssh nix forks internally rides the
        // shared master + dead-peer keepalive via NIX_SSHOPTS.
        policy: budgets.copy.policy(),
        env: { NIX_SSHOPTS: nixSshOpts() },
        signal,
      },
    );
    if (copyRes.kind === "lifetime-expired") {
      // A silent copy — killed. Retryable (`network`) UNLESS the per-step budget is
      // exhausted, in which case the step is GENUINELY TERMINAL (`terminal: true`, #1908
      // C5) — the session gives up NOW, decoupled from the retry counter, so a
      // permanently-silent copy can't loop forever.
      const terminal = budgets.copy.recordExpiry();
      return {
        ok: false,
        reason: `${opts.host}: 'nix copy --derivation' ${describeExit(copyRes)}${
          terminal ? " — giving up (silent too many times)" : ""
        }`,
        // A silent-then-killed step is a transport fault (`network`); the `terminal` flag
        // is the give-up axis, orthogonal to `cause`. The session's give-up gate keys off
        // `terminal` directly, so the cause stays honest.
        cause: "network",
        ...(terminal ? { terminal: true } : {}),
      };
    }
    if (!copyRes.ok) {
      return {
        ok: false,
        reason: `${opts.host}: 'nix copy --derivation' ${describeExit(copyRes)}`,
        cause: causeFor(copyRes),
      };
    }
    budgets.copy.reset(); // success clears the doubling
    onProgress(`${opts.host}: derivation copy complete`);
    // The copy reached the host, so it's provably reachable *now* — clear any network
    // flag a speculative check blip set, so a later genuine *remote* realise failure
    // isn't misclassified `"network"`.
    sawNetworkError = false;
  }

  // 3. Realise (build) the .drv on the target — the minutes-long compile. Signal the
  //    `copying → building` boundary (cold path only; a warm host returned at step 1).
  opts.onBuilding?.();
  onProgress(
    isLocal
      ? `localhost: realising '${opts.drvPath}'…`
      : `${opts.host}: realising '${opts.drvPath}' on remote…`,
  );
  const build = buildSshProbeCommand(
    opts.host,
    "nix-store",
    "--realise",
    opts.drvPath,
  );
  const realiseRes = await runCapture(build.command, build.args, {
    onProgress,
    policy: budgets.build.policy(),
    signal,
  });
  if (realiseRes.kind === "lifetime-expired") {
    const terminal = budgets.build.recordExpiry();
    return {
      ok: false,
      reason: `${opts.host}: 'nix-store --realise' ${describeExit(realiseRes)}${
        terminal ? " — giving up (silent too many times)" : ""
      }`,
      // A silent-then-killed step is a transport fault (`network`); the `terminal` flag
      // is the give-up axis, orthogonal to `cause`. The session's give-up gate keys off
      // `terminal` directly, so the cause stays honest.
      cause: "network",
      ...(terminal ? { terminal: true } : {}),
    };
  }
  if (!realiseRes.ok) {
    return {
      ok: false,
      reason: `${opts.host}: 'nix-store --realise' ${describeExit(realiseRes)}`,
      cause: causeFor(realiseRes),
    };
  }
  budgets.build.reset();
  // `--realise` prints one line per output; the primary is the agent path.
  const agentPath = realiseRes.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (agentPath === undefined) {
    return {
      ok: false,
      reason: `${opts.host}: realise returned no output path`,
      // The build ran and returned cleanly but empty — a remote-state anomaly.
      cause: "remote",
    };
  }
  onProgress(`${opts.host}: agent realised at ${agentPath}`);

  // 4. Pin the realised output behind a stable, per-agent GC root — the SHARED
  //    best-effort pin (same as the warm-hit path). If the root path can't be formed
  //    (local $HOME unset) we warn and continue.
  if (rootPath === null) {
    opts.onProgress(
      `${opts.host}: HOME unset, can't place a GC root; agent runs but is unpinned`,
    );
  } else {
    await pinGcRoot(opts.host, agentPath, rootPath, opts.onProgress, signal);
  }

  return { ok: true, agentPath };
}
