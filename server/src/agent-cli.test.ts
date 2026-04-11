/** Unit tests for agent CLI parsing and normalization. */

import { describe, it, expect } from "vitest";
import { parseAgentCommand, tokenize } from "./agent-cli.ts";

describe("tokenize", () => {
  it("splits plain whitespace", () => {
    expect(tokenize("claude --model sonnet")).toEqual([
      "claude",
      "--model",
      "sonnet",
    ]);
  });

  it("respects double-quoted runs", () => {
    expect(tokenize(`claude -p "fix a bug"`)).toEqual([
      "claude",
      "-p",
      "fix a bug",
    ]);
  });

  it("respects single-quoted runs", () => {
    expect(tokenize(`claude -p 'fix a bug'`)).toEqual([
      "claude",
      "-p",
      "fix a bug",
    ]);
  });

  it("honors backslash escapes outside quotes", () => {
    expect(tokenize(`claude foo\\ bar`)).toEqual(["claude", "foo bar"]);
  });

  it("handles escaped double quotes inside double-quoted runs", () => {
    expect(tokenize(`claude -p "say \\"hi\\""`)).toEqual([
      "claude",
      "-p",
      `say "hi"`,
    ]);
  });

  it("does not interpret escapes inside single quotes", () => {
    expect(tokenize(`claude -p 'say \\"hi\\"'`)).toEqual([
      "claude",
      "-p",
      `say \\"hi\\"`,
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("parseAgentCommand", () => {
  // Table from juspay/kolu#452
  it.each([
    // bare invocation
    ["claude", "claude"],
    // prompt flag stripped with its value
    [`claude -p "fix my leaked API key foo"`, "claude"],
    // stable flag kept verbatim
    [
      "claude --dangerously-skip-permissions",
      "claude --dangerously-skip-permissions",
    ],
    // mixed: stable flag preserved, prompt flag stripped
    [`claude --model sonnet -p "tweak this"`, "claude --model sonnet"],
    // aider with --model and -m prompt
    [`aider --model opus -m "refactor this"`, "aider --model opus"],
    // repeated identity
    ["claude", "claude"],
  ])("normalizes %j → %j", (raw, expected) => {
    expect(parseAgentCommand(raw)).toBe(expected);
  });

  it("strips trailing positional arguments", () => {
    expect(parseAgentCommand("aider src/foo.ts src/bar.ts")).toBe("aider");
  });

  it("strips positionals but keeps flag values that follow the flag", () => {
    expect(parseAgentCommand("claude --model sonnet some-file.ts")).toBe(
      "claude --model sonnet",
    );
  });

  it("stops processing at explicit --", () => {
    expect(parseAgentCommand("claude --model sonnet -- anything here")).toBe(
      "claude --model sonnet",
    );
  });

  it("handles absolute path to agent binary", () => {
    expect(parseAgentCommand("/usr/local/bin/claude --model sonnet")).toBe(
      "claude --model sonnet",
    );
  });

  it("returns null for non-agent commands", () => {
    expect(parseAgentCommand("ls -la")).toBeNull();
    expect(parseAgentCommand("vim foo.ts")).toBeNull();
    expect(parseAgentCommand("git status")).toBeNull();
    expect(parseAgentCommand("")).toBeNull();
    expect(parseAgentCommand("   ")).toBeNull();
  });

  it("recognizes all known agents", () => {
    for (const agent of [
      "claude",
      "opencode",
      "aider",
      "codex",
      "goose",
      "gemini",
      "cursor-agent",
    ]) {
      expect(parseAgentCommand(agent)).toBe(agent);
    }
  });
});
