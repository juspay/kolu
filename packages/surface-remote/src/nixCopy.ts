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
 *
 * The steps below are numbered in EXECUTION order — the order a reader of
 * `provisionAgent` meets them, and the order the in-body comments cite:
 *
 *   0. Compute the `.drv`'s output path(s) LOCALLY on the sender (`nix-store
 *      -q --outputs`, no network, no substitution). Two consumers: step 1 asks
 *      the host about this exact path, and step 2 names it to `nix copy`. A
 *      failed query leaves it unknown and steps 1–3 fall through to step 4.
 *   1. (Remote, warm) an ASK-ONLY check (#1908 D1a): ask the host, bounded,
 *      whether the output is already valid there (`nix-store
 *      --check-validity`). Present ⇒ warm hit: refresh the GC root and
 *      short-circuit, skipping the redundant remote-store build. The check
 *      NEVER substitutes (the old fused `--realise` did — the #1908 wedge). If
 *      GC races the check, restoration belongs to the required step-5 root
 *      commit, narrated as provisioning.
 *   2. Cache prefetch: `nix copy --from <declared cache>` pulls the agent's
 *      output closure into the sender's LOCAL store — the one seat where the
 *      derivation's REQUIRED `binaryCache` can act (a remote realisation
 *      substitutes per the REMOTE daemon's own nix.conf; client settings never
 *      participate). A miss/refusal narrates and falls back.
 *   3. Ship: `nix copy --to ssh-ng://$host <out>` moves the locally-valid
 *      closure to the target — step 4's build would NOT (it copies only the
 *      .drv closure; locally-valid outputs are never consulted, verified
 *      live). Lands cross-arch (fetching/copying executes nothing); the
 *      remote daemon must trust the ssh user or the NAR signatures — a
 *      refusal narrates the real levers and step 4 realises on the host.
 *      Runs only when the closure is provably valid LOCALLY (step 2 delivered
 *      it, or a warm binder store already had it) — shipping a path we do not
 *      have would narrate trust levers for a failure about neither.
 *   4. One `nix build --eval-store auto --store ssh-ng://$host` evaluates
 *      locally, transfers the derivation, and realises it remotely. One Nix
 *      process owns the temporary roots across that whole handoff, so a
 *      concurrent GC cannot collect the just-transferred derivation between
 *      separate copy and build commands. Plain `-v` lets Nix's own transfer and
 *      build lines reach the connect overlay.
 *   5. `ssh $host nix-store --realise $out --add-root $link --indirect`
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

import type { AgentBinaryCache } from "./agentBinaryCache";
import type { AgentDerivation } from "./agentDerivation";
import {
  buildSshProbeCommand,
  forEachLine,
  isLocalHost,
  looksLikeNetworkError,
  nixSshOpts,
} from "./host";
import type { SshKeepalive } from "./keepalive";
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

/** Progress-silence bound for the SPECULATIVE closure copies (steps 2 and 3).
 *  FIXED, never escalating: those steps charge no expiry, so they must not
 *  inherit the required build's DOUBLED allowance. `StepBudget.policy()` returns
 *  `base × 2^expiries` precisely because `recordExpiry()` charged the previous
 *  silence — a step that takes the first half without the second would let a
 *  dead cache endpoint wedge provisioning for the build's escalated window (up
 *  to 16 min) while advancing nothing.
 *
 *  Deliberately LOOSER than the build's base, because the two ways to be wrong
 *  are not symmetric. Too generous costs a slow dial against a dead endpoint —
 *  the user waits, then the fallback runs. Too tight kills a HEALTHY transfer
 *  and narrates it as a miss, so the host compiles from source: the precise
 *  outcome this feature exists to prevent, produced by a timeout rather than a
 *  real miss. `nix copy` reports per PATH, so one large NAR (kolu's own closure
 *  carries a ~200 MB path) is legitimately quiet for minutes on a slow uplink
 *  even with `-v`. Bound the dead endpoint, not the slow one. */
export const PROVISION_COPY_SILENCE_MS = 600_000;

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
 *  `PROVISION_STEP_*` and `DEFAULT_PRE_CONNECTED_LIVENESS_MS`.
 *
 *  RATIFIED hand-rolled (juspay/kolu#2101): this budget is SINGLE-CLASS — its one
 *  `recordExpiry` and its one ceiling share the one predicate by construction, so the
 *  conflated-counter disease is already unrepresentable here, and folding in the
 *  progress-policy + campaign-epoch machinery would buy no impossibility. Reach for
 *  `@kolu/surface`'s `makeFailureLedger` when a budget has MORE THAN ONE failure class. */
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
  /** The owning dial's ssh dead-peer policy, threaded into EVERY ssh this
   *  provisioning causes: the warm validity check, the GC-root pin, the closure
   *  ship, and — via `NIX_SSHOPTS` — the ssh that the remote-store `nix
   *  build`/`nix copy` fork internally, which is otherwise entirely out of reach
   *  of our argv. A provisioning step is where a long CI lane is most exposed to
   *  a network blip: a cold build can sit idle for minutes while the far end
   *  compiles.
   *
   *  REQUIRED, with no default. Every ssh of one dial must carry the SAME policy
   *  — they share a `ControlMaster` keyed by it — so a forgotten thread is a
   *  compile error rather than a second warm master opened at the default while
   *  the dial asked for something else. The only caller in this repo is
   *  `sshConnector`, which resolves the default once at its own public edge;
   *  state `DEFAULT_SSH_KEEPALIVE` explicitly if you call this directly. */
  keepalive: SshKeepalive;
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

/** The progress-liveness policy the two SPECULATIVE copies run under — their
 *  own bound, not a slice of the required build's escalating budget. See
 *  {@link PROVISION_COPY_SILENCE_MS}. */
function copyPolicy(): LifetimePolicy {
  return { kind: "progress-liveness", silenceMs: PROVISION_COPY_SILENCE_MS };
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
  keepalive: SshKeepalive,
  target: string,
  rootPath: string,
  onProgress: (line: string) => void,
  budget: StepBudget,
  signal: AbortSignal | undefined,
): Promise<ProvisionResult | null> {
  onProgress(`${host}: pinning GC root at '${rootPath}'…`);
  let sawNetworkError = false;
  const pin = buildSshProbeCommand(
    { host, keepalive },
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

/** What ONE speculative closure-move step concluded.
 *
 *  A NAMED outcome, not an inverted boolean: the caller has to distinguish
 *  three cases, and two of them matter downstream. `"delivered"` means the
 *  closure is now VALID in that step's destination store — the fact the ship
 *  keys off, and the fact a future "ship succeeded, skip the cold build"
 *  optimisation would key off. `"missed"` means the step concluded without it
 *  (a cache that did not have it, a refusal, a silence kill), which is
 *  narrated and never fatal. `"aborted"` means the dial's own signal fired and
 *  the caller settles the standard aborted result. */
type CopyOutcome = "delivered" | "missed" | "aborted";

/** The ONE shape of "the user's abort landed inside this provisioning step" —
 *  named per step, so an abort during the slow ship can never report the
 *  prefetch it had already finished. */
function abortedDuring(host: string, step: string): ProvisionResult {
  return {
    ok: false,
    reason: `${host}: provisioning aborted during ${step}`,
    cause: "network",
  };
}

/** Prefetch `outPath`'s closure from the derivation's declared caches into the
 *  binder's LOCAL store — the seat where the declaration can act (see
 *  `AgentBinaryCache`). Tries each substituter in order until one delivers;
 *  `"delivered"` means the closure is now VALID LOCALLY (freshly copied or
 *  already present — `nix copy` is validity-driven).
 *
 *  This step is OPTIONAL-BY-OUTCOME, never silently optional: a miss (the
 *  commit was just built and not yet pushed), a signature refusal (the local
 *  daemon does not trust the declared key and the user is untrusted), or a
 *  silence kill each NARRATE into the progress tail and fall back to the cold
 *  build's source realisation — the same truth as before this step existed.
 *  It therefore charges no budget expiry (the required build below owns the
 *  terminal accounting).
 *
 *  It fills the LOCAL store and has nothing to say to any host, so it takes a
 *  pre-bound `narrate` rather than the target's name: the progress prefix is
 *  the caller's concern.
 *
 *  WHY a per-URL `nix copy --from` loop, and not one
 *  `nix build --max-jobs 0 --substituters "<all>"` letting Nix own the
 *  ordering: `substituters` is a TRUSTED setting. Nix honors a client-supplied
 *  one only when the caller is in `trusted-users` or the URL is already in
 *  `trusted-substituters` — otherwise it is silently dropped and the build
 *  queries the daemon's own list instead, which is exactly the configuration
 *  this whole feature exists to stop depending on. `--from` names a store to
 *  read directly rather than proposing a substituter, so it is not subject to
 *  that filter (verified: a `--from` copy fetched a path from a cache absent
 *  from the local `substituters`). The loop is the price of naming each store
 *  ourselves. */
async function prefetchAgentClosure(opts: {
  outPath: string;
  binaryCache: AgentBinaryCache;
  /** The dial's dead-peer policy, for the ssh Nix MAY fork here. A declared
   *  substituter is usually `https://`, which needs none of this — but
   *  `agentBinaryCache` validates substituters only as non-blank strings and
   *  deliberately restricts no scheme, so `ssh://` / `ssh-ng://` is a spellable
   *  declared cache. Without `NIX_SSHOPTS` that fork gets NO dead-peer detection
   *  at all: the exact eternal hang `sshOptPairs` exists to bound, in the one
   *  provisioning step that had been left out of the policy. */
  keepalive: SshKeepalive;
  narrate: (line: string) => void;
  policy: LifetimePolicy;
  signal: AbortSignal | undefined;
}): Promise<CopyOutcome> {
  const keys = opts.binaryCache.trustedPublicKeys.join(" ");
  for (const url of opts.binaryCache.substituters) {
    opts.narrate(`prefetching agent closure from ${url} into the local store…`);
    const res = await runCapture(
      "nix",
      // `-v` for the same reason the cold build passes it: stderr is a pipe, so
      // without it nix reports nothing per path and a healthy transfer reads as
      // silence to the liveness policy. `--extra-trusted-public-keys` lets a
      // trusted local user import the declared cache's signatures without a
      // nix.conf edit; for an untrusted user nix's own refusal line lands in the
      // tail and we fall back.
      [
        "-v",
        "copy",
        "--from",
        url,
        "--extra-trusted-public-keys",
        keys,
        opts.outPath,
      ],
      {
        onProgress: opts.narrate,
        policy: opts.policy,
        env: { NIX_SSHOPTS: nixSshOpts(opts.keepalive) },
        signal: opts.signal,
      },
    );
    if (res.ok) {
      opts.narrate(`agent closure available locally (via ${url})`);
      return "delivered";
    }
    if (res.kind === "aborted") return "aborted";
    // Per-URL: state only what this URL did. The give-up verdict belongs
    // AFTER the loop — another declared cache may still deliver, and
    // announcing a fall back to source before trying it is simply false.
    opts.narrate(`no agent closure at ${url} (${describeExit(res)})`);
  }
  opts.narrate(
    "no declared cache had the agent closure — realising from source instead",
  );
  return "missed";
}

/** Ship the locally-valid agent closure to the REMOTE store (`nix copy --to
 *  ssh-ng://…`). This is the step that actually moves binaries to the target:
 *  the cold `nix build --store ssh-ng://` copies ONLY the derivation closure
 *  and the remote daemon substitutes per ITS OWN nix.conf — locally-valid
 *  outputs are never consulted (verified live with a nondeterministic
 *  derivation: the remote REBUILT an output that sat valid in the local
 *  store). So without this explicit copy the prefetch would help only the
 *  localhost arm.
 *
 *  The remote daemon accepts the copied paths only when it trusts them: the
 *  ssh user is in its `trusted-users`, or the NARs carry a signature it
 *  already trusts. A refusal is NARRATED with the real levers (trust the
 *  key on the host, or configure the cache there per the quickstart) and the
 *  cold build falls back to realising on the host, exactly as before this
 *  step existed. Those levers are only TRUE of a closure we actually hold, so
 *  the caller runs this step only once local validity is established. */
async function shipAgentClosure(opts: {
  host: string;
  keepalive: SshKeepalive;
  outPath: string;
  narrate: (line: string) => void;
  policy: LifetimePolicy;
  signal: AbortSignal | undefined;
}): Promise<CopyOutcome> {
  opts.narrate("shipping agent closure to the host's store…");
  const res = await runCapture(
    "nix",
    // `-v`: see the prefetch — per-path lines are what keep a healthy transfer
    // alive under progress-liveness.
    ["-v", "copy", "--to", `ssh-ng://${opts.host}`, opts.outPath],
    {
      onProgress: opts.narrate,
      policy: opts.policy,
      env: { NIX_SSHOPTS: nixSshOpts(opts.keepalive) },
      signal: opts.signal,
    },
  );
  if (res.ok) {
    opts.narrate("agent closure shipped");
    return "delivered";
  }
  if (res.kind === "aborted") return "aborted";
  opts.narrate(
    `could not ship the agent closure (${describeExit(res)}) — the host will realise it itself. If this keeps compiling on the host: trust the declared cache key there, or add the cache to the host's nix.conf.`,
  );
  return "missed";
}

/** Is `outPath` valid in `host`'s store right now? The pure, never-substituting
 *  store query, asked at EITHER seat: `buildSshProbeCommand` already erases the
 *  local/remote difference (it returns the bare command for a local host), so
 *  the same question does not need two implementations that can drift.
 *
 *  Three outcomes, not two: an ABORTED probe is not an absent closure. Folding
 *  it into `false` would narrate "no local copy of the agent to ship" for a dial
 *  the user just cancelled — a false statement about the store, and the same
 *  class of lie the other copy steps take care to avoid.
 *
 *  `onProgress` is optional because the two seats differ in what the caller
 *  wants from the output: the remote warm check scans its stderr for transport
 *  evidence, while the local probe has nothing to say. */
async function checkValidity(
  host: string,
  outPath: string,
  opts: {
    signal: AbortSignal | undefined;
    onProgress?: (line: string) => void;
    /** The dial's ssh policy — REQUIRED, and IGNORED at the local seat (which
     *  spawns no ssh), exactly as `buildAgentCommand`'s `localEnv` is required
     *  and ignored on the ssh arm. Required rather than optional so a caller
     *  cannot forget it at the REMOTE seat, where omitting it would open the
     *  warm check's master under the default policy. */
    keepalive: SshKeepalive;
  },
): Promise<"valid" | "absent" | "aborted"> {
  const probe = buildSshProbeCommand(
    { host, keepalive: opts.keepalive },
    "nix-store",
    "--check-validity",
    outPath,
  );
  const res = await runCapture(probe.command, probe.args, {
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    policy: probePolicy(),
    signal: opts.signal,
  });
  if (res.ok) return "valid";
  return res.kind === "aborted" ? "aborted" : "absent";
}

/** Steps 2 and 3 as ONE decision: get the agent closure into the target store
 *  without building it there. Returns a `ProvisionResult` to BAIL with (the
 *  `pinGcRoot` idiom this file already uses), or `null` to continue — plus
 *  whether the target now provably HOLDS the closure, which lets the caller
 *  skip the cold build entirely.
 *
 *  Order matters and is the cheap-question-first order: ask the LOCAL store
 *  whether it already holds the closure before spending a network `nix copy`
 *  per declared cache. A warm binder — the common case once anything has been
 *  built or dialled — then does zero cache work, and only a genuinely absent
 *  closure pays for the prefetch.
 *
 *  Both copies are SPECULATIVE, so they narrate via the caller's RAW progress
 *  sink — never a scanning wrapper: an unreachable cache's stderr must not set
 *  `sawNetworkError` and misclassify the required build's failure as retryable
 *  "network". They also run under their OWN silence bound (`copyPolicy`), never
 *  the required build's escalated one. */
async function stageAgentClosure(opts: {
  host: string;
  keepalive: SshKeepalive;
  isLocal: boolean;
  outPath: string;
  binaryCache: AgentBinaryCache;
  narrate: (line: string) => void;
  signal: AbortSignal | undefined;
}): Promise<{ bail: ProvisionResult | null; onTarget: boolean }> {
  const cont = (onTarget: boolean): { bail: null; onTarget: boolean } => ({
    bail: null,
    onTarget,
  });
  let held = await checkValidity("localhost", opts.outPath, {
    signal: opts.signal,
    // Ignored on this seat — the local store query spawns no ssh — but stated
    // so the field can stay required at the seat where forgetting it matters.
    keepalive: opts.keepalive,
  });
  if (held === "aborted") {
    return {
      bail: abortedDuring(opts.host, "the local validity check"),
      onTarget: false,
    };
  }
  if (held === "absent") {
    const prefetch = await prefetchAgentClosure({
      outPath: opts.outPath,
      binaryCache: opts.binaryCache,
      keepalive: opts.keepalive,
      narrate: opts.narrate,
      policy: copyPolicy(),
      signal: opts.signal,
    });
    if (prefetch === "aborted") {
      return {
        bail: abortedDuring(opts.host, "the cache prefetch"),
        onTarget: false,
      };
    }
    held = prefetch === "delivered" ? "valid" : "absent";
  }
  // Localhost never ships: the store just checked IS the store the build
  // realises in, so a hit there is already a hit on the target.
  if (opts.isLocal) return cont(held === "valid");
  if (held === "absent") {
    opts.narrate(
      "no local copy of the agent to ship — the host will realise it from source",
    );
    return cont(false);
  }
  const ship = await shipAgentClosure({
    host: opts.host,
    keepalive: opts.keepalive,
    outPath: opts.outPath,
    narrate: opts.narrate,
    policy: copyPolicy(),
    signal: opts.signal,
  });
  if (ship === "aborted") {
    return {
      bail: abortedDuring(opts.host, "the closure ship"),
      onTarget: false,
    };
  }
  return cont(ship === "delivered");
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
  // ONE policy for the whole provisioning: every ssh below — and the ssh Nix
  // forks for the remote store — carries the SAME one, because they share a
  // `ControlMaster` keyed by it (see `controlMaster.ts`). Required on the
  // options, so that is a type fact rather than a defaulting site that has to
  // agree with eight others; and validity is a fact the value carries
  // (`sshKeepalive` is its only producer), so nothing is re-checked here.
  const { keepalive } = opts;
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
  // No root path means no rootable agent, and every step below ends at the
  // required root commit — so fail HERE, where the fact is known, instead of
  // after a store query, a cache fetch and a build that are all already doomed.
  if (rootPath === null) {
    return {
      ok: false,
      reason: `${opts.host}: HOME is unset, so the agent GC root path cannot be formed`,
      cause: "remote",
    };
  }

  // 0. The derivation's output path, computed LOCALLY (no ssh, no
  //    substitution, instant). Two consumers: the remote warm check (1) asks
  //    the host about this exact path, and the cache prefetch (2) names it
  //    to `nix copy`. `-q --outputs` prints ONE line PER OUTPUT — the agent
  //    contract is single-output (see `multiOutputError`), so a >1 result
  //    fails loud; a failed query (GC collected the evaluated .drv) leaves
  //    `undefined` and both consumers fall through to the cold provision,
  //    which re-establishes the truth itself.
  const outsRes = await runCapture("nix-store", ["-q", "--outputs", drvPath], {
    policy: probePolicy(),
    signal,
  });
  const outputs = parseOutputs(outsRes.stdout);
  if (outsRes.ok && outputs.length > 1) {
    return multiOutputError(opts.host, outputs.length);
  }
  const localAgentPath = outsRes.ok ? outputs[0] : undefined;

  // 1. Warm fast-path (remote only) — the ASK-ONLY check (#1908 D1a). Ask the
  //    host whether the output is already valid there. A HIT skips the
  //    redundant copy/realise. A MISS falls through to the full provision. A
  //    flake source is re-evaluated inside the provisioning process, which
  //    owns a temporary root across the handoff; a direct drv-path caller
  //    owns keeping its path valid. Localhost never copies, so the fast-path
  //    is remote-only.
  if (!isLocal) {
    if (localAgentPath === undefined) {
      // Step 0's local query missed (GC took the evaluated .drv), so there is
      // no path to ask the host about — say THAT, rather than the line below,
      // which would announce a check that never runs.
      onProgress(
        `${opts.host}: agent output path unknown locally — skipping the cached-agent check; the cold provision re-establishes it`,
      );
    } else {
      // One SYNTHESIZED, truthful line at check start (NOT raw nix stderr).
      onProgress(`${opts.host}: checking for a cached agent…`);
      // Ask the host, bounded, whether the output is already valid there. This is a pure
      // store query — it NEVER substitutes (verified: `--check-validity` on an absent path
      // returns non-zero instantly, no fetch).
      if (
        (await checkValidity(opts.host, localAgentPath, {
          signal,
          onProgress: onProbeProgress,
          keepalive,
        })) === "valid"
      ) {
        // Warm hit. The shared root operation is the commit point: only a rooted,
        // still-valid target may short-circuit as success.
        opts.onProvisioning?.();
        const bail = await pinGcRoot(
          opts.host,
          keepalive,
          localAgentPath,
          rootPath,
          opts.onProgress,
          budgets.provisioning,
          signal,
        );
        if (bail) return bail;
        budgets.provisioning.reset();
        onProgress(
          `${opts.host}: already provisioned at ${localAgentPath} — skipped copy`,
        );
        return { ok: true, agentPath: localAgentPath };
      }
    }
  }

  // The cold command establishes its own current transport evidence. Do not let
  // a speculative warm-probe miss poison the classification of this operation.
  sawNetworkError = false;
  opts.onProvisioning?.();

  // 2/3. Stage the closure onto the target WITHOUT building it there — the
  //      whole point of the binary cache (see `stageAgentClosure`). Skipped
  //      only when the output path is unknown (0 fell through); then the build
  //      alone owns realisation, exactly as before these steps existed.
  let onTarget = false;
  if (localAgentPath !== undefined) {
    const staged = await stageAgentClosure({
      host: opts.host,
      keepalive,
      isLocal,
      outPath: localAgentPath,
      binaryCache: opts.derivation.binaryCache,
      narrate: (line) => opts.onProgress(`${opts.host}: ${line}`),
      signal,
    });
    if (staged.bail) return staged.bail;
    onTarget = staged.onTarget;
  }

  // 4a. Staged ⇒ the agent output is already valid in the target store, so the
  //     cold build has nothing left to do but re-derive a path we hold: skip
  //     it and go straight to the required root commit. This is the same
  //     short-circuit the warm fast-path takes, reached by a different route —
  //     and it is where the cache actually pays off, since the build it skips
  //     is a full flake evaluation plus an ssh-ng round trip.
  if (onTarget && localAgentPath !== undefined) {
    const bail = await pinGcRoot(
      opts.host,
      keepalive,
      localAgentPath,
      rootPath,
      opts.onProgress,
      budgets.provisioning,
      signal,
    );
    if (bail) return bail;
    budgets.provisioning.reset();
    onProgress(
      `${opts.host}: agent staged from the binary cache — no build needed`,
    );
    return { ok: true, agentPath: localAgentPath };
  }

  // 4. Provision the cold target in ONE Nix process. `--eval-store auto`
  //    keeps flake evaluation in the caller's store while `--store ssh-ng://…`
  //    makes the destination store own transfer and realisation. Nix therefore
  //    carries its temporary roots across the whole evaluation→copy→build
  //    lifetime; there is no command boundary at which remote GC can collect the
  //    transferred derivation. Localhost uses the same installable without the
  //    remote-store split.
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
    env: isLocal ? undefined : { NIX_SSHOPTS: nixSshOpts(keepalive) },
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

  // 5. Commit the realised output behind a stable, per-agent GC root. This is
  //    the same required operation as the warm-hit and staged paths; provision
  //    success means both "valid" and "durably rooted", never merely "was
  //    built". (`rootPath` was proven non-null before any work started.)
  {
    const bail = await pinGcRoot(
      opts.host,
      keepalive,
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
