/** Unit tests for agent CLI parsing and normalization. */

import { shellSplit } from "@kolu/shell-quote";
import { parseArgsStringToArgv } from "string-argv";
import { describe, expect, it } from "vitest";
import {
  agentCommandForKind,
  agentKindFromCommand,
  agentNameFromCommand,
  nixRunWrappedAgent,
  parseAgentCommand,
  resumeAgentCommand,
} from "./agent-cli.ts";

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
    // The `model_reasoning_effort="xhigh"` value carries embedded double
    // quotes (TOML string syntax codex wants to receive), so it is single-
    // quoted in the normalized form to survive shell re-execution verbatim.
    expect(
      parseAgentCommand(
        `codex --yolo --model gpt-5.5 --config model_reasoning_effort="xhigh"`,
      ),
    ).toBe(
      `codex --yolo --model gpt-5.5 --config 'model_reasoning_effort="xhigh"'`,
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

  // Regression: a stable flag's VALUE can contain shell-significant
  // characters (spaces, JSON braces/quotes). `string-argv` strips the outer
  // quotes during tokenization, so re-joining the kept tokens with a bare
  // space dropped the quoting: the stored/displayed/re-run command became
  // `--settings {"ultracode": true}`, and on re-run the shell word-split the
  // JSON back apart (`Error: Settings file not found: {ultracode:`). The
  // normalized form must re-quote any token the shell would otherwise split.
  it("re-quotes a --settings JSON value so it survives re-execution", () => {
    expect(
      parseAgentCommand(
        `claude --dangerously-skip-permissions --settings '{"ultracode": true}'`,
      ),
    ).toBe(
      `claude --dangerously-skip-permissions --settings '{"ultracode": true}'`,
    );
  });

  it("re-quotes a flag value containing a space", () => {
    expect(
      parseAgentCommand(`claude --append-system-prompt "be terse please"`),
    ).toBe(`claude --append-system-prompt 'be terse please'`);
  });

  // Regression (codex review F2): an UNQUOTED leading-`~` path value must stay
  // BARE in the normalized form. The preexec mark captures the command's shell
  // SOURCE before tilde expansion, so re-quoting `~/…` would suppress expansion
  // and replay a literal `~` path (Claude would then fail to find the settings
  // file). The normalized form keeps it unquoted so the rerun re-expands it.
  it("keeps an unquoted leading-tilde path value bare so it re-expands on rerun", () => {
    expect(parseAgentCommand(`claude --settings ~/.claude/settings.json`)).toBe(
      `claude --settings ~/.claude/settings.json`,
    );
    expect(parseAgentCommand(`claude --add-dir ~/projects/foo`)).toBe(
      `claude --add-dir ~/projects/foo`,
    );
  });

  // Accepted trade-off (juspay/kolu#1407): `string-argv` strips the source
  // quotes, so a quoted-literal tilde (`--settings '~/x'`) and a bare one
  // (`--settings ~/x`) tokenize to the IDENTICAL token `~/x`. We intentionally
  // do NOT recover the source's quote provenance, so both normalize to a bare
  // (expanding) `~`. Preserving the rare quoted-literal-tilde case is not worth
  // the machinery — the overwhelmingly common case is an unquoted path.
  it("normalizes a quoted leading tilde to a bare (expanding) one", () => {
    expect(parseAgentCommand(`claude --settings '~/x'`)).toBe(
      `claude --settings ~/x`,
    );
    expect(parseAgentCommand(`claude --settings "~/x"`)).toBe(
      `claude --settings ~/x`,
    );
  });

  // Accepted trade-off (juspay/kolu#1407): a tilde value that ALSO needs quoting
  // for a space loses expansion on rerun. Without the source-provenance
  // machinery, `string-argv` retains the mid-token quotes (the token is the
  // literal `~/'My Projects'`) and we quote the whole thing, so the `~` ends up
  // literal — a rare degradation we accept. The property that MUST still hold —
  // the one the original bug broke — is that the value stays ONE argument and
  // never word-splits on its space.
  it("keeps a spaced tilde value as a single argument (tilde no longer expands)", () => {
    const normalized = parseAgentCommand(`claude --add-dir ~/'My Projects'`);
    expect(shellSplit(normalized as string)).toEqual([
      "claude",
      "--add-dir",
      `~/'My Projects'`,
    ]);
  });

  // Regression (codex review F3): a flag value containing an apostrophe is
  // single-quoted with the canonical `'\''` idiom; the normalized form must
  // re-tokenize (via shellSplit, the inverse of shellJoin) back to one token.
  it("round-trips a flag value containing an apostrophe", () => {
    const normalized = parseAgentCommand(
      `claude --append-system-prompt "don't be verbose"`,
    );
    expect(normalized).toBe(
      `claude --append-system-prompt 'don'\\''t be verbose'`,
    );
    expect(shellSplit(normalized as string)).toEqual([
      "claude",
      "--append-system-prompt",
      "don't be verbose",
    ]);
  });

  // The chosen quote style is an implementation detail; the invariant that
  // actually matters is that the normalized string re-tokenizes to the same
  // argv it was built from — i.e. no value silently splits into two args.
  it("normalized output re-tokenizes to the same kept argv (no re-split)", () => {
    const normalized = parseAgentCommand(
      `claude --settings '{"ultracode": true}' --append-system-prompt "be terse"`,
    );
    expect(normalized).not.toBeNull();
    expect(parseArgsStringToArgv(normalized as string)).toEqual([
      "claude",
      "--settings",
      `{"ultracode": true}`,
      "--append-system-prompt",
      "be terse",
    ]);
  });
});

describe("resumeAgentCommand", () => {
  it.each([
    ["claude", "claude -c"],
    ["claude --model sonnet", "claude -c --model sonnet"],
    [
      "claude --permission-mode plan --add-dir /tmp/foo",
      "claude -c --permission-mode plan --add-dir /tmp/foo",
    ],
    ["codex", "codex resume --last"],
    ["codex --yolo", "codex resume --last --yolo"],
    [
      // Input is the (now single-quoted) normalized form; the resume splice
      // must preserve that quoting around the embedded-quote value.
      `codex --yolo --model gpt-5.5 --config 'model_reasoning_effort="xhigh"'`,
      `codex resume --last --yolo --model gpt-5.5 --config 'model_reasoning_effort="xhigh"'`,
    ],
    ["opencode", "opencode --continue"],
    [
      "opencode --agent build --pure",
      "opencode --continue --agent build --pure",
    ],
  ])("resume form of %j → %j", (normalized, expected) => {
    expect(resumeAgentCommand(normalized)).toBe(expected);
  });

  it("returns null for detection-only agents", () => {
    expect(resumeAgentCommand("aider")).toBeNull();
    expect(resumeAgentCommand("aider --model opus")).toBeNull();
    expect(resumeAgentCommand("goose")).toBeNull();
    expect(resumeAgentCommand("gemini")).toBeNull();
    expect(resumeAgentCommand("cursor-agent")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resumeAgentCommand("")).toBeNull();
    expect(resumeAgentCommand("   ")).toBeNull();
  });

  // Regression: same quote-loss as parseAgentCommand, on the resume
  // path. The input here is already a normalized (quoted) command; splicing
  // in the resume flag and re-joining must preserve the quoting so the
  // auto-typed session-restore command does not word-split on re-execution.
  it("preserves a quoted flag value across the resume splice", () => {
    expect(resumeAgentCommand(`claude --settings '{"ultracode": true}'`)).toBe(
      `claude -c --settings '{"ultracode": true}'`,
    );
  });

  // Regression (codex review F3): the resume reparse must use shellSplit, not
  // string-argv — a value carrying the canonical `'\''` apostrophe idiom would
  // otherwise shatter into several tokens and corrupt the spliced command.
  it("round-trips an apostrophe value across the resume splice", () => {
    const resumed = resumeAgentCommand(
      `claude --append-system-prompt 'don'\\''t be verbose'`,
    );
    expect(resumed).toBe(
      `claude -c --append-system-prompt 'don'\\''t be verbose'`,
    );
    expect(shellSplit(resumed as string)).toEqual([
      "claude",
      "-c",
      "--append-system-prompt",
      "don't be verbose",
    ]);
  });

  // The resume splice keeps the tail VERBATIM (head + marker + raw tail), so a
  // bare tilde stays bare and still expands on rerun — there is no
  // shellSplit+shellJoin round-trip that could re-quote it.
  it("preserves a bare tilde across the resume splice", () => {
    expect(resumeAgentCommand(`claude --add-dir ~/projects/foo`)).toBe(
      `claude -c --add-dir ~/projects/foo`,
    );
  });
});

describe("nix run wrapper — resume re-runs the wrapper, not the bare agent", () => {
  // `nix run github:juspay/AI#opencode` runs opencode WITHOUT it on PATH; resume
  // must go back through the wrapper (`-- --continue`), or it errors
  // `command not found`. The wrapped agent is the flake ref's `#fragment`.
  const WRAP = "nix run github:juspay/AI#opencode";

  it("recognizes the wrapped agent", () => {
    expect(nixRunWrappedAgent(WRAP)).toBe("opencode");
    expect(nixRunWrappedAgent(`${WRAP} --model glm`)).toBe("opencode");
    expect(nixRunWrappedAgent("nix run nixpkgs#vim")).toBeNull(); // not an agent
    expect(nixRunWrappedAgent("nix build .#foo")).toBeNull(); // not `run`
    expect(nixRunWrappedAgent("opencode")).toBeNull(); // direct, not a wrapper
  });

  it("captures the wrapper as the bare re-runnable launch (drops trailing args)", () => {
    expect(parseAgentCommand(WRAP)).toBe(WRAP);
    expect(parseAgentCommand(`${WRAP} --model glm "do a thing"`)).toBe(WRAP);
    expect(parseAgentCommand("nix run nixpkgs#vim")).toBeNull();
  });

  // Regression (codex review F7): the direct path rejects an exit-immediate
  // invocation (`opencode --help`), but the SAME flag through the wrapper
  // (`nix run …#opencode -- --help`) reaches the same exit-at-once agent — so it
  // must be rejected too rather than pollute recent/resume state. The flag may
  // sit before OR after the `--` separator.
  it("rejects a wrapped agent invoked with an exit-immediately flag", () => {
    expect(parseAgentCommand(`${WRAP} -- --help`)).toBeNull();
    expect(parseAgentCommand(`${WRAP} -- --version`)).toBeNull();
    expect(parseAgentCommand(`${WRAP} -- -h`)).toBeNull();
    expect(parseAgentCommand(`${WRAP} --help`)).toBeNull();
    expect(parseAgentCommand("nix run github:juspay/AI#codex -- -V")).toBeNull();
    // A normal flag after `--` still captures the bare re-runnable wrapper.
    expect(parseAgentCommand(`${WRAP} -- --model glm`)).toBe(WRAP);
  });

  it("resumes THROUGH the wrapper with `-- <marker>`", () => {
    expect(resumeAgentCommand(WRAP)).toBe(`${WRAP} -- --continue`);
    expect(resumeAgentCommand("nix run github:juspay/AI#codex")).toBe(
      "nix run github:juspay/AI#codex -- resume --last",
    );
  });

  it("identifies the agent kind + name through the wrapper", () => {
    expect(agentKindFromCommand(WRAP)).toBe("opencode");
    expect(agentNameFromCommand(WRAP)).toBe("opencode");
  });
});

describe("agentCommandForKind — detected kind → resumable command", () => {
  // The fallback sleep uses when the OSC command tap never fired but an agent was
  // DETECTED: the kind alone must round-trip to a real resume form, for all three.
  it.each([
    ["claude-code", "claude", "claude -c"],
    ["codex", "codex", "codex resume --last"],
    ["opencode", "opencode", "opencode --continue"],
  ] as const)("%s → %s → resume %s", (kind, command, resumeForm) => {
    expect(agentCommandForKind(kind)).toBe(command);
    expect(resumeAgentCommand(agentCommandForKind(kind))).toBe(resumeForm);
  });
});

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
