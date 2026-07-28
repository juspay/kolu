/**
 * Discriminated result of a private boot bind (`adoptOrEnsure` /
 * `adoptOrSpawnOrRefuse`). Replaces the overloaded boolean that conflated
 * "spawned a fresh expected daemon" with "failed".
 */

export type BindResult =
  /** Connected to a live resident survivor (children preserved). */
  | { readonly kind: "adopted-resident" }
  /** Nothing live was adopted; a fresh expected daemon was spawned and held. */
  | { readonly kind: "spawned-fresh" }
  /** Skew refuse, unreachable survivor, or connect failure — no usable bind. */
  | { readonly kind: "refused-or-failed" };

export function bindAdoptedResident(r: BindResult): boolean {
  return r.kind === "adopted-resident";
}

export function bindSucceeded(r: BindResult): boolean {
  return r.kind === "adopted-resident" || r.kind === "spawned-fresh";
}
