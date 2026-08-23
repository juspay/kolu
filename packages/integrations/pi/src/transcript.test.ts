import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Point pi home at a temp dir BEFORE importing modules that capture paths.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-pi-tr-test-"));
process.env.KOLU_PI_DIR = tmpHome;

const { sessionDirFor } = await import("./core.ts");
const { normalizePiToolInput, parsePiTranscript, loadPiTranscript } =
  await import("./transcript.ts");

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const line = (o: object) => JSON.stringify(o);

describe("parsePiTranscript", () => {
  it("renders user / reasoning / assistant / tool_call / tool_result and skips non-conversation entries", () => {
    const events = parsePiTranscript(
      [
        '{"type":"session","version":3,"id":"s","timestamp":"t","cwd":"/x"}',
        '{"type":"model_change","id":"m","parentId":null,"timestamp":"t","provider":"p","modelId":"k"}',
        line({
          type: "message",
          id: "u1",
          timestamp: "2026-08-23T19:00:00.000Z",
          message: { role: "user", content: [{ type: "text", text: "hello" }] },
        }),
        line({
          type: "message",
          id: "a1",
          timestamp: "2026-08-23T19:00:01.000Z",
          message: {
            role: "assistant",
            model: "kimi-k3",
            content: [
              { type: "thinking", thinking: "pondering" },
              { type: "text", text: "reply" },
              {
                type: "toolCall",
                id: "bash:1",
                name: "bash",
                arguments: { command: "ls" },
              },
            ],
          },
        }),
        line({
          type: "message",
          id: "r1",
          timestamp: "2026-08-23T19:00:02.000Z",
          message: {
            role: "toolResult",
            toolCallId: "bash:1",
            toolName: "bash",
            content: [{ type: "text", text: "file.ts" }],
            isError: false,
          },
        }),
        // Interactive artifact — skipped.
        line({
          type: "message",
          id: "b1",
          timestamp: "t",
          message: { role: "bashExecution", command: "ls", output: "x" },
        }),
        '{"type":"compaction","id":"c","timestamp":"t","summary":"…"}',
        "not json",
      ].join("\n"),
    );

    expect(events.map((e) => e.kind)).toEqual([
      "user",
      "reasoning",
      "tool_call",
      "assistant",
      "tool_result",
    ]);
    expect(events[0]).toMatchObject({ kind: "user", text: "hello" });
    expect(events[1]).toMatchObject({ kind: "reasoning", text: "pondering" });
    expect(events[2]).toMatchObject({
      kind: "tool_call",
      id: "bash:1",
      toolName: "bash",
      inputs: { kind: "bash", command: "ls" },
    });
    expect(events[3]).toMatchObject({
      kind: "assistant",
      text: "reply",
      model: "kimi-k3",
    });
    expect(events[4]).toMatchObject({
      kind: "tool_result",
      id: "bash:1",
      isError: false,
    });
  });
});

describe("parsePiTranscript — tree semantics", () => {
  const msg = (
    id: string,
    parentId: string | null,
    role: string,
    text: string,
  ) =>
    line({
      type: "message",
      id,
      parentId,
      timestamp: "t",
      message:
        role === "user"
          ? { role, content: [{ type: "text", text }] }
          : { role, content: [{ type: "text", text }], model: "m" },
    });

  it("renders only the ACTIVE branch: entries off the last entry's parentId chain are dropped", () => {
    // File order interleaves an abandoned branch (b1→b2, dead-ends the
    // line) with the live one: pi's /tree navigation re-pointed the leaf
    // from b2 back to u1, and the visible conversation is u1→a1→a2.
    const events = parsePiTranscript(
      [
        msg("u1", null, "user", "first prompt"),
        msg("b1", "u1", "assistant", "branch attempt one"),
        msg("b2", "b1", "assistant", "branch attempt two"),
        msg("a1", "u1", "assistant", "real answer"),
        msg("a2", "a1", "assistant", "follow-up"),
      ].join("\n"),
    );
    const users = events.filter((e) => e.kind === "user");
    const assistants = events.filter((e) => e.kind === "assistant");
    expect(users).toHaveLength(1);
    expect(
      assistants.map((e) => (e.kind === "assistant" ? e.text : "")),
    ).toEqual(["real answer", "follow-up"]);
  });

  it("entries without ids (older pi files) pass through unfiltered", () => {
    const events = parsePiTranscript(
      [
        line({
          type: "message",
          timestamp: "t",
          message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }),
        line({
          type: "message",
          timestamp: "t",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello" }],
            model: "m",
          },
        }),
      ].join("\n"),
    );
    expect(events.map((e) => e.kind)).toEqual(["user", "assistant"]);
  });
});

describe("normalizePiToolInput", () => {
  it("maps the built-ins to their typed kinds", () => {
    expect(normalizePiToolInput("read", { path: "/f" })).toEqual({
      kind: "read",
      filePath: "/f",
    });
    expect(normalizePiToolInput("bash", { command: "ls" })).toEqual({
      kind: "bash",
      command: "ls",
    });
    expect(normalizePiToolInput("write", { path: "/f", content: "c" })).toEqual(
      { kind: "write", filePath: "/f", content: "c" },
    );
    expect(
      normalizePiToolInput("edit", { path: "/f", oldText: "a", newText: "b" }),
    ).toEqual({
      kind: "edit",
      filePath: "/f",
      edits: [{ oldText: "a", newText: "b" }],
    });
  });

  it("falls extension tools through to unknown with raw args", () => {
    expect(normalizePiToolInput("lsp_hover", { symbol: "x" })).toEqual({
      kind: "unknown",
      toolName: "lsp_hover",
      raw: { symbol: "x" },
    });
  });
});

describe("loadPiTranscript", () => {
  it("nulls when the cwd's session dir is absent and when the id matches nothing", () => {
    expect(
      loadPiTranscript({
        sessionId: "nope",
        title: null,
        repoName: null,
        cwd: "/never/here",
        model: null,
        contextTokens: null,
        pr: null,
      }),
    ).toBeNull();
  });

  it("loads the session whose FILENAME id matches", () => {
    const cwd = "/work/project";
    const id = "aaaaaaaa-0000-0000-0000-000000000001";
    const dir = sessionDirFor(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `2026-08-23T19-48-21-451Z_${id}.jsonl`),
      line({
        type: "message",
        id: "u1",
        timestamp: "2026-08-23T19:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    );
    const t = loadPiTranscript({
      sessionId: id,
      title: null,
      repoName: "kolu",
      cwd,
      model: null,
      contextTokens: null,
      pr: null,
    });
    expect(t?.agentKind).toBe("pi");
    expect(t?.sessionId).toBe(id);
    expect(t?.events[0]).toMatchObject({ kind: "user", text: "hi" });
  });

  it("nulls when the caller cannot supply a cwd", () => {
    expect(
      loadPiTranscript({
        sessionId: "x",
        title: null,
        repoName: null,
        cwd: null,
        model: null,
        contextTokens: null,
        pr: null,
      }),
    ).toBeNull();
  });
});
