import { describe, it, expect } from "vitest";
import { deriveState, type SessionStatus } from "./index.ts";

describe("deriveState", () => {
  it("maps busy to thinking", () => {
    expect(deriveState({ type: "busy" })).toBe("thinking");
  });

  it("maps idle to waiting", () => {
    expect(deriveState({ type: "idle" })).toBe("waiting");
  });

  it("maps retry to thinking", () => {
    const status: SessionStatus = {
      type: "retry",
      attempt: 2,
      message: "rate limited",
      next: Date.now() + 5000,
    };
    expect(deriveState(status)).toBe("thinking");
  });
});
