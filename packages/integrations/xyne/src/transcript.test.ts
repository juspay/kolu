import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-xyne-tx-"));
process.env.KOLU_XYNE_DIR = tmpHome;

const {
  contentToText,
  eventsFromXyneLine,
  loadXyneTranscript,
  normalizeXyneToolInput,
  parseXyneSessionJsonl,
} = await import("./transcript.ts");
const { encodeCwd } = await import("./core.ts");
const { SESSIONS_DIR } = await import("./config.ts");

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.mkdirSync(tmpHome, { recursive: true });
});

function writeSession(opts: {
  id: string;
  cwd: string;
  lines: string[];
  tsName?: string;
}): void {
  const dir = path.join(SESSIONS_DIR, encodeCwd(opts.cwd));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${opts.tsName ?? "2026-08-04T01-00-00-000Z"}_${opts.id}.jsonl`;
  fs.writeFileSync(path.join(dir, name), `${opts.lines.join("\n")}\n`);
}

describe("eventsFromXyneLine", () => {
  it("maps a user message onto a user event", () => {
    const [ev] = eventsFromXyneLine({
      type: "message",
      timestamp: "2026-08-04T01:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello there" }],
        timestamp: 0,
      },
    });
    expect(ev?.kind).toBe("user");
    expect(ev && "text" in ev && ev.text).toBe("hello there");
  });

  it("maps an assistant message onto reasoning + assistant + tool_call", () => {
    const events = eventsFromXyneLine({
      type: "message",
      timestamp: "2026-08-04T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "kimi-k3",
        content: [
          { type: "thinking", thinking: "the plan is …" },
          { type: "text", text: "Here's my answer." },
          {
            type: "toolCall",
            id: "ls:0",
            name: "ls",
            arguments: { path: "/repo" },
          },
        ],
        timestamp: 0,
      },
    });
    expect(events.map((e) => e.kind)).toEqual([
      "reasoning",
      "assistant",
      "tool_call",
    ]);
    const call = events[2];
    expect(call?.kind === "tool_call" && call.toolName).toBe("ls");
    expect(
      call?.kind === "tool_call" && call.inputs.kind === "glob"
        ? call.inputs.path
        : null,
    ).toBe("/repo");
  });

  it("maps a toolResult onto a tool_result with the raw output", () => {
    const [ev] = eventsFromXyneLine({
      type: "message",
      timestamp: "2026-08-04T01:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "ls:0",
        toolName: "ls",
        content: [{ type: "text", text: "file1\nfile2" }],
        isError: false,
      },
    });
    expect(ev?.kind).toBe("tool_result");
    expect(ev && "output" in ev && ev.output).toBe("file1\nfile2");
    expect(ev?.kind === "tool_result" && ev.isError).toBe(false);
  });

  it("skips session bookkeeping rows (header, model_change, agent-mode)", () => {
    expect(
      eventsFromXyneLine({
        type: "session",
        timestamp: "2026-08-04T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      eventsFromXyneLine({
        type: "model_change",
        timestamp: "2026-08-04T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      eventsFromXyneLine({
        type: "custom",
        timestamp: "2026-08-04T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("skips an assistant message with no text and no calls", () => {
    const events = eventsFromXyneLine({
      type: "message",
      timestamp: "2026-08-04T00:00:00.000Z",
      message: { role: "assistant", content: [], timestamp: 0 },
    });
    expect(events).toEqual([]);
  });
});

describe("normalizeXyneToolInput", () => {
  it("maps bash onto the bash kind", () => {
    expect(
      normalizeXyneToolInput("bash", { command: "ls /tmp" }),
    ).toEqual({ kind: "bash", command: "ls /tmp" });
  });

  it("maps ls onto a glob with a path hint", () => {
    expect(normalizeXyneToolInput("ls", { path: "/repo" })).toEqual({
      kind: "glob",
      pattern: "*",
      path: "/repo",
    });
  });

  it("maps edit onto the edit kind with old/new hunks", () => {
    expect(
      normalizeXyneToolInput("edit", {
        path: "/a.ts",
        oldText: "foo",
        newText: "bar",
      }),
    ).toEqual({
      kind: "edit",
      filePath: "/a.ts",
      edits: [{ oldText: "foo", newText: "bar" }],
    });
  });

  it("falls through to unknown for an unrecognized tool", () => {
    expect(normalizeXyneToolInput("scratchpad", { text: "x" })).toEqual({
      kind: "unknown",
      toolName: "scratchpad",
      raw: { text: "x" },
    });
  });
});

describe("parseXyneSessionJsonl", () => {
  it("drops malformed lines and keeps parsing the rest", () => {
    const good = JSON.stringify({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "ok" }] },
    });
    const events = parseXyneSessionJsonl(`${good}\n{bad json\n${good}`);
    expect(events).toHaveLength(2);
  });

  it("skips empty lines", () => {
    const good = JSON.stringify({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "x" }] },
    });
    expect(parseXyneSessionJsonl(`${good}\n\n${good}`)).toHaveLength(2);
  });
});

describe("loadXyneTranscript", () => {
  it("returns null when the per-cwd sessions dir doesn't exist", () => {
    expect(
      loadXyneTranscript({
        sessionId: "019fc2c8-aaaa-7000-8000-000000000000",
        title: null,
        repoName: null,
        cwd: "/no/such/dir",
        model: null,
        contextTokens: null,
        pr: null,
      }),
    ).toBeNull();
  });

  it("returns null when the named session file isn't in the dir", () => {
    writeSession({
      id: "019fca6a-bbbb-7000-8000-000000000000",
      cwd: "/repo",
      lines: [
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }),
      ],
    });
    expect(
      loadXyneTranscript({
        sessionId: "019fc999-9999-7000-8000-000000000000",
        title: null,
        repoName: null,
        cwd: "/repo",
        model: null,
        contextTokens: null,
        pr: null,
      }),
    ).toBeNull();
  });

  it("loads the transcript end-to-end for the matching sessionId", () => {
    writeSession({
      id: "019fca6a-b0ae-7204-a1bf-41913e5e6e5a",
      cwd: "/home/me/kolu",
      lines: [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "019fca6a-b0ae-7204-a1bf-41913e5e6e5a",
          timestamp: "2026-08-04T01:36:57.518Z",
          cwd: "/home/me/kolu",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-08-04T01:36:58.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Fix the frobnicator" }],
            timestamp: 0,
          },
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-08-04T01:36:59.000Z",
          message: {
            role: "assistant",
            model: "kimi-k3",
            content: [{ type: "text", text: "On it." }],
            usage: { input: 100, output: 3, totalTokens: 103 },
            stopReason: "stop",
            timestamp: 0,
          },
        }),
      ],
    });
    const transcript = loadXyneTranscript({
      sessionId: "019fca6a-b0ae-7204-a1bf-41913e5e6e5a",
      title: "Frob title",
      repoName: "kolu",
      cwd: "/home/me/kolu",
      model: "kimi-k3",
      contextTokens: 47100,
      pr: null,
    });
    expect(transcript).not.toBeNull();
    expect(transcript?.sessionId).toBe(
      "019fca6a-b0ae-7204-a1bf-41913e5e6e5a",
    );
    expect(transcript?.events).toHaveLength(2);
    expect(transcript?.events[0]?.kind).toBe("user");
    expect(transcript?.events[1]?.kind).toBe("assistant");
    expect(transcript?.events[1]?.kind === "assistant" &&
      transcript?.events[1]?.model).toBe("kimi-k3");
  });
});
