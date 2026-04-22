import { describe, it, expect } from "vitest";
import { parseThreadState } from "./index.ts";

describe("parseThreadState", () => {
  it("returns waiting state for idle session with user events", () => {
    const now = Date.now();
    const row = {
      id: "test-1",
      title: "Test",
      model: "gpt-5.4",
      tokens_used: 1000,
      created_at: Math.floor((now - 60000) / 1000),
      // Updated >30s ago (not recently active) and exists >5s
      updated_at: Math.floor((now - 40000) / 1000),
      approval_mode: "off",
      has_user_event: 1,
    };

    const result = parseThreadState(row);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("waiting");
    expect(result!.model).toBe("gpt-5.4");
  });

  it("returns thinking state for recently active session", () => {
    const now = Date.now();
    const row = {
      id: "test-2",
      title: "Test",
      model: "gpt-5.4",
      tokens_used: 5000,
      created_at: Math.floor((now - 60000) / 1000),
      updated_at: Math.floor(now / 1000),
      approval_mode: "off",
      has_user_event: 1,
    };

    const result = parseThreadState(row);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("thinking");
  });

  it("returns tool_use state for recently active with approval mode", () => {
    const now = Date.now();
    const row = {
      id: "test-3",
      title: "Test",
      model: "gpt-5.4",
      tokens_used: 3000,
      created_at: Math.floor((now - 60000) / 1000),
      updated_at: Math.floor(now / 1000),
      approval_mode: "on-request",
      has_user_event: 1,
    };

    const result = parseThreadState(row);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("tool_use");
  });

  it("handles null model gracefully", () => {
    const now = Date.now();
    const row = {
      id: "test-4",
      title: "Test",
      model: "",
      tokens_used: 0,
      created_at: Math.floor((now - 60000) / 1000),
      updated_at: Math.floor((now - 10000) / 1000),
      approval_mode: "off",
      has_user_event: 1,
    };

    const result = parseThreadState(row);
    expect(result).not.toBeNull();
    expect(result!.model).toBeNull();
  });
});
