import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-tx-"));
process.env.KOLU_GROK_DIR = tmpHome;

const {
  contentToText,
  loadGrokTranscript,
  normalizeGrokToolInput,
  parseGrokChatHistory,
  unwrapGrokUserText,
} = await import("./transcript.ts");
const { encodeCwd } = await import("./core.ts");
const { SESSIONS_DIR } = await import("./config.ts");

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.mkdirSync(tmpHome, { recursive: true });
});

describe("contentToText", () => {
  it("joins text blocks from array content", () => {
    expect(
      contentToText([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello\nworld");
  });

  it("returns a bare string content", () => {
    expect(contentToText("plain")).toBe("plain");
  });
});

describe("unwrapGrokUserText", () => {
  it("extracts the inner user_query body", () => {
    expect(unwrapGrokUserText("<user_query>\nhi\n</user_query>")).toBe("hi");
  });

  it("joins multiple user_query blocks", () => {
    expect(
      unwrapGrokUserText(
        "<user_query>first</user_query>\n<user_query>second</user_query>",
      ),
    ).toBe("first\n\nsecond");
  });

  it("prefers user_query over sibling harness blocks (image_files, notices)", () => {
    const raw = `<image_files>
The following images were provided by the user and saved to the workspace for future use:
1. /tmp/shot.jpg
</image_files>

<user_query>
what's this user_query stuff
</user_query>`;
    expect(unwrapGrokUserText(raw)).toBe("what's this user_query stuff");
  });

  it("strips leftover harness tags when no closed user_query is present", () => {
    expect(unwrapGrokUserText("<user_query>unclosed prompt")).toBe(
      "unclosed prompt",
    );
  });

  it("passes through plain text without inventing wrappers", () => {
    expect(unwrapGrokUserText("just a prompt")).toBe("just a prompt");
  });
});

describe("normalizeGrokToolInput", () => {
  it("maps run_terminal_command → bash", () => {
    expect(
      normalizeGrokToolInput("run_terminal_command", {
        command: "ls -la",
      }),
    ).toEqual({ kind: "bash", command: "ls -la" });
  });

  it("maps read_file → read", () => {
    expect(
      normalizeGrokToolInput("read_file", { target_file: "/tmp/a.ts" }),
    ).toEqual({ kind: "read", filePath: "/tmp/a.ts" });
  });

  it("maps search_replace → edit", () => {
    expect(
      normalizeGrokToolInput("search_replace", {
        file_path: "a.ts",
        old_string: "x",
        new_string: "y",
      }),
    ).toEqual({
      kind: "edit",
      filePath: "a.ts",
      edits: [{ oldText: "x", newText: "y" }],
    });
  });

  it("falls through to unknown for unmodelled tools", () => {
    expect(normalizeGrokToolInput("spawn_subagent", { prompt: "go" })).toEqual({
      kind: "unknown",
      toolName: "spawn_subagent",
      raw: { prompt: "go" },
    });
  });
});

describe("parseGrokChatHistory", () => {
  it("folds user / reasoning / assistant / tool_call / tool_result", () => {
    const raw = [
      { type: "system", content: "You are Grok." },
      {
        type: "user",
        content: [
          {
            type: "text",
            text: "<user_query>\nfix the bug\n</user_query>",
          },
        ],
      },
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "looking at the code" }],
      },
      {
        type: "assistant",
        content: "I'll check.",
        model_id: "grok-4.5",
        tool_calls: [
          {
            id: "call-1",
            name: "run_terminal_command",
            arguments: JSON.stringify({ command: "rg bug" }),
          },
        ],
      },
      {
        type: "tool_result",
        tool_call_id: "call-1",
        content: "found it",
      },
      {
        type: "user",
        synthetic_reason: "compaction_meta",
        content: [{ type: "text", text: "noise" }],
      },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");

    const events = parseGrokChatHistory(raw);
    expect(events.map((e) => e.kind)).toEqual([
      "user",
      "reasoning",
      "assistant",
      "tool_call",
      "tool_result",
    ]);
    expect(events[0]).toMatchObject({ kind: "user", text: "fix the bug" });
    expect(events[2]).toMatchObject({
      kind: "assistant",
      text: "I'll check.",
      model: "grok-4.5",
    });
    expect(events[3]).toMatchObject({
      kind: "tool_call",
      id: "call-1",
      toolName: "run_terminal_command",
      inputs: { kind: "bash", command: "rg bug" },
    });
    expect(events[4]).toMatchObject({
      kind: "tool_result",
      id: "call-1",
      output: "found it",
    });
  });
});

describe("loadGrokTranscript", () => {
  it("returns null when chat_history is missing", () => {
    expect(
      loadGrokTranscript({
        sessionId: "sess-1",
        cwd: "/tmp/proj",
        title: null,
        repoName: null,
        model: null,
        contextTokens: null,
        pr: null,
      }),
    ).toBeNull();
  });

  it("loads chat_history.jsonl for a session", () => {
    const cwd = "/tmp/proj";
    const id = "019f4782-7854-7592-8d87-3ba3a205a0a1";
    const dir = path.join(SESSIONS_DIR, encodeCwd(cwd), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "chat_history.jsonl"),
      `${JSON.stringify({
        type: "user",
        content: [{ type: "text", text: "hi" }],
      })}\n`,
    );

    const tx = loadGrokTranscript({
      sessionId: id,
      cwd,
      title: "Mock",
      repoName: "kolu",
      model: "grok-4.5",
      contextTokens: 12_345,
      pr: null,
    });
    expect(tx).not.toBeNull();
    expect(tx?.agentKind).toBe("grok");
    expect(tx?.contextTokens).toBe(12_345);
    expect(tx?.events).toEqual([{ kind: "user", text: "hi", ts: null }]);
  });
});
