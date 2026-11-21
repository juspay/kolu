import { describe, expect, it } from "vitest";
import { OWN_MEMORY_OFF, ownMemoryHint } from "./env.ts";

describe("Claude Code's own memory", () => {
  it("is switched off by one variable on the adapter's own process", () => {
    expect(OWN_MEMORY_OFF).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  });

  it("is said to live under the config directory's projects, in the folder named after the session's directory", () => {
    expect(
      ownMemoryHint("/tmp/scratch-home/.claude", "/tmp/scratch-home"),
    ).toBe(
      "Claude Code keeps its own memory under /tmp/scratch-home/.claude/projects, in the folder named after the directory /tmp/scratch-home, inside that folder's memory/ folder; MEMORY.md there is the index.",
    );
  });
});
