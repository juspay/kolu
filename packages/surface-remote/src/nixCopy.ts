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
 *   2. Stage the closure in the sender's store, by the target's SYSTEM:
 *      - a Linux target gets the CONTENT-ADDRESSED form: `nix store
 *        make-content-addressed --json [--from <declared cache>] <out>`
 *        rewrites the closure into the sender's store, reading it from the
 *        local store when it is there and straight from each declared cache
 *        otherwise. A content-addressed path's name IS its content's hash, so
 *        every Nix store takes it from anyone — no `trusted-users`, no
 *        signature, no key (the Nix manual: `make-content-addressed`,
 *        `require-sigs`). Neither the sender's Nix nor the target's needs to
 *        trust anything. The rewritten closure is rooted in the sender's store
 *        behind a link per output path ({@link contentAddressedRoot}), which
 *        is also the record of the rewrite: a warm target is asked about the
 *        content-addressed path, and a new one is shipped it, without reading
 *        the cache again — across restarts too;
 *      - a darwin target keeps the SIGNED input-addressed closure: `nix copy
 *        --from <declared cache>` into the sender's store. Rewriting a Mach-O
 *        file invalidates its code signature, and arm64 macOS kills an
 *        executable whose signature does not verify; `make-content-addressed`
 *        does not re-sign (unverified on a Mac when this route was chosen —
 *        no darwin machine was reachable; if a rewritten bundle is shown to
 *        run there, drop this branch and ship content-addressed everywhere).
 *      The sender-local store is the one seat where the derivation's REQUIRED
 *      `binaryCache` can act (a remote realisation substitutes per the REMOTE
 *      daemon's own nix.conf; client settings never participate). A miss
 *      narrates and falls back.
 *   3. Ship: `nix copy --to ssh-ng://$host <path>` moves the staged closure to
 *      the target — step 4's build would NOT (it copies only the .drv
 *      closure; locally-valid outputs are never consulted, verified live).
 *      Lands cross-arch (copying executes nothing). A content-addressed ship
 *      is taken by any daemon. A darwin target's daemon must trust the ssh
 *      user or the NAR signatures — a refusal narrates the real levers and
 *      step 4 realises on the host. Runs only when the closure is provably
 *      valid LOCALLY.
 *   4. One `nix build --eval-store auto --store ssh-ng://$host` evaluates
 *      locally, transfers the derivation, and realises it remotely. One Nix
 *      process owns the temporary roots across that whole handoff, so a
 *      concurrent GC cannot collect the just-transferred derivation between
 *      separate copy and build commands. Its log is read as tagged events
 *      (`nixLog.ts`): Nix's transfer and build lines reach the connect overlay,
 *      and a failure reports Nix's own root error.
 *   5. `ssh $host nix-store --realise $out --add-root $link --indirect`
 *      atomically proves the output still exists (restoring it if possible)
 *      and commits it behind a per-agent GC root on the target, so a
 *      `nix-collect-garbage` there can't delete the agent out from
 *      under a live session (or force a rebuild on the next reconnect).
 *      This command is the provisioning commit point: any failure is returned,
 *      and no agent path escapes unrooted.
 *      See `agentGcRootPath` for the "latest"-link semantics.
 *   Spawn: the rooted path (the content-addressed one on a Linux target)
 *      becomes `agentPath`; the caller then spawns
 *      `ssh $host $agentPath/bin/<binary> --stdio` via the connector.
 *
 * Localhost shortcut: `nix build` and the root commit both target the local store.
 *
 * **Steps 1–3 and 5 are their own public operation, {@link deliverClosure}** —
 * "get this exact, already-evaluated output path into that store from the
 * declared cache, and root it there", with NO build at any step. `provisionAgent`
 * is one caller (it adds step 4, realising on the host, when the closure was not
 * delivered); a caller that must never build (kolu delivering agent-distro's
 * bundles, which are only ever fetched) stops where delivery stops, and reads
 * WHY from the result: not in the cache, refused by a darwin target's Nix, or
 * a ship that failed for another reason.
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

import { mkdirSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import type { AgentBinaryCache } from "./agentBinaryCache";
import type { AgentDerivation } from "./agentDerivation";
import {
  forEachLine,
  isLocalHost,
  nixSshOpts,
  type SshDestination,
} from "./host";
import type { SshKeepalive } from "./keepalive";
import { describeNixRun, type NixRun, runNix } from "./nixLog";
import {
  type DeadlinePolicy,
  describeExit,
  type ExitResult,
  type ProgressLivenessPolicy,
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
 *  real miss. A slow uplink stalls a large NAR (kolu's own closure carries a
 *  ~200 MB path) for long stretches, and a remote store may batch its
 *  progress. Bound the dead endpoint, not the slow one. */
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
  policy(): ProgressLivenessPolicy;
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
  /** Every stderr line of a long-running provisioning Nix command, narrated or
   *  not — wire it to the session's `ctx.activity` (why: `runNix`). REQUIRED,
   *  so a forgotten wire is a compile error rather than a restart loop. */
  onActivity: () => void;
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

/** A provisioning step's failure — what a step that cannot succeed returns. */
type ProvisionFailure = Extract<ProvisionResult, { ok: false }>;

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
  return homeGcRoot(
    isLocal,
    `.local/state/kolu/surface-remote/gcroots/${name}`,
  );
}

/** A home-relative GC-root path as `nix-store --add-root` takes it on the
 *  target: as is for a remote (the ssh login's home resolves it), anchored to
 *  this process's `$HOME` locally — `null` when `$HOME` is unset. */
export function homeGcRoot(isLocal: boolean, rel: string): string | null {
  if (!isLocal) return rel;
  const home = process.env.HOME;
  return home ? `${home}/${rel}` : null;
}

/** A hard-`deadline` {@link LifetimePolicy} for the QUICK ssh/local steps — the arch
 *  probe and warm `check-validity`. One place so every quick step shares the
 *  "how long a quick nix/ssh round-trip may run" bound (exported so `arch.ts` rides
 *  the same shape rather than re-spelling the literal). */
export function probePolicy(): DeadlinePolicy {
  return { kind: "deadline", ms: PROVISION_PROBE_DEADLINE_MS };
}

/** The progress-liveness policy the two SPECULATIVE copies run under — their
 *  own bound, not a slice of the required build's escalating budget. See
 *  {@link PROVISION_COPY_SILENCE_MS}. */
function copyPolicy(): ProgressLivenessPolicy {
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
): ProvisionFailure {
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

/** The retry class of a failed REQUIRED provisioning step — the ONE table, shared
 *  by the cold build and the GC-root pin. Each step's transport verdict is its
 *  OWN run's (`NixRun.transportFailure`): a host that went unreachable
 *  mid-provision exits with Nix's code, so what ssh and Nix SAID is the evidence
 *  — never a builder's log (see `nixLog.ts`). An `aborted` (user verb) is
 *  RETRYABLE `"network"` — never the bounded `"remote"` default — so a user
 *  abort never burns the give-up budget. `lifetime-expired` (our kill) never
 *  reaches here: each step intercepts its own kill inline via `expiredResult`. */
function causeFor(res: NixRun): "network" | "remote" {
  return res.kind === "aborted" || res.transportFailure ? "network" : "remote";
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
  onActivity: () => void,
  budget: StepBudget,
  signal: AbortSignal | undefined,
): Promise<ProvisionFailure | null> {
  onProgress(`${host}: pinning GC root at '${rootPath}'…`);
  const pinRes = await runNix(
    { host, keepalive },
    ["nix-store", "--realise", target, "--add-root", rootPath, "--indirect"],
    { narrate: onProgress, policy: budget.policy(), onActivity, signal },
  );
  if (pinRes.ok) return null;
  if (pinRes.kind === "lifetime-expired") {
    return expiredResult(
      host,
      "nix-store --realise --add-root",
      budget,
      pinRes,
    );
  }
  return {
    ok: false,
    reason: `${host}: could not establish the agent GC root: ${describeNixRun(pinRes)}`,
    cause: causeFor(pinRes),
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
type CopyOutcome =
  | { readonly kind: "delivered" }
  | {
      readonly kind: "missed";
      /** The destination's Nix refused the paths for want of a signature it
       *  trusts — the one miss only that store's own settings fix (an
       *  input-addressed copy only: a content-addressed one needs none). */
      readonly refused: boolean;
      /** What this step's last attempt said, in Nix's words. */
      readonly reason: string;
    }
  | { readonly kind: "aborted" };

/** Nix's words when a store refuses a path for want of a trusted signature:
 *  "cannot add path '…' because it lacks a signature by a trusted key" (an
 *  untrusted user's import, whatever `--no-check-sigs` asked; the Nix manual's
 *  `require-sigs` / `trusted-users`). */
const SIGNATURE_REFUSAL = /lacks a (?:valid )?signature/;

/** The ONE shape of "the user's abort landed inside this provisioning step" —
 *  named per step, so an abort during the slow ship can never report the
 *  prefetch it had already finished. */
function abortedDuring(host: string, step: string): ProvisionFailure {
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
   *  at all: the exact eternal hang `nixSshOpts` exists to bound, in the one
   *  provisioning step that had been left out of the policy. */
  keepalive: SshKeepalive;
  narrate: (line: string) => void;
  onActivity: () => void;
  policy: ProgressLivenessPolicy;
  signal: AbortSignal | undefined;
}): Promise<CopyOutcome> {
  const keys = opts.binaryCache.trustedPublicKeys.join(" ");
  // Rendered ONCE, beside `keys`: the policy does not vary per substituter, and
  // rendering it inside the loop would re-run the control-dir ensure per URL.
  const sshOpts = nixSshOpts(opts.keepalive);
  // The declaration is non-empty by construction (`agentBinaryCache`), so the
  // loop always overwrites this before a miss is returned.
  let last = { refused: false, reason: "no declared cache was tried" };
  for (const url of opts.binaryCache.substituters) {
    opts.narrate(`prefetching agent closure from ${url} into the local store…`);
    const res = await runNix(
      "localhost",
      // `-v` keeps a healthy transfer producing output under progress-liveness
      // (#1964). Under internal-json the per-path activity events already do
      // on a local-store copy (measured); the flag stays so that guarantee does
      // not rest on one store type. `--extra-trusted-public-keys` lets a
      // trusted local user import the declared cache's signatures without a
      // nix.conf edit; for an untrusted user nix's own refusal is what the
      // per-URL line below reports, and we fall back.
      [
        "nix",
        "-v",
        "copy",
        "--from",
        url,
        "--extra-trusted-public-keys",
        keys,
        opts.outPath,
      ],
      {
        narrate: opts.narrate,
        onActivity: opts.onActivity,
        policy: opts.policy,
        env: { NIX_SSHOPTS: sshOpts },
        signal: opts.signal,
      },
    );
    if (res.ok) {
      opts.narrate(`agent closure available locally (via ${url})`);
      return { kind: "delivered" };
    }
    if (res.kind === "aborted") return { kind: "aborted" };
    // Per-URL: state only what this URL did — which is what Nix said, not an
    // assumed "it wasn't there" (a signature refusal or a DNS failure is not a
    // miss). The give-up verdict belongs AFTER the loop — another declared
    // cache may still deliver, and announcing a fall back before trying it is
    // simply false.
    const said = describeNixRun(res);
    last = { refused: SIGNATURE_REFUSAL.test(said), reason: said };
    opts.narrate(`could not fetch the agent closure from ${url}: ${said}`);
  }
  opts.narrate("no declared cache delivered the agent closure");
  return { kind: "missed", ...last };
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
 *  key on the host, or configure the cache there per the quickstart), typed
 *  as `refused` so a caller can say so; `provisionAgent` then falls back to
 *  realising on the host. Those levers are only TRUE of a closure we actually
 *  hold, so the caller runs this step only once local validity is
 *  established. */
async function shipAgentClosure(opts: {
  host: string;
  keepalive: SshKeepalive;
  outPath: string;
  /** The closure is input-addressed, so the target checks signatures (see
   *  `--no-check-sigs` below). A content-addressed one is self-verifying. */
  inputAddressed: boolean;
  narrate: (line: string) => void;
  onActivity: () => void;
  policy: ProgressLivenessPolicy;
  signal: AbortSignal | undefined;
}): Promise<CopyOutcome> {
  opts.narrate("shipping agent closure to the host's store…");
  const res = await runNix(
    "localhost",
    // `-v`: see the prefetch.
    //
    // `--no-check-sigs` (input-addressed only): without it `nix copy` asks the
    // destination to verify signatures EVEN FOR a trusted user, so
    // `trusted-users` alone never let a locally-built (unsigned) closure land —
    // verified live: `Trusted: 1` over `ssh-ng://`, and the copy still refused
    // "lacks a signature by a trusted key" until this flag was passed. An
    // UNTRUSTED user's copy is still checked by the daemon regardless, so this
    // relaxes nothing it should not.
    [
      "nix",
      "-v",
      "copy",
      ...(opts.inputAddressed ? ["--no-check-sigs"] : []),
      "--to",
      `ssh-ng://${opts.host}`,
      opts.outPath,
    ],
    {
      narrate: opts.narrate,
      onActivity: opts.onActivity,
      policy: opts.policy,
      env: { NIX_SSHOPTS: nixSshOpts(opts.keepalive) },
      signal: opts.signal,
    },
  );
  if (res.ok) {
    opts.narrate("agent closure shipped");
    return { kind: "delivered" };
  }
  if (res.kind === "aborted") return { kind: "aborted" };
  const said = describeNixRun(res);
  opts.narrate(`could not ship the agent closure: ${said}`);
  return {
    kind: "missed",
    refused: SIGNATURE_REFUSAL.test(said),
    reason: said,
  };
}

/** Is `outPath` valid in `host`'s store right now? The pure, never-substituting
 *  store query, asked at EITHER seat: `buildSshProbeCommand` already erases the
 *  local/remote difference (it returns the bare command for a local host), so
 *  the same question does not need two implementations that can drift.
 *
 *  Four outcomes, not two: an ABORTED probe is not an absent closure. Folding
 *  it into `false` would narrate "no local copy of the agent to ship" for a dial
 *  the user just cancelled — a false statement about the store, and the same
 *  class of lie the other copy steps take care to avoid. Likewise a
 *  `lifetime-expired` kill of this cheap round-trip is `"timed-out"`, never
 *  folded into `"absent"`: the query hit `probePolicy()`'s deadline instead of
 *  answering, which is the strongest evidence available that the seat is
 *  already degraded — the caller narrates it explicitly rather than silently
 *  proceeding as though the store had cleanly reported "not cached".
 *
 *  `target` is a bare host string or an `SshDestination` naming the dial's
 *  policy — the same argument `buildSshProbeCommand` takes, forwarded whole. The
 *  local seat has no policy to state and passes `"localhost"`; the remote seat
 *  passes the dial's, where omitting it would open the warm check's master under
 *  the default one. */
async function checkValidity(
  target: string | SshDestination,
  outPath: string,
  opts: { signal: AbortSignal | undefined },
): Promise<"valid" | "absent" | "aborted" | "timed-out"> {
  const res = await runNix(target, ["nix-store", "--check-validity", outPath], {
    policy: probePolicy(),
    signal: opts.signal,
  });
  if (res.ok) return "valid";
  if (res.kind === "aborted") return "aborted";
  if (res.kind === "lifetime-expired") return "timed-out";
  return "absent";
}

/** What staging (steps 2 and 3) concluded: a `ProvisionResult` to BAIL with
 *  (the `pinGcRoot` idiom this file already uses), or the path the target
 *  store now provably HOLDS, or why it holds nothing ({@link ClosureMiss}). */
type Staged =
  | { bail: ProvisionFailure }
  | { bail: null; onTarget: true; path: string }
  | { bail: null; onTarget: false; miss: ClosureMiss };

/** Steps 2 and 3 for a darwin target: the SIGNED, input-addressed closure
 *  (see the module header for why darwin does not get the content-addressed
 *  one). Get it into the target store without building it there.
 *
 *  Order matters and is the cheap-question-first order: ask the LOCAL store
 *  whether it already holds the closure before spending a network `nix copy`
 *  per declared cache. A warm binder — the common case once anything has been
 *  built or dialled — then does zero cache work, and only a genuinely absent
 *  closure pays for the prefetch.
 *
 *  Both copies are SPECULATIVE: each run's transport evidence stays on its own
 *  `NixRun`, so an unreachable cache can never misclassify the required build's
 *  failure as retryable "network". They also run under their OWN silence bound
 *  (`copyPolicy`), never the required build's escalated one. */
async function stageInputAddressed(opts: {
  host: string;
  keepalive: SshKeepalive;
  isLocal: boolean;
  outPath: string;
  binaryCache: AgentBinaryCache;
  narrate: (line: string) => void;
  onActivity: () => void;
  signal: AbortSignal | undefined;
}): Promise<Staged> {
  const held = await checkValidity("localhost", opts.outPath, {
    signal: opts.signal,
  });
  if (held === "aborted") {
    return { bail: abortedDuring(opts.host, "the local validity check") };
  }
  if (held === "timed-out") {
    opts.narrate(
      `local validity check timed out after ${PROVISION_PROBE_DEADLINE_MS}ms — treating the agent closure as not yet cached locally`,
    );
  }
  let unfetched: ClosureMiss | undefined;
  if (held === "absent" || held === "timed-out") {
    const prefetch = await prefetchAgentClosure({
      outPath: opts.outPath,
      binaryCache: opts.binaryCache,
      keepalive: opts.keepalive,
      narrate: opts.narrate,
      onActivity: opts.onActivity,
      policy: copyPolicy(),
      signal: opts.signal,
    });
    if (prefetch.kind === "aborted") {
      return { bail: abortedDuring(opts.host, "the cache prefetch") };
    }
    // A refused import is the TARGET's refusal on the local arm, where the
    // sender's store IS the target. On a remote arm it is the sender's own
    // Nix refusing the cache: the host was never asked, and the cache HAS
    // the closure — a different store, and a different fix.
    if (prefetch.kind === "missed")
      unfetched = {
        why: !prefetch.refused
          ? "uncached"
          : opts.isLocal
            ? "refused"
            : "sender-refused",
        reason: prefetch.reason,
      };
  }
  // Localhost never ships: the store just checked IS the target store, so a
  // hit there is already a hit on the target.
  if (unfetched === undefined && opts.isLocal)
    return { bail: null, onTarget: true, path: opts.outPath };
  if (unfetched !== undefined) {
    if (!opts.isLocal) opts.narrate("no local copy of the agent to ship");
    return { bail: null, onTarget: false, miss: unfetched };
  }
  const ship = await shipAgentClosure({
    host: opts.host,
    keepalive: opts.keepalive,
    outPath: opts.outPath,
    inputAddressed: true,
    narrate: opts.narrate,
    onActivity: opts.onActivity,
    policy: copyPolicy(),
    signal: opts.signal,
  });
  if (ship.kind === "aborted") {
    return { bail: abortedDuring(opts.host, "the closure ship") };
  }
  if (ship.kind === "delivered")
    return { bail: null, onTarget: true, path: opts.outPath };
  return {
    bail: null,
    onTarget: false,
    miss: { why: ship.refused ? "refused" : "unshipped", reason: ship.reason },
  };
}

/** Where the sender roots `outPath`'s content-addressed form: one indirect GC
 *  root per output path, under a directory per output NAME (the path with its
 *  store hash cut off), so the newest output of a name replaces the older ones
 *  ({@link rememberContentAddressed}). The link IS the record of the rewrite —
 *  reading it back answers "what is this output's content-addressed path"
 *  across restarts — and it keeps that closure in the sender's store, so a
 *  later host is shipped it without reading the cache again. `null` when
 *  `$HOME` is unset. */
function contentAddressedRoot(outPath: string): {
  readonly dir: string;
  readonly link: string;
} | null {
  const base = outPath.replace(/^.*\//, "");
  const dir = homeGcRoot(
    true,
    `.local/state/kolu/surface-remote/content-addressed/${base.replace(/^[0-9a-z]{32}-/, "")}`,
  );
  return dir === null ? null : { dir, link: `${dir}/${base.slice(0, 32)}` };
}

/** `outPath`'s content-addressed form, when the sender has rooted one and its
 *  store still holds it — read off the root link, never a guess. */
async function rememberedContentAddressed(
  outPath: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const root = contentAddressedRoot(outPath);
  if (root === null) return undefined;
  let path: string;
  try {
    path = readlinkSync(root.link);
  } catch (err) {
    // No link: never rewritten here (or its root was removed). Anything else
    // is a broken state directory, and loud.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return (await checkValidity("localhost", path, { signal })) === "valid"
    ? path
    : undefined;
}

/** Root the content-addressed `path` of `outPath` in the sender's store
 *  (`nix-store --realise --add-root --indirect`, the commit `pinGcRoot` makes
 *  on every target) and drop the roots of older outputs of the same name, so
 *  the sender keeps the newest closure of each and lets the rest go. */
async function rememberContentAddressed(
  host: string,
  outPath: string,
  path: string,
  opts: {
    readonly keepalive: SshKeepalive;
    readonly narrate: (line: string) => void;
    readonly onActivity: () => void;
    readonly budget: StepBudget;
    readonly signal: AbortSignal | undefined;
  },
): Promise<ProvisionFailure | null> {
  const root = contentAddressedRoot(outPath);
  if (root === null)
    return {
      ok: false,
      reason: `${host}: HOME is unset, so the content-addressed agent's GC root on this machine cannot be formed`,
      cause: "remote",
    };
  mkdirSync(root.dir, { recursive: true });
  const bail = await pinGcRoot(
    "localhost",
    opts.keepalive,
    path,
    root.link,
    opts.narrate,
    opts.onActivity,
    opts.budget,
    opts.signal,
  );
  if (bail !== null) return bail;
  const keep = root.link.slice(root.dir.length + 1);
  for (const older of readdirSync(root.dir))
    if (older !== keep) rmSync(`${root.dir}/${older}`, { force: true });
  return null;
}

/** A line of `make-content-addressed`'s log that is the sender store's own
 *  hard-link deduplication (`auto-optimise-store`) reporting a link it could
 *  not make — `error: linking '…' to '/nix/store/.links/…'` — thousands per
 *  closure, harmless, and never the rewrite's cause. Dropped before the log
 *  reader, so it neither floods the narration nor stands in for the root
 *  error of a rewrite that failed. */
function isStoreDedupNoise(line: string): boolean {
  return line.includes("/nix/store/.links/");
}

/** Rewrite `outPath`'s closure into its content-addressed form in the sender's
 *  store — from the local store when it holds the closure (`fromLocal`), else
 *  from each declared cache in turn (`--from` names a store to READ, so no
 *  trust setting filters it — see `prefetchAgentClosure`; the paths it writes
 *  are content-addressed, so the sender's daemon takes them from an untrusted
 *  user). `"rewritten"` carries the content-addressed path, valid locally. */
async function rewriteContentAddressed(opts: {
  outPath: string;
  binaryCache: AgentBinaryCache;
  fromLocal: boolean;
  keepalive: SshKeepalive;
  narrate: (line: string) => void;
  onActivity: () => void;
  signal: AbortSignal | undefined;
}): Promise<
  | { readonly kind: "rewritten"; readonly path: string }
  | { readonly kind: "missed"; readonly reason: string }
  | { readonly kind: "aborted" }
> {
  const sources: readonly (string | undefined)[] = opts.fromLocal
    ? [undefined]
    : opts.binaryCache.substituters;
  const sshOpts = nixSshOpts(opts.keepalive);
  let reason = "no declared cache was tried";
  for (const from of sources) {
    opts.narrate(
      `making the agent closure content-addressed from ${from ?? "the local store"}…`,
    );
    const res = await runNix(
      "localhost",
      [
        "nix",
        "-v",
        "store",
        "make-content-addressed",
        "--json",
        ...(from === undefined ? [] : ["--from", from]),
        opts.outPath,
      ],
      {
        narrate: opts.narrate,
        onActivity: opts.onActivity,
        policy: copyPolicy(),
        env: { NIX_SSHOPTS: sshOpts },
        signal: opts.signal,
        dropLine: isStoreDedupNoise,
      },
    );
    if (res.kind === "aborted") return { kind: "aborted" };
    if (res.ok) {
      const path = rewrittenPath(res.stdout, opts.outPath);
      opts.narrate(`agent closure content-addressed at ${path}`);
      return { kind: "rewritten", path };
    }
    reason = describeNixRun(res);
    opts.narrate(
      `could not make the agent closure content-addressed from ${from ?? "the local store"}: ${reason}`,
    );
  }
  return { kind: "missed", reason };
}

/** The content-addressed path `make-content-addressed --json` rewrote
 *  `outPath` to (`{"rewrites": {<from>: <to>}}`). Throws on any other answer:
 *  a format change upstream must be loud, never a path guessed. */
function rewrittenPath(stdout: string, outPath: string): string {
  const parsed: unknown = JSON.parse(stdout);
  const to =
    typeof parsed === "object" &&
    parsed !== null &&
    "rewrites" in parsed &&
    typeof parsed.rewrites === "object" &&
    parsed.rewrites !== null
      ? (parsed.rewrites as Record<string, unknown>)[outPath]
      : undefined;
  if (typeof to !== "string" || !to.startsWith("/nix/store/"))
    throw new Error(
      `nix store make-content-addressed did not name ${outPath}'s rewrite: ${stdout}`,
    );
  return to;
}

/** Steps 2 and 3 for a Linux target: the CONTENT-ADDRESSED closure, which no
 *  store refuses. `remembered` is the content-addressed path the sender has
 *  already rooted for `outPath` (the warm check asked the host about it); a
 *  sender without one rewrites the closure — from the local store when it
 *  holds it, the declared caches otherwise — and roots the result. On the
 *  local arm that rewrite lands it in the target store; a local store already
 *  holding the input-addressed closure needs nothing at all. */
async function stageContentAddressed(opts: {
  host: string;
  keepalive: SshKeepalive;
  isLocal: boolean;
  outPath: string;
  remembered: string | undefined;
  binaryCache: AgentBinaryCache;
  narrate: (line: string) => void;
  onActivity: () => void;
  budget: StepBudget;
  signal: AbortSignal | undefined;
}): Promise<Staged> {
  let path = opts.remembered;
  if (path === undefined) {
    const held = await checkValidity("localhost", opts.outPath, {
      signal: opts.signal,
    });
    if (held === "aborted")
      return { bail: abortedDuring(opts.host, "the local validity check") };
    if (opts.isLocal && held === "valid")
      return { bail: null, onTarget: true, path: opts.outPath };
    const rewrite = await rewriteContentAddressed({
      outPath: opts.outPath,
      binaryCache: opts.binaryCache,
      fromLocal: held === "valid",
      keepalive: opts.keepalive,
      narrate: opts.narrate,
      onActivity: opts.onActivity,
      signal: opts.signal,
    });
    if (rewrite.kind === "aborted")
      return {
        bail: abortedDuring(opts.host, "the content-addressed rewrite"),
      };
    if (rewrite.kind === "missed")
      return {
        bail: null,
        onTarget: false,
        miss: { why: "uncached", reason: rewrite.reason },
      };
    path = rewrite.path;
    const bail = await rememberContentAddressed(opts.host, opts.outPath, path, {
      keepalive: opts.keepalive,
      narrate: opts.narrate,
      onActivity: opts.onActivity,
      budget: opts.budget,
      signal: opts.signal,
    });
    if (bail !== null) return { bail };
  }
  if (opts.isLocal) return { bail: null, onTarget: true, path };
  const ship = await shipAgentClosure({
    host: opts.host,
    keepalive: opts.keepalive,
    outPath: path,
    inputAddressed: false,
    narrate: opts.narrate,
    onActivity: opts.onActivity,
    policy: copyPolicy(),
    signal: opts.signal,
  });
  if (ship.kind === "aborted")
    return { bail: abortedDuring(opts.host, "the closure ship") };
  if (ship.kind === "delivered") return { bail: null, onTarget: true, path };
  return {
    bail: null,
    onTarget: false,
    miss: { why: "unshipped", reason: ship.reason },
  };
}

/** Does `system` (a Nix system, `aarch64-darwin`) name a macOS target — the
 *  one kind that keeps the signed, input-addressed closure? */
function isDarwinSystem(system: string): boolean {
  return system.endsWith("-darwin");
}

/** Why a closure did not reach the target store — never a build's business:
 *
 *   - `uncached` — the sender could not get it from any declared cache (a
 *     miss, a network failure, a silence kill — Nix's words say which);
 *   - `refused` — a darwin target's store refused the signed paths: its Nix
 *     trusts neither the login (`trusted-users`) nor the cache's key (on the
 *     local arm the target is the sender's own store, importing from the
 *     cache). Only that store's settings change it. A Linux target never
 *     refuses: it is sent the content-addressed closure;
 *   - `sender-refused` — staging a darwin target's signed closure, the
 *     SENDER's own Nix declined the cache's paths for the same want of trust:
 *     the cache has them, the host was never asked, and only the sending
 *     machine's settings change it;
 *   - `unshipped` — the copy to the target failed for any other reason.
 *
 *  `reason` is what Nix said, verbatim. */
export interface ClosureMiss {
  readonly why: "uncached" | "refused" | "sender-refused" | "unshipped";
  readonly reason: string;
}

export interface DeliverClosureOptions {
  /** The target store's host — an ssh destination, or `isLocalHost`'s
   *  localhost for the sender's own store. */
  host: string;
  /** The target's Nix system (`x86_64-linux`, `aarch64-darwin`) — what
   *  `resolveSystem` answers for it — or `undefined` when the caller cannot
   *  say. It decides the form the closure travels in: content-addressed to
   *  Linux, signed input-addressed to darwin and to a system nobody named
   *  (the form every store can run). Asked only when the warm check misses,
   *  so a warm target never pays for it. */
  system: () => Promise<string | undefined>;
  /** The exact, already-evaluated output path to deliver. Nothing here
   *  evaluates or builds: the path either arrives from `binaryCache` or does
   *  not arrive. */
  outPath: string;
  /** Where the output may be fetched from (REQUIRED, like every provisioning
   *  input: delivery is never cache-blind). */
  binaryCache: AgentBinaryCache;
  /** The GC root to commit the delivered path behind on the target. Remote:
   *  resolved against the ssh login's home when relative. Local: must be
   *  absolute. */
  rootPath: string;
  onProgress: (line: string) => void;
  /** Every stderr line of a long-running Nix command — the owner's silence
   *  watchdog's liveness (see `ProvisionOptions.onActivity`). */
  onActivity: () => void;
  /** Fired once immediately before the first potentially long operation (the
   *  copies, or a warm target's root commit). */
  onDelivering?: () => void;
  /** The progress-liveness budget of the required root commits. Delivery
   *  charges it on a silence kill and resets it on success. */
  budget: StepBudget;
  /** Aborting group-kills the in-flight child; the result is a retryable
   *  `"network"` failure naming the step it landed in. */
  signal?: AbortSignal;
  /** The ssh dead-peer policy for every ssh the delivery causes (see
   *  `ProvisionOptions.keepalive`). REQUIRED. */
  keepalive: SshKeepalive;
}

/** How a delivery ended:
 *
 *   - `ok` — `outPath` is valid in the target store and rooted at
 *     `rootPath`. It is the path the target holds: the input-addressed output
 *     when the target already had it (or is darwin), else its
 *     content-addressed form — the path a caller runs from;
 *   - `not-delivered` — the closure is NOT in the target store, and why
 *     ({@link ClosureMiss}); nothing was rooted. A caller that may build
 *     (`provisionAgent`) builds; one that may not, stops and says why;
 *   - `failed` — an abort, or a required root commit failed: the
 *     `ProvisionResult` failure shape, with its retry class. */
export type DeliverClosureResult =
  | { readonly ok: true; readonly outPath: string }
  | ({ readonly ok: false; readonly kind: "not-delivered" } & ClosureMiss)
  | ({ readonly ok: false; readonly kind: "failed" } & Extract<
      ProvisionResult,
      { ok: false }
    >);

/** Deliver `outPath`'s closure into `host`'s store and root it there — steps
 *  1–3 and 5 of the module header, and NEVER a build: ask the target whether it
 *  already holds the closure (remote; a pure validity query, about the
 *  content-addressed form the sender has rooted for it first, then the output
 *  itself), else stage the closure in the form the target's system takes
 *  (content-addressed to Linux, signed to darwin) and copy it there, then
 *  commit it behind `rootPath`. A darwin target whose Nix will not take the
 *  copy is `not-delivered` with `why: "refused"`. */
export async function deliverClosure(
  opts: DeliverClosureOptions,
): Promise<DeliverClosureResult> {
  const isLocal = isLocalHost(opts.host);
  const { signal, keepalive, outPath } = opts;
  const failed = (r: ProvisionFailure): DeliverClosureResult => ({
    ...r,
    kind: "failed",
  });
  if (signal?.aborted)
    return failed({
      ok: false,
      reason: `${opts.host}: delivery aborted before it started`,
      cause: "network",
    });
  const pin = (path: string): Promise<ProvisionFailure | null> =>
    pinGcRoot(
      opts.host,
      keepalive,
      path,
      opts.rootPath,
      opts.onProgress,
      opts.onActivity,
      opts.budget,
      signal,
    );
  const remembered = await rememberedContentAddressed(outPath, signal);

  // 1. Warm fast-path (remote only) — the ASK-ONLY check (#1908 D1a), about
  //    each path the host may hold: the content-addressed form this sender
  //    rooted for `outPath` (what a Linux host is sent), then `outPath`
  //    itself (a darwin host, or one that built it). A HIT skips the copies.
  //    Localhost's own store is what staging checks first.
  if (!isLocal) {
    // One SYNTHESIZED, truthful line at check start (NOT raw nix stderr).
    opts.onProgress(`${opts.host}: checking for a cached agent…`);
    for (const path of remembered === undefined
      ? [outPath]
      : [remembered, outPath]) {
      // A pure store query — it NEVER substitutes (verified:
      // `--check-validity` on an absent path returns non-zero instantly, no
      // fetch).
      const cached = await checkValidity({ host: opts.host, keepalive }, path, {
        signal,
      });
      if (cached === "timed-out") {
        // The cheapest possible round-trip to this host didn't even answer —
        // say so, rather than silently falling through as if it had cleanly
        // reported "not cached".
        opts.onProgress(
          `${opts.host}: cached-agent check timed out after ${PROVISION_PROBE_DEADLINE_MS}ms — host may be degraded; continuing without the warm fast-path`,
        );
        break;
      }
      if (cached === "valid") {
        // Warm hit. The root operation is the commit point: only a rooted,
        // still-valid target may short-circuit as success.
        opts.onDelivering?.();
        const bail = await pin(path);
        if (bail) return failed(bail);
        opts.budget.reset();
        opts.onProgress(
          `${opts.host}: already provisioned at ${path} — skipped copy`,
        );
        return { ok: true, outPath: path };
      }
    }
  }

  opts.onDelivering?.();

  // 2/3. Stage the closure onto the target WITHOUT building it there.
  const system = await opts.system();
  const narrate = (line: string) => opts.onProgress(`${opts.host}: ${line}`);
  const staged =
    system === undefined || isDarwinSystem(system)
      ? await stageInputAddressed({
          host: opts.host,
          keepalive,
          isLocal,
          outPath,
          binaryCache: opts.binaryCache,
          narrate,
          onActivity: opts.onActivity,
          signal,
        })
      : await stageContentAddressed({
          host: opts.host,
          keepalive,
          isLocal,
          outPath,
          remembered,
          binaryCache: opts.binaryCache,
          narrate,
          onActivity: opts.onActivity,
          budget: opts.budget,
          signal,
        });
  if (staged.bail !== null) return failed(staged.bail);
  if (!staged.onTarget)
    return { ok: false, kind: "not-delivered", ...staged.miss };

  // 5. Commit the delivered path behind the root — the same required
  //    operation as the warm hit.
  const bail = await pin(staged.path);
  if (bail) return failed(bail);
  opts.budget.reset();
  // Say only what is known: the closure is valid in the target store. It may
  // have come from the declared cache or been there already.
  opts.onProgress(
    isLocal
      ? `localhost: agent in the local store at ${staged.path} — no build needed`
      : `${opts.host}: agent in the host's store at ${staged.path} — no build needed`,
  );
  return { ok: true, outPath: staged.path };
}

/** The Nix system `drvPath` is built for, read locally (`nix derivation
 *  show`, no network) — `undefined` when the query fails or does not name one.
 *  Both JSON shapes Nix has printed are read: `{"derivations": {<name>: …}}`
 *  and the older `{<path>: …}`; one `.drv` asked, one entry answered. */
async function derivationSystem(
  drvPath: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const res = await runNix(
    "localhost",
    ["nix", "derivation", "show", drvPath],
    {
      policy: probePolicy(),
      signal,
    },
  );
  if (!res.ok) return undefined;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const table =
      "derivations" in parsed &&
      typeof parsed.derivations === "object" &&
      parsed.derivations !== null
        ? parsed.derivations
        : parsed;
    const entry = Object.values(table)[0] as { system?: unknown } | undefined;
    return typeof entry?.system === "string" ? entry.system : undefined;
  } catch {
    return undefined;
  }
}

/** Realise an agent derivation in `$host`'s store and commit its required GC
 *  root. A flake-backed derivation gives one remote-store `nix build` ownership
 *  of evaluation, transfer, and realisation. Returns the target-store output
 *  path, ready for `ssh $host $agentPath/bin/...`. */
export async function provisionAgent(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const isLocal = isLocalHost(opts.host);
  // ONE policy for the whole provisioning: every ssh below — and the ssh Nix
  // forks for the remote store — carries the SAME one, because they share a
  // `ControlMaster` keyed by it (see `controlMaster.ts`). Required on the
  // options, so that is a type fact rather than a defaulting site that has to
  // agree with eight others; and validity is a fact the value carries
  // (`sshKeepalive` is its only producer), so nothing is re-checked here.
  const { signal, budgets, keepalive } = opts;
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
  //    substitution, instant). It is what delivery (1–3, 5) asks the host
  //    about and copies. `-q --outputs` prints ONE line PER OUTPUT — the agent
  //    contract is single-output (see `multiOutputError`), so a >1 result
  //    fails loud; a failed query (GC collected the evaluated .drv) leaves
  //    `undefined` and provisioning falls through to the cold build, which
  //    re-establishes the truth itself.
  const outsRes = await runNix(
    "localhost",
    ["nix-store", "-q", "--outputs", drvPath],
    { policy: probePolicy(), signal },
  );
  const outputs = parseOutputs(outsRes.stdout);
  if (outsRes.ok && outputs.length > 1) {
    return multiOutputError(opts.host, outputs.length);
  }
  const localAgentPath = outsRes.ok ? outputs[0] : undefined;

  if (localAgentPath === undefined) {
    if (!isLocal) {
      // Step 0's local query missed (GC took the evaluated .drv), so there is
      // no path to ask the host about — say THAT. Name what the query said, so
      // a GC'd or unreadable `.drv` is on record rather than thrown away (an
      // aborted query has nothing to say).
      const why =
        outsRes.ok || outsRes.kind === "aborted"
          ? ""
          : ` (${describeNixRun(outsRes)})`;
      opts.onProgress(
        `${opts.host}: agent output path unknown locally${why} — skipping the cached-agent check; the cold provision re-establishes it`,
      );
    }
    opts.onProvisioning?.();
  } else {
    // 1–3, 5. Deliver the closure WITHOUT building it — the whole point of
    //    the binary cache. Delivered ⇒ the agent output is already valid and
    //    rooted in the target store, so the cold build has nothing left to do:
    //    the short-circuit is where the cache actually pays off, since the
    //    build it skips is a full flake evaluation plus an ssh-ng round trip.
    const delivered = await deliverClosure({
      host: opts.host,
      // The system the `.drv` is built for — the target's, since the caller
      // chose the derivation for it — read off it only when the warm check
      // misses.
      system: () => derivationSystem(drvPath, signal),
      outPath: localAgentPath,
      binaryCache: opts.derivation.binaryCache,
      rootPath,
      onProgress: opts.onProgress,
      onActivity: opts.onActivity,
      onDelivering: opts.onProvisioning,
      budget: budgets.provisioning,
      signal,
      keepalive,
    });
    if (delivered.ok) return { ok: true, agentPath: delivered.outPath };
    if (delivered.kind === "failed") {
      const { kind: _kind, ...failure } = delivered;
      return failure;
    }
    // Not delivered: realising on the host is provisioning's fallback (a
    // remote daemon substitutes per ITS OWN nix.conf, or builds).
    if (!isLocal)
      opts.onProgress(
        `${opts.host}: the host will realise the agent with its own substituters`,
      );
  }

  // 4. Provision the cold target in ONE Nix process. `--eval-store auto`
  //    keeps flake evaluation in the caller's store while `--store ssh-ng://…`
  //    makes the destination store own transfer and realisation. Nix therefore
  //    carries its temporary roots across the whole evaluation→copy→build
  //    lifetime; there is no command boundary at which remote GC can collect the
  //    transferred derivation. Localhost uses the same installable without the
  //    remote-store split.
  opts.onProgress(
    isLocal
      ? `localhost: realising '${drvPath}'…`
      : `${opts.host}: provisioning '${drvPath}' on remote…`,
  );
  const installable =
    opts.derivation.kind === "flake-installable"
      ? opts.derivation.installable
      : `${drvPath}^*`;
  const provisionArgs: [string, ...string[]] = [
    "nix",
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
  const realiseRes = await runNix("localhost", provisionArgs, {
    narrate: opts.onProgress,
    onActivity: opts.onActivity,
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
      reason: `${opts.host}: 'nix build' failed: ${describeNixRun(realiseRes)}`,
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
  opts.onProgress(`${opts.host}: agent realised at ${agentPath}`);

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
      opts.onActivity,
      budgets.provisioning,
      signal,
    );
    if (bail) return bail;
  }

  budgets.provisioning.reset();
  return { ok: true, agentPath };
}
