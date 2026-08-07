import { describe, expect, it } from "vitest";
import { createSessionRestore } from "./createSessionRestore";

/** The `HydrationPhase` state machine (L18): the named transitions replace the
 *  pre-W7 `decided`/`viewSeeded` boolean pair and the raw `phase = "…"` writes.
 *  These pin the transition TABLE so the "seeded but undecided is unrepresentable"
 *  invariant is enforced by the API, not by call-site discipline. */
describe("createSessionRestore — HydrationPhase transitions", () => {
  it("starts pending", () => {
    expect(createSessionRestore().phase).toBe("pending");
  });

  it("markDecided: pending → decided", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    expect(latch.phase).toBe("decided");
  });

  it("markSeeded: decided → seeded", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.markSeeded();
    expect(latch.phase).toBe("seeded");
  });

  it("markSeeded from a fresh (pending) latch is a no-op — the pending→seeded skip is unspellable", () => {
    const latch = createSessionRestore();
    // seeded is reachable ONLY through decided; markSeeded before markDecided
    // must not skip the empty-vs-restore decision. The `if (phase === "decided")`
    // guard makes it a no-op, pinning the transition table total-and-legal-only.
    latch.markSeeded();
    expect(latch.phase).toBe("pending");
  });

  it("markDecided is idempotent — it can NEVER regress a seeded host", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.markSeeded();
    // A stray markDecided (e.g. the effect re-running) must not drop seeded→decided
    // and re-seed the view. The `if (phase === "pending")` guard makes it a no-op.
    latch.markDecided();
    expect(latch.phase).toBe("seeded");
  });

  it("reseedForRestore: seeded → decided (the in-session-restore re-arm)", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.markSeeded();
    latch.reseedForRestore();
    expect(latch.phase).toBe("decided");
    // …and re-seeding latches back to seeded, so a later reconnect stays a no-op.
    latch.markSeeded();
    expect(latch.phase).toBe("seeded");
  });
});

/** `session.restore`'s ANSWER, parked for the next view seed. It exists because
 *  the seed must not read the saved-session cell for a restore's active tile —
 *  the terminals reach the client before that snapshot does. */
describe("createSessionRestore — the restore's answered active tile", () => {
  it("starts unanswered", () => {
    expect(createSessionRestore().restoredActive).toBeNull();
  });

  it("boxes the answer, so 'host holds no active' is not 'no restore answered'", () => {
    const latch = createSessionRestore();
    latch.reportRestoredActive(null);
    // `{ id: null }`, NOT `null`: the seed must take the host at its word here
    // rather than fall back to the blob the restore consumed.
    expect(latch.restoredActive).toEqual({ id: null });
    latch.reportRestoredActive("t-2");
    expect(latch.restoredActive).toEqual({ id: "t-2" });
  });

  it("the seed SPENDS it — markSeeded clears the answer", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.reportRestoredActive("t-2");
    latch.markSeeded();
    // A consumed answer must never seed a LATER hydration (a reconnect, a
    // host switch-back): that restore is over.
    expect(latch.restoredActive).toBeNull();
  });
});
