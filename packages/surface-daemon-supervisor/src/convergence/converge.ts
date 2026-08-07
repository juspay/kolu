/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: probe → decide → budget-gated drain → private bind methods.
 *
 * Accepts only a genuine {@link createEndpoint} handle (F12 WeakMap brand).
 *
 * **Two composed authorities** (match the supervisor Reference page):
 *
 * 1. **`foldObserved`** — every *observation* (initial probe, bind characterization,
 *    post-drain successor, post-give-up characterization, drainable re-probe):
 *    folds through `decide(policy, identity | null)`; owns probe dispose (transfer
 *    only into the drain body); reports `running: null` when unknown; preserves
 *    four-valued characterizations (characterized | absent | failed | uncorrelated).
 *
 * 2. **`consumeBindResult`** — every *bind transition* (plain | recycle | post-drain |
 *    give-up). Sole switch on BindResult arms; owns releaseHeld / heldBind and
 *    outcome decorations (recycled, drained-replacing, adopt-bind-failed). Call sites
 *    never inspect `r.kind`. Spawned-fresh / refused-or-failed return here without
 *    re-entering `foldObserved`.
 */

import {
  buildLabel,
  type ConvergenceIdentity,
  type Logger,
} from "@kolu/surface-daemon";
import { Effect, Ref } from "effect";
import type { ConvergenceAnomaly, RefusedAnomaly } from "./anomaly.ts";
import type { BindResult } from "./bindResult.ts";
import {
  type DrainAdmission,
  type DrainBudgetHandle,
  type DrainLineage,
  budgetInternal,
  drainBudgetOf,
} from "./budget.ts";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "./drainAndAwaitExit.ts";
import { decide, type Decision } from "./decide.ts";
import { giveUpOutcome } from "./giveUp.ts";
import {
  type InstanceKey,
  instanceKeyFromStartedAt,
  instanceKeyTag,
} from "./instanceKey.ts";
import type { ConvergencePolicy, DrainCapability } from "./policy.ts";
import {
  isUnspeakablePeerError,
  unspeakableClause,
  type UnspeakablePeerError,
} from "./unspeakable.ts";
import { endpointPrivate, type TakeoverResult } from "../endpoint.private.ts";
import type { Endpoint } from "../endpoint.ts";

export interface ConvergenceProbeBase {
  readonly identity: ConvergenceIdentity;
  readonly instanceKey: InstanceKey;
  dispose(): void;
}

export interface DrainableProbe extends ConvergenceProbeBase {
  readonly capability: "drainable";
  /** Fire the daemon's drain verb. Fire-and-forget — ground truth is
   *  {@link DrainableProbe.awaitExit}, so a failure here is recorded, never
   *  believed. */
  readonly fireDrain: Effect.Effect<void, unknown>;
  /** Observe that the daemon process actually left (F3). Its error channel is
   *  `never` BY TYPE: a link blip is not an exit, and an oracle that cannot
   *  confirm must simply not succeed — the framework's ceiling decides. It needs
   *  no AbortSignal: the framework forks it into a scope it closes the instant
   *  the race is over, so a poll-based oracle is interrupted rather than asked
   *  to notice. */
  readonly awaitExit: Effect.Effect<void>;
  readonly drainCeilingMs: number;
}

export interface PlainProbe extends ConvergenceProbeBase {
  readonly capability: "not-drainable";
}

export type ConvergenceProbe<Cap extends DrainCapability> =
  Cap extends "drainable" ? DrainableProbe : PlainProbe;

type AnyConvergenceProbe = DrainableProbe | PlainProbe;

export type ConvergenceOutcome =
  | { readonly kind: "adopted" }
  | {
      readonly kind: "adopted-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    }
  | { readonly kind: "not-adopted" }
  | { readonly kind: "spawned-fresh" }
  | { readonly kind: "recycled"; readonly bind: BindResult }
  | {
      readonly kind: "refused";
      readonly adopted: false;
      readonly anomaly: RefusedAnomaly;
    }
  | {
      readonly kind: "drained-replacing";
      readonly axis: "contract" | "build";
      readonly running: ConvergenceIdentity;
      readonly bind: BindResult;
    }
  | {
      readonly kind: "mismatch-reported";
      readonly running: ConvergenceIdentity;
      readonly bind: BindResult;
    };

export function outcomeAdopted(outcome: ConvergenceOutcome): boolean {
  switch (outcome.kind) {
    case "adopted":
    case "adopted-stale":
      return true;
    case "not-adopted":
    case "spawned-fresh":
    case "refused":
      return false;
    case "recycled":
    case "drained-replacing":
    case "mismatch-reported":
      return outcome.bind.kind === "adopted-resident";
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`unreachable outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function outcomeAnomaly(
  outcome: ConvergenceOutcome,
): ConvergenceAnomaly | null {
  switch (outcome.kind) {
    case "adopted-stale":
    case "refused":
      return outcome.anomaly;
    case "adopted":
    case "not-adopted":
    case "spawned-fresh":
    case "recycled":
    case "drained-replacing":
    case "mismatch-reported":
      return null;
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`unreachable outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ── Observation model ───────────────────────────────────────────────────────

/**
 * Five-valued observation. `bound` distinguishes a probe-origin observation
 * (may still need a bind) from a characterization of an already-held connection
 * — encoded here so the fold never consults a separate `holding` mirror.
 *
 * `unspeakable` is the THIRD narrowly-typed peer observation D6/#3 adds beside
 * "identity" and "absent": something IS serving our rendezvous, we proved it is
 * our daemon (our gate, verified pid), and it does not speak our protocol at
 * all. It arrives ONLY as a corroborated {@link UnspeakablePeerError}; an
 * uncorroborated decode failure stays `failed` (probe-failed), which is what
 * keeps a foreign socket-squatter untouched.
 */
type Observation =
  | {
      readonly kind: "identity";
      readonly identity: ConvergenceIdentity;
      readonly instanceKey: InstanceKey;
      readonly drainable: DrainableProbe | null;
      readonly dispose: () => void;
      /** True when this identity came from a held bind's characterization. */
      readonly bound: boolean;
    }
  | {
      readonly kind: "absent";
      /** True when a held bind's characterization was empty (unverifiable). */
      readonly bound: boolean;
    }
  | { readonly kind: "uncorrelated" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "unspeakable";
      readonly peer: UnspeakablePeerError;
    };

type FoldCtx = {
  readonly policy: ConvergencePolicy<DrainCapability>;
  readonly budget: DrainBudgetHandle | null;
  readonly expected: ConvergenceIdentity;
  readonly log: Logger;
  /**
   * Request a bind. A THUNK over the bind effect rather than the effect itself,
   * deliberately: the W8–W11 confinement pin in `converge.test.ts` parses this
   * file and requires every `.bind()` CALL to sit as
   * `consumeBindResult(yield* …, …)`. A bare `.bind` field read would move the
   * confinement question from "is every call consumed" to "is every read
   * consumed", which is a weaker thing to check for the same guarantee.
   */
  readonly bind: () => Effect.Effect<BindResult, Error>;
  readonly releaseHeld: () => void;
  /** The last identity any observation reported, for the anomalies that must
   *  name what was running. Written from several arms of the recursion, so it is
   *  a `Ref` rather than a mutable field. */
  readonly lastKnownRunning: Ref.Ref<ConvergenceIdentity | null>;
  readonly resolveDrainable: () => Effect.Effect<Observation, Error>;
  /**
   * The cross-epoch TAKEOVER (re-attest the corroborated pid, stop it, spawn
   * fresh). Used by exactly ONE arm — the `unspeakable` observation — because
   * `bind` cannot serve it: the ordinary adopt-or-recycle path only recycles a
   * survivor the soul's `connect` PROVED to be a skew, and an unspeakable peer
   * proves nothing to a `connect` that cannot speak to it either (it fails
   * non-skew ⇒ "unreachable" ⇒ left standing). This disposition needs the kill,
   * so it names the bind that kills.
   */
  readonly takeOverHolder: (
    peer: UnspeakablePeerError,
  ) => Effect.Effect<TakeoverResult, Error>;
  readonly heldBind: Ref.Ref<BindResult | null>;
  /**
   * When non-null, the drain budget is already spent (give-up path). decide still
   * folds every identity; enactment of drain-and-replace rides adopted-stale,
   * while a clean `adopt` returns adopted (W6.6).
   */
  readonly rideStale: Ref.Ref<Extract<
    ConvergenceAnomaly,
    { kind: "adopted-stale" }
  > | null>;
};

function lineageOf(
  identity: ConvergenceIdentity,
  instanceKey: InstanceKey,
): DrainLineage {
  return { build: identity.build, instanceKey };
}

function skewCtxOf(
  running: ConvergenceIdentity,
  expected: ConvergenceIdentity,
): Record<string, string> {
  return {
    runningContract: running.contractVersion,
    mineContract: expected.contractVersion,
    runningBuild: buildLabel(running.build),
    mineBuild: buildLabel(expected.build),
  };
}

/** The ONE narrowing. A CORROBORATED unspeakable peer (our gate, our verified
 *  pid — see `endpoint.ts`) is its own observation; every other raised value,
 *  including an UNcorroborated first-frame decode failure, stays probe-failed.
 *  Widening this predicate would be the regression `bindResult.ts` warns about
 *  and would put a SIGTERM near a foreign socket-squatter. */
function classifyProbeRaise(err: unknown): Observation {
  if (isUnspeakablePeerError(err)) return { kind: "unspeakable", peer: err };
  return {
    kind: "failed",
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Run a probe and fold whatever it did into one {@link Observation}.
 *
 * A probe FAILURE and a probe DEFECT are classified identically, because the
 * `try`/`catch` this replaces could not tell them apart and the design does not
 * want it to: a probe that cannot answer is an observation the fold reports as
 * `probe-failed`, never an exception that takes a boot down (the F2 cases pin
 * exactly that — "not unhandled"). INTERRUPTION is deliberately not caught by
 * either combinator: a converge the caller abandoned must stay abandoned, not
 * report itself as a failed probe.
 */
function observeProbe(
  run: Effect.Effect<AnyConvergenceProbe | null, unknown>,
): Effect.Effect<Observation> {
  return run.pipe(
    Effect.map(
      (p): Observation =>
        p === null
          ? { kind: "absent", bound: false }
          : {
              kind: "identity",
              identity: p.identity,
              instanceKey: p.instanceKey,
              drainable: p.capability === "drainable" ? p : null,
              dispose: () => p.dispose(),
              bound: false,
            },
    ),
    Effect.catch((err) => Effect.succeed(classifyProbeRaise(err))),
    Effect.catchDefect((err) => Effect.succeed(classifyProbeRaise(err))),
  );
}

function observationFromCharacterization(
  c: Extract<BindResult, { kind: "adopted-resident" }>["characterization"],
): Observation {
  switch (c.kind) {
    case "characterized":
      return {
        kind: "identity",
        identity: c.identity,
        instanceKey: c.instanceKey,
        drainable: null,
        dispose: () => {},
        bound: true,
      };
    case "absent":
      return { kind: "absent", bound: true };
    case "uncorrelated":
      return { kind: "uncorrelated" };
    case "failed":
      return { kind: "failed", message: c.message };
    default: {
      const _e: never = c;
      throw new Error(`unreachable characterization: ${JSON.stringify(_e)}`);
    }
  }
}

function probeFailedOutcome(args: {
  message: string;
  expected: ConvergenceIdentity;
  running: ConvergenceIdentity | null;
  log: Logger;
  releaseHeld: () => void;
}): ConvergenceOutcome {
  args.releaseHeld();
  const cause = { kind: "probe-failed" as const, message: args.message };
  const detail = `convergence probe failed: ${args.message}`;
  args.log.error({}, `convergence: UNCONVERGED — ${detail}`);
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "unconverged",
      running: args.running,
      expected: args.expected,
      cause,
      detail,
    },
  };
}

/**
 * The ONE arm on which a corroborated unspeakable peer is NOT taken over: the
 * gate stopped naming the pid we classified, somewhere between the probe and the
 * kill.
 *
 * Nothing was signalled. That is the point: a holder we have not proven
 * unspeakable is a holder we do not touch, and the daemon standing there now was
 * never observed at all — it may be a perfectly healthy daemon of this epoch
 * that replaced the old one while we were deciding. So this pass refuses, loudly
 * and with the evidence, and the caller's next converge decides against a fresh
 * observation (the reconnect loop already runs one).
 */
function takeoverUntouchedOutcome(args: {
  peer: UnspeakablePeerError;
  observed: number | undefined;
  expected: ConvergenceIdentity;
  running: ConvergenceIdentity | null;
  log: Logger;
  releaseHeld: () => void;
}): ConvergenceOutcome {
  args.releaseHeld();
  const holderNow =
    args.observed === undefined
      ? "no live holder our identity law accepts"
      : `pid ${args.observed}`;
  const detail =
    `the daemon holding ${args.peer.socketPath} ${unspeakableClause(args.peer.evidence)} — it speaks a ` +
    `protocol epoch this supervisor cannot decode — but by the time the takeover re-attested it, our ` +
    `gate ${args.peer.gatePath} named ${holderNow} rather than the classified pid ${args.peer.pid}. ` +
    "NOTHING was signalled: a holder this supervisor has not proven unspeakable is one it does not " +
    "touch. Converging again re-observes whoever is there now.";
  args.log.error(
    {
      socketPath: args.peer.socketPath,
      gatePath: args.peer.gatePath,
      pid: args.peer.pid,
      holderNow: args.observed,
      trigger: args.peer.evidence.trigger,
      mineContract: args.expected.contractVersion,
    },
    `convergence: UNCONVERGED — ${detail}`,
  );
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "unconverged",
      running: args.running,
      expected: args.expected,
      cause: {
        kind: "unspeakable-protocol",
        socketPath: args.peer.socketPath,
        gatePath: args.peer.gatePath,
        pid: args.peer.pid,
      },
      detail,
    },
  };
}

/**
 * Enact the `unspeakable` observation: **TAKE OVER** (PLAN D6 / Wave A).
 *
 * There is no policy switch here any more, and that is the change. The
 * contract-skew policy answers "what do I do about a daemon whose version I read
 * and dislike" — and this is not that question: an undecodable wire is not a
 * skew (a version is something you read off a wire you can speak), and the drain
 * verb the ordered padi policy would reach for does not exist on it. The old
 * reading concluded REFUSE from that and left the survivor standing, which meant
 * a cross-epoch upgrade could never converge without a human stopping a daemon
 * out of band.
 *
 * The act that IS available is the one the drain verb was only ever a way to
 * request: the daemon's own in-process shutdown, asked for with a signal instead
 * of a message. Every consumer wants it — kaval called it `recycle` already, and
 * padi's refusal was a statement about the wire mistaken for a statement about
 * the daemon — so it is one disposition, enacted the same way for both, and the
 * safety that used to be carried by the policy is carried where it belongs: by
 * the CORROBORATION (`endpoint.ts` proved the gate is ours and verified the pid)
 * and by the re-attestation immediately before the kill.
 *
 * `decide()` stays untouched: it folds an IDENTITY, and an unspeakable peer
 * never yielded one.
 */
function enactUnspeakable(
  peer: UnspeakablePeerError,
  ctx: FoldCtx,
): Effect.Effect<ConvergenceOutcome, Error> {
  return Effect.gen(function* () {
    const taken = yield* ctx.takeOverHolder(peer);
    if (taken.kind === "holder-changed") {
      return takeoverUntouchedOutcome({
        peer,
        observed: taken.observed,
        expected: ctx.expected,
        running: yield* Ref.get(ctx.lastKnownRunning),
        log: ctx.log,
        releaseHeld: ctx.releaseHeld,
      });
    }
    return yield* consumeBindResult(taken.spawned, ctx, { kind: "recycle" });
  });
}

function identityUnverifiableOutcome(args: {
  running: ConvergenceIdentity | null;
  expected: ConvergenceIdentity;
  log: Logger;
  releaseHeld: () => void;
}): ConvergenceOutcome {
  args.releaseHeld();
  const cause = { kind: "identity-unverifiable" as const };
  const runLabel =
    args.running === null ? "unknown" : buildLabel(args.running.build);
  const detail =
    `bound a resident whose identity the probe could not re-characterize ` +
    `(running was ${runLabel}; expected ${buildLabel(args.expected.build)})`;
  args.log.error({}, `convergence: UNCONVERGED — ${detail}`);
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "unconverged",
      running: args.running,
      expected: args.expected,
      cause,
      detail,
    },
  };
}

function skewRefusedOutcome(args: {
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  log: Logger;
  releaseHeld: () => void;
  detail: string;
}): ConvergenceOutcome {
  args.releaseHeld();
  args.log.warn(skewCtxOf(args.running, args.expected), args.detail);
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "skew-refused",
      running: args.running,
      expected: args.expected,
      detail: args.detail,
    },
  };
}

/**
 * THE single authority. Every observation and every bind transition that
 * participates in a convergence decision routes here.
 */
function foldObserved(
  obs: Observation,
  ctx: FoldCtx,
): Effect.Effect<ConvergenceOutcome, Error> {
  return Effect.gen(function* () {
    // Decided before anything else: an undecodable wire makes every downstream
    // question (identity, drain, adopt) unaskable, so there is nothing for `decide`
    // to fold. The give-up ride (`rideStale`) is deliberately not consulted — a
    // budget that governs how many times we may DRAIN a lineage says nothing about
    // a peer we cannot drain.
    if (obs.kind === "unspeakable") {
      return yield* enactUnspeakable(obs.peer, ctx);
    }

    if (obs.kind === "failed") {
      return probeFailedOutcome({
        message: obs.message,
        expected: ctx.expected,
        running: yield* Ref.get(ctx.lastKnownRunning),
        log: ctx.log,
        releaseHeld: ctx.releaseHeld,
      });
    }

    if (obs.kind === "uncorrelated") {
      return identityUnverifiableOutcome({
        running: yield* Ref.get(ctx.lastKnownRunning),
        expected: ctx.expected,
        log: ctx.log,
        releaseHeld: ctx.releaseHeld,
      });
    }

    if (obs.kind === "absent") {
      if (obs.bound) {
        return identityUnverifiableOutcome({
          running: yield* Ref.get(ctx.lastKnownRunning),
          expected: ctx.expected,
          log: ctx.log,
          releaseHeld: ctx.releaseHeld,
        });
      }
      // Probe-origin absence → decide(null) → spawn/bind via the authority.
      return yield* enactDecision(decide(ctx.policy, null), null, ctx);
    }

    // Identity: foldObserved owns dispose unless transferred into the drain loop.
    // `ensuring` rather than `finally`, so the dispose also runs when the fold is
    // interrupted — which a `finally` around an `await` could not promise.
    let transferred = false;
    yield* Ref.set(ctx.lastKnownRunning, obs.identity);
    return yield* enactDecision(decide(ctx.policy, obs.identity), obs, ctx, {
      transferDispose: () => {
        transferred = true;
      },
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!transferred) obs.dispose();
        }),
      ),
    );
  });
}

function enactDecision(
  decision: Decision,
  obs: Extract<Observation, { kind: "identity" }> | null,
  ctx: FoldCtx,
  dispose?: { transferDispose: () => void },
): Effect.Effect<ConvergenceOutcome, Error> {
  return Effect.gen(function* () {
    // Budget already spent (give-up): decide still owns the fold.
    const rideStale = yield* Ref.get(ctx.rideStale);
    if (rideStale !== null) {
      switch (decision.kind) {
        case "spawn":
        case "adopt":
          // W6.6: exact match after give-up is clean adopted, not mislabeled stale.
          return { kind: "adopted" } as const;
        case "drain-and-replace":
          return { kind: "adopted-stale", anomaly: rideStale } as const;
        case "report-mismatch": {
          if (obs === null) {
            throw new Error(
              "convergence: report-mismatch without identity observation",
            );
          }
          return {
            kind: "mismatch-reported",
            running: decision.running,
            bind:
              (yield* Ref.get(ctx.heldBind)) ??
              ({
                kind: "adopted-resident",
                characterization: {
                  kind: "characterized",
                  identity: obs.identity,
                  instanceKey: obs.instanceKey,
                },
              } satisfies BindResult),
          } as const;
        }
        case "refuse": {
          if (obs === null) {
            throw new Error("convergence: refuse without identity observation");
          }
          return skewRefusedOutcome({
            running: obs.identity,
            expected: ctx.expected,
            log: ctx.log,
            releaseHeld: ctx.releaseHeld,
            detail:
              `convergence: REFUSING give-up bind resident — left standing + degraded ` +
              `(running contract ${obs.identity.contractVersion}, mine ${ctx.expected.contractVersion})`,
          });
        }
        case "recycle":
          return yield* consumeBindResult(yield* ctx.bind(), ctx, {
            kind: "recycle",
          });
        default: {
          const _e: never = decision;
          throw new Error(`unreachable decision: ${JSON.stringify(_e)}`);
        }
      }
    }

    switch (decision.kind) {
      case "spawn":
      case "adopt": {
        // Already holding a characterized resident that matches → keep it.
        if (obs?.bound) return { kind: "adopted" } as const;
        // Need a bind; fold its result through the single BindResult consumer.
        return yield* consumeBindResult(yield* ctx.bind(), ctx, {
          kind: "plain",
        });
      }

      case "report-mismatch": {
        if (obs === null) {
          throw new Error(
            "convergence: report-mismatch without identity observation",
          );
        }
        // Already holding — report against the held characterization.
        const heldBind = yield* Ref.get(ctx.heldBind);
        if (obs.bound && heldBind !== null) {
          return {
            kind: "mismatch-reported",
            running: decision.running,
            bind: heldBind,
          } as const;
        }
        // Probe-origin mismatch: bind, then re-fold the NEW characterization
        // (never report the stale probe identity over a different held resident).
        return yield* consumeBindResult(yield* ctx.bind(), ctx, {
          kind: "plain",
        });
      }

      case "refuse": {
        if (obs === null) {
          throw new Error("convergence: refuse without identity observation");
        }
        return skewRefusedOutcome({
          running: obs.identity,
          expected: ctx.expected,
          log: ctx.log,
          releaseHeld: ctx.releaseHeld,
          detail:
            `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
            `(running contract ${obs.identity.contractVersion}, mine ${ctx.expected.contractVersion})`,
        });
      }

      case "recycle":
        return yield* consumeBindResult(yield* ctx.bind(), ctx, {
          kind: "recycle",
        });

      case "drain-and-replace": {
        if (ctx.budget === null || ctx.policy.capability !== "drainable") {
          throw new Error(
            "convergence: drain-and-replace without drain budget — unreachable by Pin 1",
          );
        }
        if (obs === null) {
          throw new Error(
            "convergence: drain-and-replace without identity observation",
          );
        }

        // Need drainable probe. If missing, resolve then re-fold (re-decide).
        // Current obs is disposed by foldObserved's `ensuring` after we return.
        if (obs.drainable === null) {
          const resolved = yield* ctx.resolveDrainable();
          return yield* foldObserved(resolved, ctx);
        }

        // Transfer dispose ownership into the drain body.
        dispose?.transferDispose();
        return yield* enactDrainOnce({
          initial: obs.drainable,
          disposeInitial: obs.dispose,
          axis: decision.axis,
          policy: ctx.policy as ConvergencePolicy<"drainable">,
          budget: ctx.budget,
          bind: ctx.bind,
          log: ctx.log,
          expected: ctx.expected,
          releaseHeld: ctx.releaseHeld,
          resolveDrainable: ctx.resolveDrainable,
          baseCtx: ctx,
        });
      }

      default: {
        const _e: never = decision;
        throw new Error(`unreachable decision: ${JSON.stringify(_e)}`);
      }
    }
  });
}

/**
 * Transition context for {@link consumeBindResult}. Callers decorate the
 * outcome (recycled / drained-replacing / adopt-bind-failed) via this tag —
 * they never inspect `r.kind` themselves.
 */
type BindTransition =
  | { readonly kind: "plain" }
  | { readonly kind: "recycle" }
  | {
      readonly kind: "post-drain";
      readonly axis: "contract" | "build";
      readonly running: ConvergenceIdentity;
    }
  | {
      readonly kind: "give-up";
      readonly axis: "contract" | "build";
      readonly running: ConvergenceIdentity;
      readonly detail: string;
    };

/**
 * THE sole BindResult consumer (W7.1). Every bind transition routes here:
 * release / heldBind updates live only in this switch. Call sites must not
 * inspect `r.kind`.
 */
function consumeBindResult(
  r: BindResult,
  ctx: FoldCtx,
  transition: BindTransition,
): Effect.Effect<ConvergenceOutcome, Error> {
  return Effect.gen(function* () {
    switch (r.kind) {
      case "spawned-fresh": {
        yield* Ref.set(ctx.heldBind, r);
        switch (transition.kind) {
          case "plain":
          case "give-up":
            return { kind: "spawned-fresh" } as const;
          case "recycle":
            return { kind: "recycled", bind: r } as const;
          case "post-drain":
            return {
              kind: "drained-replacing",
              axis: transition.axis,
              running: transition.running,
              bind: r,
            } as const;
          default: {
            const _e: never = transition;
            throw new Error(`unreachable transition: ${JSON.stringify(_e)}`);
          }
        }
      }
      case "refused-or-failed": {
        // Sole release site for a refused bind — call sites never hand-release.
        ctx.releaseHeld();
        switch (transition.kind) {
          case "plain":
          case "recycle":
            return { kind: "not-adopted" } as const;
          case "post-drain":
            return {
              kind: "refused",
              adopted: false,
              anomaly: {
                kind: "unconverged",
                running: transition.running,
                expected: ctx.expected,
                cause: { kind: "adopt-bind-failed", axis: transition.axis },
                detail:
                  "bind refused or failed after admitted drain of bound resident",
              },
            } as const;
          case "give-up":
            return {
              kind: "refused",
              adopted: false,
              anomaly: {
                kind: "unconverged",
                running: transition.running,
                expected: ctx.expected,
                cause: { kind: "adopt-bind-failed", axis: transition.axis },
                detail: transition.detail,
              },
            } as const;
          default: {
            const _e: never = transition;
            throw new Error(`unreachable transition: ${JSON.stringify(_e)}`);
          }
        }
      }
      case "adopted-resident": {
        yield* Ref.set(ctx.heldBind, r);
        if (transition.kind === "post-drain" || transition.kind === "give-up") {
          yield* Ref.set(ctx.lastKnownRunning, transition.running);
        }
        const folded = yield* foldObserved(
          observationFromCharacterization(r.characterization),
          ctx,
        );
        // Post-drain clean adopt is the drain success story — decorate.
        if (transition.kind === "post-drain" && folded.kind === "adopted") {
          return {
            kind: "drained-replacing",
            axis: transition.axis,
            running: transition.running,
            bind: r,
          } as const;
        }
        return folded;
      }
      default: {
        const _e: never = r;
        throw new Error(`unreachable BindResult: ${JSON.stringify(_e)}`);
      }
    }
  });
}

// ── Drain enactment (single body; successor re-entry is recursive) ──────────

function enactDrainOnce(args: {
  initial: DrainableProbe;
  disposeInitial: () => void;
  axis: "contract" | "build";
  policy: ConvergencePolicy<"drainable">;
  budget: DrainBudgetHandle;
  bind: () => Effect.Effect<BindResult, Error>;
  log: Logger;
  expected: ConvergenceIdentity;
  releaseHeld: () => void;
  resolveDrainable: () => Effect.Effect<Observation, Error>;
  baseCtx: FoldCtx;
}): Effect.Effect<ConvergenceOutcome, Error> {
  const baked = args.expected;
  const current = args.initial;
  const axis = args.axis;

  return Effect.gen(function* () {
    const why =
      axis === "contract"
        ? `contract skew (mine ${baked.contractVersion} newer than running ${current.identity.contractVersion})`
        : `build mismatch (running=${buildLabel(current.identity.build)} expected=${buildLabel(baked.build)})`;
    const admission = yield* budgetInternal(args.budget).admit(
      lineageOf(current.identity, current.instanceKey),
      why,
    );

    if (admission.kind === "giveUp") {
      return yield* enactGiveUp({
        admission,
        onGiveUp: drainBudgetOf(args.budget).onGiveUp,
        axis,
        running: current.identity,
        expected: baked,
        bind: args.bind,
        log: args.log,
        policy: args.policy,
        releaseHeld: args.releaseHeld,
        baseCtx: args.baseCtx,
      });
    }

    args.log.info(
      {
        axis,
        attempt: admission.attempt,
        ...skewCtxOf(current.identity, baked),
      },
      "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
    );
    const drain = yield* drainAndAwaitExit(
      current.fireDrain,
      current.awaitExit,
      { ceilingMs: current.drainCeilingMs },
    );
    if (!drain.took) {
      args.log.error(
        { axis, ...skewCtxOf(current.identity, baked) },
        `convergence: drain FAILED — not taken within ${current.drainCeilingMs}ms` +
          drainRejectionSuffix(drain.drainRejection),
      );
      return yield* enactGiveUp({
        admission: {
          kind: "giveUp",
          why: "budget",
          axisHint: why,
          attempts: admission.attempt,
          maxAttempts: drainBudgetOf(args.budget).maxAttempts,
          instanceKey: current.instanceKey,
        },
        onGiveUp: drainBudgetOf(args.budget).onGiveUp,
        axis,
        running: current.identity,
        expected: baked,
        bind: args.bind,
        log: args.log,
        policy: args.policy,
        drainNotTaken: {
          ceilingMs: current.drainCeilingMs,
          rejection: drain.drainRejection,
        },
        releaseHeld: args.releaseHeld,
        baseCtx: args.baseCtx,
      });
    }

    // Sole BindResult consumer — no local r.kind switch (W7.1).
    return yield* consumeBindResult(yield* args.bind(), args.baseCtx, {
      kind: "post-drain",
      axis,
      running: current.identity,
    });
  }).pipe(
    // The drain body owns the transferred probe from here on — and `ensuring`
    // rather than `finally`, so an interrupted drain still disposes it.
    Effect.ensuring(Effect.sync(args.disposeInitial)),
  );
}

function enactGiveUp(args: {
  admission: Extract<DrainAdmission, { kind: "giveUp" }>;
  onGiveUp: "refuse" | "adopt-stale";
  axis: "contract" | "build";
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  bind: () => Effect.Effect<BindResult, Error>;
  log: Logger;
  policy: ConvergencePolicy<DrainCapability>;
  drainNotTaken?: { ceilingMs: number; rejection: string | null };
  releaseHeld: () => void;
  baseCtx: FoldCtx;
}): Effect.Effect<ConvergenceOutcome, Error> {
  return Effect.gen(function* () {
    const g = giveUpOutcome({
      admission: args.admission,
      onGiveUp: args.onGiveUp,
      axis: args.axis,
      running: args.running,
      expected: args.expected,
      log: args.log,
      skewCtx: skewCtxOf(args.running, args.expected),
      logPrefix: "convergence",
      drainNotTaken: args.drainNotTaken,
    });

    if (g.kind === "adopt-stale") {
      // rideStale so characterization re-decide never re-enters drain (W6.6).
      yield* Ref.set(args.baseCtx.rideStale, g.anomaly);
      // Sole BindResult consumer — no local r.kind switch (W7.1).
      return yield* consumeBindResult(yield* args.bind(), args.baseCtx, {
        kind: "give-up",
        axis: args.axis,
        running: args.running,
        detail: g.anomaly.detail,
      });
    }

    args.releaseHeld();
    return { kind: "refused", adopted: false, anomaly: g.anomaly } as const;
  });
}

// ── Public entry ────────────────────────────────────────────────────────────

export function converge<
  C,
  I,
  M = undefined,
  Cap extends DrainCapability = DrainCapability,
>(endpoint: Endpoint<C, I, M, Cap>): Effect.Effect<ConvergenceOutcome, Error> {
  return Effect.gen(function* () {
    const binds = endpointPrivate(endpoint);
    const policy = endpoint.policy;
    const expected = policy.baked;

    const releaseHeld = (): void => binds.releaseHeld();
    const bind =
      policy.onContractSkew.kind === "recycle"
        ? () => binds.adoptOrEnsure
        : () => binds.adoptOrSpawnOrRefuse;

    // `suspend`, so each resolve asks the endpoint for a FRESH probe rather than
    // re-running one description built once at converge entry.
    const resolveDrainable = (): Effect.Effect<Observation> =>
      observeProbe(Effect.suspend(() => endpoint.probe()));

    // The cross-epoch takeover: re-attest the corroborated holder, stop it (SIGTERM
    // → bounded wait → SIGKILL → bounded wait), then spawn + connect + hold a fresh
    // daemon. It reports `dead` and fails on failure (the endpoint's own
    // contract), which propagates out of `converge` exactly as a failing `bind`
    // already does — a takeover that could not happen must not be reported as a
    // bind that merely refused.
    const takeOverHolder = (
      peer: UnspeakablePeerError,
    ): Effect.Effect<TakeoverResult, Error> => binds.takeOver(peer);

    const ctx: FoldCtx = {
      policy,
      budget: endpoint.budget,
      expected,
      log: endpoint.log,
      bind,
      releaseHeld,
      lastKnownRunning: yield* Ref.make<ConvergenceIdentity | null>(null),
      resolveDrainable,
      takeOverHolder,
      heldBind: yield* Ref.make<BindResult | null>(null),
      rideStale: yield* Ref.make<Extract<
        ConvergenceAnomaly,
        { kind: "adopted-stale" }
      > | null>(null),
    };

    // Every observation — including initial absence and failure — through the
    // single authority. No public-tail bind shortcuts.
    const initial = yield* observeProbe(Effect.suspend(() => endpoint.probe()));
    return yield* foldObserved(initial, ctx);
  });
}

export { instanceKeyFromStartedAt, instanceKeyTag };
