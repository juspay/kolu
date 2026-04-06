import { describe, it, expect } from "vitest";
import { deriveOpenCodeState } from "./opencode.ts";

describe("deriveOpenCodeState", () => {
  it("returns thinking when latest message is from user", () => {
    expect(deriveOpenCodeState("step-finish", "stop", "user")).toBe("thinking");
  });

  it("returns thinking for step-start", () => {
    expect(deriveOpenCodeState("step-start", null, "assistant")).toBe(
      "thinking",
    );
  });

  it("returns tool_use for step-finish with reason tool-calls", () => {
    expect(
      deriveOpenCodeState("step-finish", "tool-calls", "assistant"),
    ).toBe("tool_use");
  });

  it("returns waiting for step-finish with reason stop", () => {
    expect(deriveOpenCodeState("step-finish", "stop", "assistant")).toBe(
      "waiting",
    );
  });

  it("returns waiting for step-finish with reason cancel", () => {
    expect(deriveOpenCodeState("step-finish", "cancel", "assistant")).toBe(
      "waiting",
    );
  });

  it("returns waiting for step-finish with reason error", () => {
    expect(deriveOpenCodeState("step-finish", "error", "assistant")).toBe(
      "waiting",
    );
  });

  it("returns thinking for reasoning part mid-step", () => {
    expect(deriveOpenCodeState("reasoning", null, "assistant")).toBe(
      "thinking",
    );
  });

  it("returns thinking for text part mid-step", () => {
    expect(deriveOpenCodeState("text", null, "assistant")).toBe("thinking");
  });

  it("returns thinking for tool part mid-step", () => {
    expect(deriveOpenCodeState("tool", null, "assistant")).toBe("thinking");
  });
});
