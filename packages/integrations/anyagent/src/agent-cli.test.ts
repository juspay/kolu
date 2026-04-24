/** Unit tests for agent CLI parsing and normalization. */

import { describe, it, expect } from "vitest";
import { parseAgentCommand } from "./agent-cli.ts";

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
    // session-resume flags stripped — juspay/kolu#467: `-c` and
    // `--resume` were creating distinct recent-agents MRU entries for
    // what is semantically the same invocation.
    [
      "claude --dangerously-skip-permissions -c",
      "claude --dangerously-skip-permissions",
    ],
    [
      "claude --dangerously-skip-permissions --resume",
      "claude --dangerously-skip-permissions",
    ],
    ["claude --continue --model sonnet", "claude --model sonnet"],
    ["claude -r --model sonnet", "claude --model sonnet"],
    // `--resume` with an optional session-id value — value stripped
    // by the same "skip next non-flag token" branch as prompt flags.
    [
      "claude --resume abc123-session-uuid --model sonnet",
      "claude --model sonnet",
    ],
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

  it("returns null for exit-immediately flags (--version, --help)", () => {
    expect(parseAgentCommand("claude --version")).toBeNull();
    expect(parseAgentCommand("claude -V")).toBeNull();
    expect(parseAgentCommand("claude --help")).toBeNull();
    expect(parseAgentCommand("claude -h")).toBeNull();
    expect(parseAgentCommand("opencode --version")).toBeNull();
    expect(parseAgentCommand("opencode --help")).toBeNull();
  });

  it("drops unknown flags (allowlist, not denylist)", () => {
    expect(parseAgentCommand("claude --verbose")).toBe("claude");
    expect(parseAgentCommand("claude --no-color")).toBe("claude");
    expect(parseAgentCommand("opencode --debug")).toBe("opencode");
  });

  it("preserves --dangerously-skip-permissions for opencode", () => {
    expect(parseAgentCommand("opencode --dangerously-skip-permissions")).toBe(
      "opencode --dangerously-skip-permissions",
    );
  });

  it("preserves --yolo for opencode", () => {
    expect(parseAgentCommand("opencode --yolo")).toBe("opencode --yolo");
  });

  it("preserves --yolo for codex", () => {
    expect(parseAgentCommand("codex --yolo")).toBe("codex --yolo");
  });

  it("preserves --config for codex", () => {
    expect(
      parseAgentCommand(
        `codex --yolo --model gpt-5.5 --config model_reasoning_effort="xhigh"`,
      ),
    ).toBe(
      `codex --yolo --model gpt-5.5 --config model_reasoning_effort="xhigh"`,
    );
  });

  it("preserves session-defining flags for codex", () => {
    expect(
      parseAgentCommand(
        "codex --profile dev --sandbox workspace-write --ask-for-approval on-failure --full-auto --oss",
      ),
    ).toBe(
      "codex --profile dev --sandbox workspace-write --ask-for-approval on-failure --full-auto --oss",
    );
  });

  it("preserves -c short form for codex --config", () => {
    expect(parseAgentCommand("codex -c model_reasoning_effort=high")).toBe(
      "codex -c model_reasoning_effort=high",
    );
  });

  it("preserves session-defining flags for claude", () => {
    expect(
      parseAgentCommand(
        "claude --permission-mode plan --add-dir /tmp/foo --agent reviewer --mcp-config mcp.json --strict-mcp-config --append-system-prompt terse --settings settings.json --bare --disallowedTools Bash",
      ),
    ).toBe(
      "claude --permission-mode plan --add-dir /tmp/foo --agent reviewer --mcp-config mcp.json --strict-mcp-config --append-system-prompt terse --settings settings.json --bare --disallowedTools Bash",
    );
  });

  it("preserves --agent and --pure for opencode", () => {
    expect(parseAgentCommand("opencode --agent build --pure")).toBe(
      "opencode --agent build --pure",
    );
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
