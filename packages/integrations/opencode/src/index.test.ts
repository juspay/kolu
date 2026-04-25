import { describe, expect, it } from "vitest";
import { parseMessageState } from "./index.ts";

describe("parseMessageState", () => {
  it("returns thinking for a user message", () => {
    const data = JSON.stringify({
      role: "user",
      time: { created: 1775861127582 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "thinking",
      model: null,
    });
  });

  it("returns waiting for a completed assistant message with finish=stop", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "glm-latest",
      providerID: "litellm",
      finish: "stop",
      time: { created: 1775861127596, completed: 1775861130376 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "waiting",
      model: "litellm/glm-latest",
    });
  });

  it("returns thinking for an assistant message without time.completed", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "glm-latest",
      providerID: "litellm",
      time: { created: 1775861127596 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "thinking",
      model: "litellm/glm-latest",
    });
  });

  it("returns thinking for assistant with non-stop finish reason", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "claude-sonnet-4-5",
      providerID: "anthropic",
      finish: "tool-calls",
      time: { created: 1, completed: 2 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "thinking",
      model: "anthropic/claude-sonnet-4-5",
    });
  });

  it("falls back to modelID alone if providerID is missing", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "glm-latest",
      finish: "stop",
      time: { created: 1, completed: 2 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "waiting",
      model: "glm-latest",
    });
  });

  it("returns null for unknown role", () => {
    expect(parseMessageState(JSON.stringify({ role: "system" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseMessageState("not json")).toBeNull();
  });
});
