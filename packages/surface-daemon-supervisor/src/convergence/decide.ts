/**
 * The PURE convergence decision — the fold-style core of the kit. Given the supervisor's
 * baked identity, the running daemon's identity (or `null`), and the policy map, it
 * returns a typed {@link Decision} with ZERO I/O. Enactment (`converge` / `convergeAdmit`)
 * owns the budget gate; the whole policy TABLE is unit-tested here against `decide`
 * directly, no daemons.
 *
 * Two axes, evaluated in order — a contract skew decides alone (the build id is
 * irrelevant across a wire break); a compatible contract falls through to the build axis.
 * The absent / off-nix cases are TABLE ROWS, not special cases:
 *   - `running === null`            → spawn.
 *   - contract skew                 → the `onContractSkew` policy (recycle / refuse /
 *                                     ordered drain-newer-else-refuse).
 *   - contract compatible, then:
 *     - baked build `off-nix`      → adopt (off-nix supervisor can't judge builds).
 *     - builds match               → adopt (provably our build).
 *     - builds differ OR running
 *       build `off-nix`            → the `onBuildMismatch` policy. An `off-nix` running
 *                                     build is a MISMATCH: a survivor predating the field
 *                                     is by definition an older build than this supervisor.
 *       - nudge-human               → report-mismatch (no supervisor action; caller surfaces).
 *       - drain-and-replace         → drain (budget-gated at enactment, not here).
 */

import {
  buildsMatch,
  type ConvergenceIdentity,
  contractIsCompatible,
  contractIsNewer,
} from "@kolu/surface-daemon";
import type { AnyConvergencePolicy } from "./policy.ts";

/** The typed decision enactment enacts. `drain-and-replace` carries which `axis` fired
 *  (so logs / breadcrumbs know which axis); `report-mismatch` carries the running
 *  identity the caller surfaces (the currency nudge). Budget give-up is NOT a decision
 *  row — it is an enactment gate over a drain-and-replace decision. */
export type Decision =
  | { readonly kind: "spawn" }
  | { readonly kind: "adopt" }
  | { readonly kind: "recycle" }
  | {
      readonly kind: "drain-and-replace";
      readonly axis: "contract" | "build";
    }
  | { readonly kind: "refuse" }
  | { readonly kind: "report-mismatch"; readonly running: ConvergenceIdentity };

/**
 * Pure decision fold. Reads `policy.baked` — never a free-standing `baked`
 * parameter (F8: cannot cross-wire baked ≠ policy.baked).
 */
export function decide(
  policy: AnyConvergencePolicy,
  running: ConvergenceIdentity | null,
): Decision {
  const baked = policy.baked;
  // No live survivor → spawn fresh.
  if (running === null) return { kind: "spawn" };

  // ── Axis 1 — CONTRACT (ordered). A skew decides here; the build id is irrelevant. ──
  if (!contractIsCompatible(baked.contractVersion, running.contractVersion)) {
    switch (policy.onContractSkew.kind) {
      case "recycle":
        return { kind: "recycle" };
      case "refuse":
        return { kind: "refuse" };
      case "drain-newer-else-refuse":
        return contractIsNewer(baked.contractVersion, running.contractVersion)
          ? { kind: "drain-and-replace", axis: "contract" }
          : { kind: "refuse" };
      default: {
        const _exhaustive: never = policy.onContractSkew;
        throw new Error(
          `unreachable contract-skew policy: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }

  // ── Axis 2 — BUILD (match-only). Contract compatible → would adopt; check the build. ──
  // Off-nix supervisor (no baked build) can't judge builds → adopt (never drain on build
  // grounds). A typed `off-nix` KIND, not the `""` sentinel the null-free identity removes.
  if (baked.build.kind === "off-nix") return { kind: "adopt" };
  // Provably the same build → adopt.
  if (buildsMatch(baked.build, running.build)) return { kind: "adopt" };
  // Different id, OR an `off-nix` running build (a survivor predating the field is, by
  // definition, an older build than this nix supervisor) → a build MISMATCH.
  switch (policy.onBuildMismatch.kind) {
    case "nudge-human":
      // No supervisor action — the caller surfaces the mismatch (the currency nudge).
      return { kind: "report-mismatch", running };
    case "drain-and-replace":
      // Budget gates enactment (survives adopts; cross-supervisor detection). Pure
      // decide always proposes the drain; the memory decides whether it fires.
      return { kind: "drain-and-replace", axis: "build" };
    default: {
      const _exhaustive: never = policy.onBuildMismatch;
      throw new Error(
        `unreachable build-mismatch policy: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
