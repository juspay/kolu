/**
 * Discriminated result of a private boot bind (`adoptOrEnsure` /
 * `adoptOrSpawnOrRefuse`). Replaces the overloaded boolean that conflated
 * "spawned a fresh expected daemon" with "failed".
 *
 * An adopted resident carries a **three-valued characterization** of the held
 * rendezvous (W5): characterized identity | honest absent | thrown failure.
 * Never catch-to-null — that collapsed probe-failed into identity-unverifiable.
 */

import type { ConvergenceIdentity } from "@kolu/surface-daemon";
import type { InstanceKey } from "./instanceKey.ts";

/**
 * Package-owned characterization of a just-adopted resident at the held
 * rendezvous. Three arms — never a silent null for throws.
 */
export type BoundResidentCharacterization =
  | {
      readonly kind: "characterized";
      readonly identity: ConvergenceIdentity;
      readonly instanceKey: InstanceKey;
    }
  /** Held socket answered no identity (honest empty). */
  | { readonly kind: "absent" }
  /** Identity probe threw — message preserved for probe-failed. */
  | { readonly kind: "failed"; readonly message: string }
  /**
   * Probe answered but did not describe the held connection (instance key
   * uncorrelated with conn.startedAt, or connection replaced mid-probe).
   */
  | { readonly kind: "uncorrelated" };

export type BindResult =
  /**
   * Connected to a live resident survivor (children preserved).
   * Characterization is always populated (three-valued).
   */
  | {
      readonly kind: "adopted-resident";
      readonly characterization: BoundResidentCharacterization;
    }
  /** Nothing live was adopted; a fresh expected daemon was spawned and held. */
  | { readonly kind: "spawned-fresh" }
  /** Skew refuse, unreachable survivor, or connect failure — no usable bind. */
  | { readonly kind: "refused-or-failed" };
