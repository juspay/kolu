import { describe, expect, it } from "vitest";
import { agentKindFromCommand } from "./agentDisplay";

describe("agentKindFromCommand", () => {
  it("maps claude basename to claude-code kind", () => {
    expect(agentKindFromCommand("claude")).toBe("claude-code");
    expect(agentKindFromCommand("claude --model sonnet")).toBe("claude-code");
    expect(agentKindFromCommand("claude --dangerously-skip-permissions")).toBe(
      "claude-code",
    );
  });

  it("maps codex and opencode basenames to matching kinds", () => {
    expect(agentKindFromCommand("codex")).toBe("codex");
    expect(agentKindFromCommand("codex --yolo --model gpt-5.5")).toBe("codex");
    expect(agentKindFromCommand("opencode --continue")).toBe("opencode");
  });

  it("strips a path prefix on the agent binary", () => {
    expect(agentKindFromCommand("/usr/local/bin/claude --model sonnet")).toBe(
      "claude-code",
    );
  });

  it("returns null for detection-only and unknown commands", () => {
    expect(agentKindFromCommand("aider --model gpt-4")).toBe(null);
    expect(agentKindFromCommand("goose")).toBe(null);
    expect(agentKindFromCommand("gemini")).toBe(null);
    expect(agentKindFromCommand("cursor-agent")).toBe(null);
    expect(agentKindFromCommand("vim")).toBe(null);
    expect(agentKindFromCommand("")).toBe(null);
  });
});
