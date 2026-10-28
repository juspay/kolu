/** Unit tests for the CLI facts kolu still keeps: the sensor's name hint, the
 *  live-process stable-flag filter, and the ONE renderer from a restore target
 *  to a shell line.
 *
 *  The old suite pinned a text-splicing pipeline (`parseAgentCommand` →
 *  `resumeAgentCommand`), which is exactly the behaviour this change deletes:
 *  captured PTY text no longer becomes a command. There is deliberately no test
 *  here for turning a command STRING into a launch — that door is gone. */

import { describe, expect, it } from "vitest";
import type { RestoreTarget } from "anyagent/schemas";
import {
  agentLaunchLine,
  agentNameHint,
  resumableCommand,
  resumeFormFor,
  stableFlagTokens,
} from "./vocab.ts";
import { agentCliGrammar } from "./vocab.ts";

const CLAUDE_ID = "0192f3a1-4c5b-7d8e-9f01-23456789abcd";
const CODEX_ID = "0192f3a1-4c5b-7d8e-9f02-23456789abcd";
const GROK_ID = "0192f3a1-4c5b-7d8e-9f03-23456789abcd";
const XYNE_ID = "0192f3a1-4c5b-7d8e-9f04-23456789abcd";
const OPENCODE_ID = "ses_118316090ffewMmbj6bsfKwj4R";
const PI_PATH = "/home/u/.pi/sessions/a.jsonl";
const OMP_PATH = "/home/u/.omp/sessions/a.jsonl";

function target(
  kind: string,
  resumeRef: string,
  argv: readonly string[] = [],
): RestoreTarget {
  return {
    kind: "exact",
    agent: { kind, sessionId: resumeRef, resumeRef },
    argv: [...argv],
  };
}

describe("agentNameHint — the only reader of a raw PTY command mark", () => {
  it.each([
    ["claude", "claude"],
    ["/usr/local/bin/claude --model sonnet", "claude"],
    ["FOO=bar opencode", "opencode"],
    ["A=1 B='x y' claude --model sonnet", "claude"],
    ["exec claude --resume x", "claude"],
    ["env FOO=1 claude", "claude"],
    ["ls -la", "ls"],
    ["", null],
  ])("%j → %j", (raw, expected) => {
    expect(agentNameHint(raw)).toBe(expected);
  });
});

describe("stableFlagTokens — the live process's argv, filtered by the allowlist", () => {
  /** The REAL argv shapes observed through `/proc` on a Linux host, one per
   *  registered agent. Wrapper-injected flags, loaders, paths, positionals and
   *  resume markers are all dropped by the allowlist; only flags the agent
   *  grammar declares stable survive. */
  it.each<[string, string[], string[]]>([
    [
      "claude-code",
      [
        "/home/u/.local/bin/claude",
        "--plugin-dir",
        "/home/u/.claude/plugins/p",
        "--plugin-dir",
        "/home/u/.claude/plugins/p",
        "--resume",
        CLAUDE_ID,
        "--dangerously-skip-permissions",
      ],
      ["--dangerously-skip-permissions"],
    ],
    [
      "omp",
      [
        "/home/u/.local/bin/omp",
        "-e",
        "/home/u/.omp/ext",
        "-e",
        "/home/u/.omp/ext",
        "--resume",
        OMP_PATH,
        "--model",
        "fable",
      ],
      ["--model", "fable"],
    ],
    [
      "opencode",
      [
        "ld-linux-x86-64.so.2",
        "/home/u/.opencode/libexec/opencode",
        "--standalone",
        "--session",
        OPENCODE_ID,
        "--model",
        "sonnet",
      ],
      ["--model", "sonnet"],
    ],
    [
      "codex",
      ["/usr/local/bin/codex", "--model", "gpt-5.5", "-c", "x=1", "resume"],
      ["--model", "gpt-5.5", "-c", "x=1"],
    ],
    [
      "grok",
      ["/home/u/.local/bin/grok", "-m", "grok-4.5", "--no-alt-screen"],
      ["-m", "grok-4.5", "--no-alt-screen"],
    ],
    [
      "pi",
      ["/home/u/.local/bin/pi", "--model", "x", "--name", "n"],
      ["--model", "x", "--name", "n"],
    ],
    [
      "xyne",
      ["/home/u/.local/bin/xyne", "--port", "3000", "--debug"],
      ["--port", "3000", "--debug"],
    ],
  ])("%s keeps only its allowlisted flags", (kind, argv, expected) => {
    expect(stableFlagTokens(agentCliGrammar(kind), argv)).toEqual(expected);
  });

  it("does not let a boolean flag swallow the positional after it", () => {
    expect(
      stableFlagTokens(agentCliGrammar("claude-code"), [
        "claude",
        "--dangerously-skip-permissions",
        "fix the bug",
      ]),
    ).toEqual(["--dangerously-skip-permissions"]);
  });

  it("stops at an explicit end-of-flags marker", () => {
    expect(
      stableFlagTokens(agentCliGrammar("claude-code"), [
        "claude",
        "--model",
        "sonnet",
        "--",
        "--model",
        "opus",
      ]),
    ).toEqual(["--model", "sonnet"]);
  });

  it("keeps a value with spaces as ONE token (the argv boundary was exact)", () => {
    expect(
      stableFlagTokens(agentCliGrammar("claude-code"), [
        "claude",
        "--settings",
        '{"ultracode": true}',
      ]),
    ).toEqual(["--settings", '{"ultracode": true}']);
  });
});

describe("resumeFormFor — a shell line rendered from structured facts", () => {
  it.each<[string, RestoreTarget, string]>([
    [
      "claude-code",
      target("claude-code", CLAUDE_ID),
      `claude --resume ${CLAUDE_ID}`,
    ],
    ["codex", target("codex", CODEX_ID), `codex resume ${CODEX_ID}`],
    [
      "opencode",
      target("opencode", OPENCODE_ID, ["--model", "sonnet"]),
      `opencode --session ${OPENCODE_ID} --model sonnet`,
    ],
    [
      "grok",
      target("grok", GROK_ID, ["-m", "grok-4.5"]),
      `grok --resume ${GROK_ID} -m grok-4.5`,
    ],
    ["pi", target("pi", PI_PATH), `pi --session ${PI_PATH}`],
    [
      "omp",
      target("omp", OMP_PATH, ["--model", "fable"]),
      `omp --resume ${OMP_PATH} --model fable`,
    ],
    [
      "xyne",
      target("xyne", XYNE_ID, ["--debug"]),
      `xyne --session ${XYNE_ID} --debug`,
    ],
  ])("renders the %s resume form", (_kind, t, expected) => {
    expect(resumeFormFor(t)).toBe(expected);
  });

  it("re-quotes a flag value so the shell reproduces the token", () => {
    expect(
      resumeFormFor(
        target("claude-code", CLAUDE_ID, ["--settings", '{"a": 1}']),
      ),
    ).toBe(`claude --resume ${CLAUDE_ID} --settings '{"a": 1}'`);
  });

  it("returns null for `none` and for an absent target", () => {
    expect(resumeFormFor({ kind: "none" })).toBeNull();
    expect(resumeFormFor(undefined)).toBeNull();
  });

  it("refuses a same-agent ref that fails its shape gate — a bare shell, never a bad token", () => {
    expect(resumeFormFor(target("claude-code", "not-a-uuid"))).toBeNull();
    expect(resumeFormFor(target("opencode", "../../etc/passwd"))).toBeNull();
  });

  it("refuses a kind this build no longer knows", () => {
    expect(resumeFormFor(target("retired-agent", CLAUDE_ID))).toBeNull();
  });

  it("still resumes on an empty argv — flags are an enhancement, not a requirement", () => {
    expect(resumeFormFor(target("claude-code", CLAUDE_ID, []))).toBe(
      `claude --resume ${CLAUDE_ID}`,
    );
  });
});

describe("resumableCommand — the display projection, gated on wake", () => {
  it("renders the LAUNCH line (not the resume marker) for a resumable target", () => {
    expect(
      resumableCommand(target("claude-code", CLAUDE_ID, ["--model", "sonnet"])),
    ).toBe("claude --model sonnet");
  });

  it("is null exactly when wake would land on a bare shell", () => {
    expect(resumableCommand({ kind: "none" })).toBeNull();
    expect(resumableCommand(undefined)).toBeNull();
    expect(resumableCommand(target("claude-code", "not-a-uuid"))).toBeNull();
  });
});

describe("agentLaunchLine — the recent-agents palette's ONE renderer", () => {
  it("renders the registry basename plus the allowlisted argv", () => {
    expect(agentLaunchLine("opencode", ["--model", "sonnet"])).toBe(
      "opencode --model sonnet",
    );
    expect(agentLaunchLine("claude-code", [])).toBe("claude");
  });

  it("renders nothing for an unknown kind", () => {
    expect(agentLaunchLine("retired-agent", [])).toBeNull();
  });
});
