import { LOCAL_HOST } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { hostReconcileTarget } from "./hostReconcile.ts";

// The active-host membership reconcile decision (wire.ts). Pins the RS4 #4 fix: a departed
// ACTIVE host falls back to the local default, while the warming window / still-a-member /
// local-default cases stay no-ops (so a not-yet-arrived host is never read as "departed").
describe("hostReconcileTarget — active-host membership reconcile", () => {
  const zest = { kind: "remote" as const, target: "zest" };
  const west = { kind: "remote" as const, target: "west" };

  it("departed active guest → falls back to the local default", () => {
    // active 'zest' was removed (✕ or server auto-retire); membership no longer holds it.
    expect(hostReconcileTarget([LOCAL_HOST, west], zest, LOCAL_HOST)).toBe(
      LOCAL_HOST,
    );
  });

  it("warming window (no membership snapshot yet) → no-op", () => {
    // Before the first entries frame, an empty keyset must NOT read the active host as
    // departed (else every boot would bounce to local before the pool has published).
    expect(hostReconcileTarget([], zest, LOCAL_HOST)).toBeNull();
  });

  it("active host still a member → no-op", () => {
    expect(
      hostReconcileTarget([LOCAL_HOST, zest], zest, LOCAL_HOST),
    ).toBeNull();
    // Membership compares by ENCODED value, not object reference — a freshly-decoded
    // `zest` (a different object) still matches.
    expect(
      hostReconcileTarget(
        [LOCAL_HOST, { kind: "remote", target: "zest" }],
        { kind: "remote", target: "zest" },
        LOCAL_HOST,
      ),
    ).toBeNull();
  });

  it("active host is the local default → no-op (unremovable, always a member)", () => {
    // Even a (spurious) keyset missing the local default must not bounce off it.
    expect(hostReconcileTarget([west], LOCAL_HOST, LOCAL_HOST)).toBeNull();
  });
});
