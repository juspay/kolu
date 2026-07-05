/**
 * `converge()` — the impure orchestrator over the pure {@link decide} table. It probes
 * the running daemon's identity over a VERSION-AGNOSTIC channel (Pin 3: identity is read
 * BEFORE any versioned-surface handshake, so it keeps working when the versioned
 * handshake would refuse), asks `decide` what to do, ENACTS the daemon-affecting decision
 * via the endpoint's existing boot methods (never any endpoint surgery — the mechanism is
 * unchanged, only the DECISION is lifted here), and RETURNS a typed
 * {@link ConvergenceOutcome}. It performs NO nudge / surface side effect: a `nudge-human`
 * build mismatch comes back as `mismatch-reported` and the CALLER surfaces it (the kit
 * detects + decides; the caller enacts what it owns).
 *
 * Enactment maps each decision to an EXISTING endpoint boot method, so both daemons stay
 * byte-identical to their pre-kit mechanism:
 *   - spawn / adopt / report-mismatch / refuse → `adoptOrSpawnOrRefuse` (adopt a compatible
 *     survivor, refuse a skew → degraded, or spawn fresh — never recycles).
 *   - recycle                                  → `adoptOrEnsure` (recycle-on-skew: kill +
 *     respawn a skewed survivor, kaval's arm).
 *   - drain-and-replace                        → drain the survivor over its handshake (Pin
 *     1 guarantees a drain verb), then `adoptOrSpawnOrRefuse` spawns our own build; the
 *     build fence is spent even on drain failure (degraded-loudly, never a livelock).
 */

import {
  buildLabel,
  type ConvergenceIdentity,
  type Logger,
} from "@kolu/surface-daemon";
import { decide } from "./decide.ts";
import type { BuildDrainFence } from "./fence.ts";
import type { ConvergencePolicy, DrainCapability } from "./policy.ts";

/** The endpoint boot methods `converge` enacts through — a `Pick` of the real `Endpoint`,
 *  so both the live endpoint and a test spy satisfy it. Both resolve to whether a survivor
 *  was adopted. */
export interface ConvergenceEndpoint {
  /** Adopt a compatible survivor, refuse a skew (→ degraded), or spawn fresh — NEVER
   *  recycles. The never-recycle bind (padi's boot policy). */
  adoptOrSpawnOrRefuse: () => Promise<boolean>;
  /** Recycle a skewed survivor (kill + respawn) then bind — the recycle-on-skew bind
   *  (kaval's boot policy). */
  adoptOrEnsure: () => Promise<boolean>;
}

/** A live probe of a running daemon over its version-agnostic identity channel. `identity`
 *  is read regardless of contract compatibility (Pin 3); `dispose` drops the probe socket. */
export interface ConvergenceProbeBase {
  readonly identity: ConvergenceIdentity;
  dispose(): void;
}

/** A drain-capable probe — its handshake exposes a `drain` verb, so a `drain-and-replace`
 *  policy is spellable for it (Pin 1). */
export interface DrainableProbe extends ConvergenceProbeBase {
  readonly capability: "drainable";
  /** Persist + exit the running daemon (its children survive), the caller observing the
   *  socket close. */
  drain(): Promise<void>;
}

/** A non-drainable probe — no `drain` verb, so no drain policy can be declared for it. */
export interface PlainProbe extends ConvergenceProbeBase {
  readonly capability: "not-drainable";
}

/** The probe shape for a given capability — `converge` ties the policy's `Cap` to this, so
 *  a drain policy requires a drainable probe (Pin 1). */
export type ConvergenceProbe<Cap extends DrainCapability> =
  Cap extends "drainable" ? DrainableProbe : PlainProbe;

type AnyConvergenceProbe = DrainableProbe | PlainProbe;

/** The typed outcome `converge` returns; the CALLER wires it to its own surfaces/logs.
 *  `drained-replacing`/`mismatch-reported` carry `adopted` — whether the follow-on bind
 *  adopted a survivor (true only on the degraded fallback where the drain didn't land, or
 *  the compatible survivor a mismatch is reported over).
 *
 *  `not-adopted` is DELIBERATELY imprecise: the endpoint's bind methods return only a
 *  boolean (`true` = a survivor was adopted), so a `false` cannot be resolved to "spawned
 *  fresh" vs "found a survivor but left it standing degraded" (the non-skew connect-failure
 *  path in `adoptSurvivor`). We report exactly what the boolean proves — NOT adopted — and
 *  never overclaim a `spawned` the endpoint can't attest. The endpoint surfaces the degraded
 *  case itself, loudly, via `onStatus`; the caller keys its own effects on `adopted`. */
export type ConvergenceOutcome =
  | { readonly kind: "adopted" }
  | { readonly kind: "not-adopted" }
  | { readonly kind: "recycled"; readonly adopted: boolean }
  | { readonly kind: "refused"; readonly adopted: boolean }
  | {
      readonly kind: "drained-replacing";
      readonly axis: "contract" | "build";
      /** The drained survivor's identity — so the caller can log its own domain
       *  breadcrumb (e.g. padi's `#1670` build-change line) from the returned outcome. */
      readonly running: ConvergenceIdentity;
      readonly adopted: boolean;
    }
  | {
      readonly kind: "mismatch-reported";
      readonly running: ConvergenceIdentity;
      readonly adopted: boolean;
    };

/** Whether a survivor was ADOPTED (its children preserved), across every outcome kind —
 *  the one fact a caller's reconcile step keys on. The `recycle`/`refuse` decisions are
 *  chosen from the primary probe, but the endpoint's bind re-checks the primary AND the
 *  W2.2 adopt-hint the single probe never saw, so either can still ADOPT a compatible
 *  survivor; this reads the bind's REAL result rather than the decision's intent. */
export function outcomeAdopted(outcome: ConvergenceOutcome): boolean {
  if (outcome.kind === "adopted") return true;
  if (outcome.kind === "not-adopted") return false;
  return outcome.adopted;
}

export async function converge<Cap extends DrainCapability>(args: {
  endpoint: ConvergenceEndpoint;
  /** The supervisor's OWN baked identity — the daemon it would spawn. */
  baked: ConvergenceIdentity;
  /** Read the running daemon's identity over its version-agnostic channel, or `null` if
   *  none answers (a fresh boot / mid-teardown). */
  probe: () => Promise<ConvergenceProbe<Cap> | null>;
  policy: ConvergencePolicy<Cap>;
  buildFence: BuildDrainFence;
  log: Logger;
}): Promise<ConvergenceOutcome> {
  const probe: AnyConvergenceProbe | null = await args.probe();

  // The bind method is chosen by the POLICY, not the decision: a recycle-on-skew daemon
  // (kaval) binds through `adoptOrEnsure` on EVERY path — so a skew recycles wherever the
  // endpoint finds it, INCLUDING the adopt-hint the single probe never saw (the W2.2
  // legacy-port migration); a refuse/drain daemon (padi) binds through the never-recycle
  // `adoptOrSpawnOrRefuse`. This keeps both daemons byte-identical to their pre-kit boot
  // method — the kit lifts only the DECISION, never the endpoint mechanism.
  const bind =
    args.policy.onContractSkew.kind === "recycle"
      ? args.endpoint.adoptOrEnsure
      : args.endpoint.adoptOrSpawnOrRefuse;

  // No live survivor at the primary → bind (spawn fresh, or — for a recycle-on-skew
  // daemon — adopt/recycle the endpoint's hint).
  if (probe === null) {
    const adopted = await bind();
    return adopted ? { kind: "adopted" } : { kind: "not-adopted" };
  }

  try {
    const decision = decide(
      args.baked,
      probe.identity,
      args.policy,
      args.buildFence.hasFired(),
    );
    // The skew/mismatch log context every logging arm shares — running vs mine on both
    // axes. `probe` is non-null here (the null case returned above), so one mapping site.
    const skewCtx = {
      runningContract: probe.identity.contractVersion,
      mineContract: args.baked.contractVersion,
      runningBuild: buildLabel(probe.identity.build),
      mineBuild: buildLabel(args.baked.build),
    };
    switch (decision.kind) {
      case "spawn":
      case "adopt": {
        const adopted = await bind();
        return adopted ? { kind: "adopted" } : { kind: "not-adopted" };
      }
      case "recycle": {
        args.log.warn(
          skewCtx,
          "convergence: recycling a contract-skewed survivor (kill + respawn)",
        );
        // recycle-on-skew policy → bind is `adoptOrEnsure`. Thread its REAL result: the
        // endpoint re-checks the primary AND the W2.2 adopt-hint (either can ADOPT a
        // compatible survivor the single probe never saw), so the caller's reconcile must
        // see what the bind actually did, not the decision's recycle intent.
        const adopted = await bind();
        return { kind: "recycled", adopted };
      }
      case "refuse": {
        args.log.warn(
          skewCtx,
          "convergence: REFUSING a skewed survivor — left standing + degraded, never touched",
        );
        // refuse/drain policy → bind is `adoptOrSpawnOrRefuse`. Thread its REAL result: a
        // race between the probe and the bind's own connect can ADOPT rather than refuse.
        const adopted = await bind();
        return { kind: "refused", adopted };
      }
      case "drain-and-replace": {
        // Spend the fence for a BUILD drain BEFORE the await, so even a drain failure
        // spends it (degraded-loudly, never a retry that could livelock two supervisors).
        if (decision.axis === "build") args.buildFence.markFired();
        args.log.info(
          { axis: decision.axis, ...skewCtx },
          "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
        );
        // Pin 1 at runtime: `decide` only returns drain-and-replace for a drainable policy,
        // which `converge` only accepts with a drainable probe — so `drain` exists. Fail
        // loudly (never silently) if that invariant is ever violated.
        if (probe.capability !== "drainable") {
          throw new Error(
            "convergence: drain-and-replace decided for a non-drainable probe — unreachable by Pin 1",
          );
        }
        try {
          await probe.drain();
        } catch (err) {
          args.log.error(
            { err, axis: decision.axis, ...skewCtx },
            "convergence: drain FAILED (daemon did not exit) — NOT killing it; the follow-on bind adopts/refuses the still-standing survivor (degraded, logged), and the fence stays spent so no reconnect re-drains",
          );
        }
        const adopted = await bind(); // drain policy → bind is `adoptOrSpawnOrRefuse`.
        return {
          kind: "drained-replacing",
          axis: decision.axis,
          running: probe.identity,
          adopted,
        };
      }
      case "report-mismatch": {
        // No supervisor action on the BUILD — the caller surfaces the mismatch (the
        // currency nudge). The bind still runs to ADOPT the compatible survivor (its
        // children preserved): for kaval that is `adoptOrEnsure`, which adopts a
        // compatible daemon regardless of build, exactly as before the kit.
        const adopted = await bind();
        return {
          kind: "mismatch-reported",
          running: decision.running,
          adopted,
        };
      }
      default: {
        const _exhaustive: never = decision;
        throw new Error(
          `unreachable convergence decision: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  } finally {
    probe.dispose();
  }
}
