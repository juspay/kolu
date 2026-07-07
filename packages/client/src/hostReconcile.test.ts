import { describe, expect, it } from "vitest";
import { hostReconcileTarget } from "./hostReconcile.ts";

// The active-host membership reconcile decision (wire.ts). Pins the RS4 #4 fix: a departed
// ACTIVE host falls back to the local default, while the warming window / still-a-member /
// local-default cases stay no-ops (so a not-yet-arrived host is never read as "departed").
describe("hostReconcileTarget — active-host membership reconcile", () => {
  const LOCAL = "local";

  it("departed active guest → falls back to the local default", () => {
    // active 'zest' was removed (✕ or server auto-retire); membership no longer holds it.
    expect(hostReconcileTarget(["local", "west"], "zest", LOCAL)).toBe(LOCAL);
  });

  it("warming window (no membership snapshot yet) → no-op", () => {
    // Before the first entries frame, an empty keyset must NOT read the active host as
    // departed (else every boot would bounce to local before the pool has published).
    expect(hostReconcileTarget([], "zest", LOCAL)).toBeNull();
  });

  it("active host still a member → no-op", () => {
    expect(hostReconcileTarget(["local", "zest"], "zest", LOCAL)).toBeNull();
  });

  it("active host is the local default → no-op (unremovable, always a member)", () => {
    // Even a (spurious) keyset missing 'local' must not bounce off the default.
    expect(hostReconcileTarget(["west"], LOCAL, LOCAL)).toBeNull();
  });
});
