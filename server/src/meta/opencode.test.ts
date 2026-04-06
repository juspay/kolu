import { describe, it, expect } from "vitest";
import { deriveOpenCodeState } from "./opencode.ts";

describe("deriveOpenCodeState", () => {
  it("returns thinking for user message", () => {
    expect(deriveOpenCodeState("user", "[]")).toBe("thinking");
  });

  it("returns thinking for tool message", () => {
    expect(deriveOpenCodeState("tool", "[]")).toBe("thinking");
  });

  it("returns null for system message", () => {
    expect(deriveOpenCodeState("system", "[]")).toBeNull();
  });

  it("returns thinking for assistant with no finish part", () => {
    const parts = JSON.stringify([{ type: "text", data: { text: "Hello" } }]);
    expect(deriveOpenCodeState("assistant", parts)).toBe("thinking");
  });

  it("returns tool_use for assistant with finish.reason=tool_use", () => {
    const parts = JSON.stringify([
      { type: "text", data: { text: "Let me check" } },
      { type: "tool_call", data: { id: "tc1", name: "bash", input: "ls" } },
      { type: "finish", data: { reason: "tool_use", time: 1234 } },
    ]);
    expect(deriveOpenCodeState("assistant", parts)).toBe("tool_use");
  });

  it("returns waiting for assistant with finish.reason=end_turn", () => {
    const parts = JSON.stringify([
      { type: "text", data: { text: "Done!" } },
      { type: "finish", data: { reason: "end_turn", time: 1234 } },
    ]);
    expect(deriveOpenCodeState("assistant", parts)).toBe("waiting");
  });

  it("returns waiting for assistant with finish.reason=canceled", () => {
    const parts = JSON.stringify([
      { type: "finish", data: { reason: "canceled", time: 1234 } },
    ]);
    expect(deriveOpenCodeState("assistant", parts)).toBe("waiting");
  });

  it("returns waiting for assistant with finish.reason=error", () => {
    const parts = JSON.stringify([
      { type: "finish", data: { reason: "error", time: 1234 } },
    ]);
    expect(deriveOpenCodeState("assistant", parts)).toBe("waiting");
  });

  it("returns waiting for assistant with finish.reason=max_tokens", () => {
    const parts = JSON.stringify([
      { type: "finish", data: { reason: "max_tokens", time: 1234 } },
    ]);
    expect(deriveOpenCodeState("assistant", parts)).toBe("waiting");
  });

  it("returns null for malformed JSON", () => {
    expect(deriveOpenCodeState("assistant", "not json")).toBeNull();
  });

  it("returns null for unknown role", () => {
    expect(deriveOpenCodeState("unknown", "[]")).toBeNull();
  });
});
