import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { afterAll, describe, expect, it } from "vitest";

const log = silentLogger;

// Point the agent dir at a temp dir BEFORE importing modules that capture it.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-omp-tr-test-"));
process.env.KOLU_OMP_DIR = tmpHome;

const { ompAdapter, knownOmpSessionPath } = await import("./agent-adapter.ts");
const { parseOmpTranscript, loadOmpTranscript, normalizeOmpToolInput } =
  await import("./transcript.ts");

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const line = (o: object) => JSON.stringify(o);

/** omp's line-1 title slot (its fixed 256-byte header; the loader must skip it,
 *  exactly as the fold reads only the `title` out of it). */
const titleSlot = (title: string) =>
  line({ type: "title", v: 1, title, source: "auto", pad: "  " });

/** The session header on line 2 — note omp carries `title` here too; neither
 *  the slot nor the header is a conversation entry. */
const header = line({
  type: "session",
  version: 3,
  id: "01a0a0e3-1843-701b-bfde-c9c816e3e92f",
  timestamp: "2026-09-14T17:07:12.579Z",
  cwd: "/work/proj",
  title: "Run echo hello bash command",
  titleSource: "auto",
});

describe("parseOmpTranscript", () => {
  it("renders user / reasoning / assistant / tool_call / tool_result and skips the rest", () => {
    const events = parseOmpTranscript(
      [
        titleSlot("Run echo hello bash command"),
        header,
        line({
          type: "model_change",
          id: "m1",
          parentId: null,
          timestamp: "2026-09-14T17:07:13.000Z",
          model: "litellm/kimi-k3",
        }),
        line({
          type: "thinking_level_change",
          id: "t1",
          parentId: "m1",
          timestamp: "2026-09-14T17:07:13.100Z",
          thinkingLevel: "medium",
        }),
        line({
          type: "message",
          id: "u1",
          parentId: "t1",
          timestamp: "2026-09-14T17:07:14.000Z",
          message: { role: "user", content: [{ type: "text", text: "hello" }] },
        }),
        line({
          type: "title_change",
          id: "tc1",
          parentId: "u1",
          timestamp: "2026-09-14T17:07:14.500Z",
          title: "Run echo hello bash command",
          source: "auto",
        }),
        line({
          type: "message",
          id: "a1",
          parentId: "tc1",
          timestamp: "2026-09-14T17:07:15.000Z",
          message: {
            role: "assistant",
            model: "deepseek-v4.1-flash",
            stopReason: "toolUse",
            content: [
              { type: "thinking", thinking: "pondering" },
              { type: "text", text: "running it" },
              {
                type: "toolCall",
                id: "bash:1",
                name: "bash",
                arguments: { command: "echo hello" },
              },
            ],
          },
        }),
        line({
          type: "custom",
          customType: "tool_execution_start",
          id: "c1",
          parentId: "a1",
          timestamp: "2026-09-14T17:07:15.100Z",
          data: { tool: "bash" },
        }),
        line({
          type: "message",
          id: "r1",
          parentId: "c1",
          timestamp: "2026-09-14T17:07:16.000Z",
          message: {
            role: "toolResult",
            toolCallId: "bash:1",
            content: [{ type: "text", text: "hello" }],
            isError: false,
          },
        }),
        line({
          type: "custom",
          customType: "session_exit",
          id: "c2",
          parentId: "r1",
          timestamp: "2026-09-14T17:07:17.000Z",
        }),
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
      inputs: { kind: "bash", command: "echo hello" },
    });
    expect(events[3]).toMatchObject({
      kind: "assistant",
      text: "running it",
      model: "deepseek-v4.1-flash",
    });
    expect(events[4]).toMatchObject({
      kind: "tool_result",
      id: "bash:1",
      output: "hello",
      isError: false,
    });
  });

  it("renders only the ACTIVE branch of omp's entry tree", () => {
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
        timestamp: "2026-09-14T17:07:20.000Z",
        message: {
          role,
          content: [{ type: "text", text }],
          ...(role === "assistant" ? { model: "m" } : {}),
        },
      });
    // File order interleaves an abandoned branch (b1→b2) with the live one:
    // in-file branching re-pointed the leaf from b2 back to u1.
    const events = parseOmpTranscript(
      [
        titleSlot("branching"),
        msg("u1", null, "user", "first prompt"),
        msg("b1", "u1", "assistant", "branch attempt one"),
        msg("b2", "b1", "assistant", "branch attempt two"),
        msg("a1", "u1", "assistant", "real answer"),
        msg("a2", "a1", "assistant", "follow-up"),
      ].join("\n"),
    );
    expect(events.filter((e) => e.kind === "user")).toHaveLength(1);
    expect(
      events
        .filter((e) => e.kind === "assistant")
        .map((e) => (e.kind === "assistant" ? e.text : "")),
    ).toEqual(["real answer", "follow-up"]);
  });

  it("passes entries without ids through unfiltered", () => {
    const events = parseOmpTranscript(
      [
        titleSlot("legacy"),
        line({
          type: "message",
          timestamp: "2026-09-14T17:07:20.000Z",
          message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }),
        line({
          type: "message",
          timestamp: "2026-09-14T17:07:21.000Z",
          message: {
            role: "assistant",
            model: "m",
            content: [{ type: "text", text: "hello" }],
          },
        }),
      ].join("\n"),
    );
    expect(events.map((e) => e.kind)).toEqual(["user", "assistant"]);
  });
});

describe("normalizeOmpToolInput", () => {
  it("maps omp's built-ins to their typed kinds", () => {
    expect(normalizeOmpToolInput("read", { path: "/f" })).toEqual({
      kind: "read",
      filePath: "/f",
    });
    expect(normalizeOmpToolInput("bash", { command: "ls" })).toEqual({
      kind: "bash",
      command: "ls",
    });
    expect(
      normalizeOmpToolInput("write", { path: "/f", content: "c" }),
    ).toEqual({ kind: "write", filePath: "/f", content: "c" });
    expect(
      normalizeOmpToolInput("edit", { path: "/f", oldText: "a", newText: "b" }),
    ).toEqual({
      kind: "edit",
      filePath: "/f",
      edits: [{ oldText: "a", newText: "b" }],
    });
  });

  it("falls extension tools through to unknown with raw args", () => {
    expect(normalizeOmpToolInput("ast_edit", { pat: "x" })).toEqual({
      kind: "unknown",
      toolName: "ast_edit",
      raw: { pat: "x" },
    });
  });
});

describe("loadOmpTranscript", () => {
  it("nulls for a session this padi never observed live", () => {
    expect(knownOmpSessionPath("never-seen")).toBeNull();
    expect(
      loadOmpTranscript({
        sessionId: "never-seen",
        title: null,
        repoName: null,
        cwd: "/work/proj",
        model: null,
        contextTokens: null,
        pr: null,
      }),
    ).toBeNull();
  });

  // describeDaemon-gated: the stand-in foreground omp is a real forked child
  // whose stdin is INHERITED (so the adapter derives the same tty id omp
  // would), and its env is the one this test hands it — a real fork, so this
  // case runs only where forks are allowed.
  describeDaemon("the breadcrumb the adapter recorded", () => {
    it("loads the session, title and all, from that path", () => {
      // The tty anchor only exists when the test runner itself has a tty; a
      // tty-less CI worker is the "omp derives no id either" case, covered by
      // the e2e lane against a real PTY.
      if (process.platform !== "linux") return;
      let stdinTty: string;
      try {
        stdinTty = fs.readlinkSync("/proc/self/fd/0");
      } catch {
        return;
      }
      if (!stdinTty.startsWith("/dev/")) return;

      const sessionId = "01a0a0e3-1843-701b-bfde-c9c816e3e92f";
      const dir = path.join(tmpHome, "sessions", "-work-proj");
      fs.mkdirSync(dir, { recursive: true });
      const transcriptPath = path.join(
        dir,
        `2026-09-14T17-07-12-579Z_${sessionId}.jsonl`,
      );
      fs.writeFileSync(
        transcriptPath,
        `${titleSlot("Run echo hello bash command")}\n${header}\n${line({
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-09-14T17:07:14.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        })}\n`,
      );

      const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
        stdio: ["inherit", "ignore", "ignore"],
        // The child's env is exactly this — no ambient OMP_*/PI_* can leak in,
        // so the adapter's directory fold is deterministic.
        env: { PATH: process.env.PATH },
      });
      try {
        const ttyId = stdinTty.slice("/dev/".length).replace(/\//g, "-");
        fs.mkdirSync(path.join(tmpHome, "terminal-sessions"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(tmpHome, "terminal-sessions", ttyId),
          `/work/proj\n${transcriptPath}\n`,
        );
        const offered = ompAdapter.resolveSessions(
          {
            foregroundPid: child.pid,
            cwd: "/work/proj",
            readForegroundBasename: () => "omp",
            lastAgentCommandName: "omp",
          },
          log,
        );
        expect(offered?.map((s) => s.id)).toEqual([sessionId]);
      } finally {
        child.kill();
      }

      const transcript = loadOmpTranscript({
        sessionId,
        title: "ignored — the file's own slot wins",
        repoName: "kolu",
        cwd: "/work/proj",
        model: "deepseek-v4.1-flash",
        contextTokens: 12,
        pr: null,
      });
      expect(transcript?.agentName).toBe("Oh My Pi");
      expect(transcript?.sessionId).toBe(sessionId);
      expect(transcript?.title).toBe("Run echo hello bash command");
      expect(transcript?.events).toHaveLength(1);
      expect(transcript?.events[0]).toMatchObject({
        kind: "user",
        text: "hello",
      });
    });
  });
});
