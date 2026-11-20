import { describe, expect, it } from "vitest";
import { createSessionRestore } from "./createSessionRestore";

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
    latch.markSeeded();
    expect(latch.phase).toBe("pending");
  });

  it("markDecided is idempotent — it can NEVER regress a seeded host", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.markSeeded();
    latch.markDecided();
    expect(latch.phase).toBe("seeded");
  });

  it("reseedForRestore: seeded → decided (the in-session-restore re-arm)", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.markSeeded();
    latch.reseedForRestore();
    expect(latch.phase).toBe("decided");
    latch.markSeeded();
    expect(latch.phase).toBe("seeded");
  });
});

describe("createSessionRestore — the restore's answered active tile", () => {
  it("starts unanswered", () => {
    expect(createSessionRestore().restoredActive).toBeNull();
  });

  it("boxes the answer, so 'host holds no active' is not 'no restore answered'", () => {
    const latch = createSessionRestore();
    latch.reportRestoredActive(null);
    expect(latch.restoredActive).toEqual({ id: null });
    latch.reportRestoredActive("t-2");
    expect(latch.restoredActive).toEqual({ id: "t-2" });
  });

  it("the seed SPENDS it — markSeeded clears the answer", () => {
    const latch = createSessionRestore();
    latch.markDecided();
    latch.reportRestoredActive("t-2");
    latch.markSeeded();
    expect(latch.restoredActive).toBeNull();
  });
});
