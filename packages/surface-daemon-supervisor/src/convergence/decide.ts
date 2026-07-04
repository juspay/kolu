/**
 * The PURE convergence decision — the fold-style core of the kit. Given the supervisor's
 * baked identity, the running daemon's identity (or `null`), the policy map, and whether
 * the once-per-boot build fence is already spent, it returns a typed {@link Decision}
 * with ZERO I/O. `converge()` enacts the decision; the whole policy TABLE is unit-tested
 * here against `decide` directly, no daemons.
 *
 * Two axes, evaluated in order — a contract skew decides alone (the build id is
 * irrelevant across a wire break); a compatible contract falls through to the build axis.
 * The absent / off-nix / fence cases are TABLE ROWS, not special cases:
 *   - `running === null`            → spawn.
 *   - contract skew                 → the `onContractSkew` policy (recycle / refuse /
 *                                     ordered drain-newer-else-refuse).
 *   - contract compatible, then:
 *     - baked buildId `""`          → adopt (off-nix supervisor can't judge builds).
 *     - build ids match             → adopt (provably our build).
 *     - build ids differ OR running
 *       buildId absent `""`         → the `onBuildMismatch` policy. An absent running id
 *                                     is a MISMATCH: a survivor predating the field is by
 *                                     definition an older build than this nix supervisor.
 *       - nudge-human               → report-mismatch (no supervisor action; caller surfaces).
 *       - drain-and-replace         → drain once (fenced); a spent fence → adopt.
 */

import {
  buildIdMatches,
  type ConvergenceIdentity,
  contractIsCompatible,
  contractIsNewer,
} from "@kolu/surface-daemon";
import type { AnyConvergencePolicy } from "./policy.ts";

/** The typed decision `converge()` enacts. `drain-and-replace` carries which `axis` fired
 *  (for the breadcrumb + to know whether to spend the build fence); `report-mismatch`
 *  carries the running identity the caller surfaces (the currency nudge). */
export type Decision =
  | { readonly kind: "spawn" }
  | { readonly kind: "adopt" }
  | { readonly kind: "recycle"; readonly reason: string }
  | {
      readonly kind: "drain-and-replace";
      readonly axis: "contract" | "build";
      readonly reason: string;
    }
  | { readonly kind: "refuse"; readonly reason: string }
  | { readonly kind: "report-mismatch"; readonly running: ConvergenceIdentity };

export function decide(
  baked: ConvergenceIdentity,
  running: ConvergenceIdentity | null,
  policy: AnyConvergencePolicy,
  buildFenceSpent: boolean,
): Decision {
  // No live survivor → spawn fresh.
  if (running === null) return { kind: "spawn" };

  // ── Axis 1 — CONTRACT (ordered). A skew decides here; the build id is irrelevant. ──
  if (!contractIsCompatible(baked.contractVersion, running.contractVersion)) {
    const versions = `running ${running.contractVersion}, mine ${baked.contractVersion}`;
    switch (policy.onContractSkew.kind) {
      case "recycle":
        return {
          kind: "recycle",
          reason: `contract skew (${versions}) — recycle-on-skew`,
        };
      case "refuse":
        return {
          kind: "refuse",
          reason: `contract skew (${versions}) — refuse (never touch a running daemon)`,
        };
      case "drain-newer-else-refuse":
        return contractIsNewer(baked.contractVersion, running.contractVersion)
          ? {
              kind: "drain-and-replace",
              axis: "contract",
              reason: `contract skew, mine newer (${versions}) — drain + replace`,
            }
          : {
              kind: "refuse",
              reason: `contract skew, mine older/behind (${versions}) — refuse (never drain; the monotonicity)`,
            };
      default: {
        const _exhaustive: never = policy.onContractSkew;
        throw new Error(
          `unreachable contract-skew policy: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }

  // ── Axis 2 — BUILD (match-only). Contract compatible → would adopt; check the build. ──
  // Off-nix supervisor (no baked id) can't judge builds → adopt (never drain on build grounds).
  if (baked.buildId === "") return { kind: "adopt" };
  // Provably the same build → adopt.
  if (buildIdMatches(baked.buildId, running.buildId)) return { kind: "adopt" };
  // Different id, OR an ABSENT running id (a survivor predating the field is, by definition,
  // an older build than this nix supervisor) → a build MISMATCH.
  switch (policy.onBuildMismatch.kind) {
    case "nudge-human":
      // No supervisor action — the caller surfaces the mismatch (the currency nudge).
      return { kind: "report-mismatch", running };
    case "drain-and-replace":
      // Once per supervisor boot: a spent fence means a reconnect must NOT re-drain → adopt.
      return buildFenceSpent
        ? { kind: "adopt" }
        : {
            kind: "drain-and-replace",
            axis: "build",
            reason: `same contract, build mismatch (running ${running.buildId || "<absent>"}, mine ${baked.buildId}) — drain + replace once`,
          };
    default: {
      const _exhaustive: never = policy.onBuildMismatch;
      throw new Error(
        `unreachable build-mismatch policy: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
