/**
 * Discriminated result of a private boot bind (`adoptOrEnsure` /
 * `adoptOrSpawnOrRefuse`). Replaces the overloaded boolean that conflated
 * "spawned a fresh expected daemon" with "failed".
 *
 * An adopted resident carries the **held rendezvous's** convergence identity
 * (from probing the socket that was just connected) — never the app's
 * unconstrained `I` from `current()`, which is not a ConvergenceIdentity (W4.2).
 */

import type { ConvergenceIdentity } from "@kolu/surface-daemon";
import type { InstanceKey } from "./instanceKey.ts";

/** Characterization of a just-adopted resident at the held rendezvous. */
export type BoundResidentCharacterization = {
  readonly identity: ConvergenceIdentity;
  readonly instanceKey: InstanceKey;
};

export type BindResult =
  /**
   * Connected to a live resident survivor (children preserved).
   * `characterization` is null when the held rendezvous did not answer an
   * identity probe after connect — uncharacterizable, never clean adopt.
   */
  | {
      readonly kind: "adopted-resident";
      readonly characterization: BoundResidentCharacterization | null;
    }
  /** Nothing live was adopted; a fresh expected daemon was spawned and held. */
  | { readonly kind: "spawned-fresh" }
  /** Skew refuse, unreachable survivor, or connect failure — no usable bind. */
  | { readonly kind: "refused-or-failed" };
