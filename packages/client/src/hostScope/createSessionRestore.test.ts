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
