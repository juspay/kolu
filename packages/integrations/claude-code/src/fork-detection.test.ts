import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completedBackgroundTaskIds } from "./core.ts";

describe("completedBackgroundTaskIds", () => {
  function enqueue(taskId: string, status: string): string {
    return JSON.stringify({
      type: "queue-operation",
      operation: "enqueue",
      content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`,
    });
  }

  it("collects ids whose notification carries a terminal status", () => {
    const ids = completedBackgroundTaskIds([
      enqueue("aimplement-it-9df12c6c7b691483", "completed"),
      enqueue("b1", "failed"),
      enqueue("c1", "stopped"),
      enqueue("d1", "killed"),
    ]);
    expect([...ids].sort()).toEqual([
      "aimplement-it-9df12c6c7b691483",
      "b1",
      "c1",
      "d1",
    ]);
  });

  it("ignores a non-terminal (running) notification", () => {
    expect(completedBackgroundTaskIds([enqueue("t1", "running")]).size).toBe(0);
  });

  it("ignores non-enqueue queue operations and malformed lines", () => {
    const dequeue = JSON.stringify({
      type: "queue-operation",
      operation: "dequeue",
    });
    const ids = completedBackgroundTaskIds([
      dequeue,
      "not json",
      JSON.stringify({ type: "assistant" }),
    ]);
    expect(ids.size).toBe(0);
  });
});

describe("outstandingForkRuns / nextStaleDeadline", () => {
  let tmpDir: string;
  let outstandingForkRuns: typeof import("./index.ts").outstandingForkRuns;
  let nextStaleDeadline: typeof import("./index.ts").nextStaleDeadline;
  let subagentsDirFor: typeof import("./index.ts").subagentsDirFor;
  let staleMs: number;
  const sessionId = "fork-test-session";
  const cwd = "/home/user/fork-project";
  const session = { pid: 1, sessionId, cwd };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fork-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    outstandingForkRuns = mod.outstandingForkRuns;
    nextStaleDeadline = mod.nextStaleDeadline;
    subagentsDirFor = mod.subagentsDirFor;
    staleMs = mod.FORK_TRANSCRIPT_STALE_MS;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const subagentsDir = () => subagentsDirFor(session);

  function writeAgent(
    id: string,
    opts: {
      agentType?: string;
      ageMs?: number;
      withTranscript?: boolean;
      metaRaw?: string;
    } = {},
  ): void {
    const { agentType, ageMs = 0, withTranscript = true, metaRaw } = opts;
    const dir = subagentsDir();
    fs.mkdirSync(dir, { recursive: true });
    const meta =
      metaRaw ??
      JSON.stringify({
        ...(agentType ? { agentType } : {}),
        name: id,
        description: id,
      });
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), meta);
    if (withTranscript) {
      const jp = path.join(dir, `agent-${id}.jsonl`);
      fs.writeFileSync(jp, "{}\n");
      if (ageMs > 0) {
        const t = new Date(Date.now() - ageMs);
        fs.utimesSync(jp, t, t);
      }
    }
  }

  const NONE = new Set<string>();

  it("returns a live fork: agentType fork, fresh transcript, not completed", () => {
    writeAgent("aimplement-it-fresh", { agentType: "fork" });
    const forks = outstandingForkRuns(session, NONE);
    expect(forks.map((f) => f.id)).toContain("aimplement-it-fresh");
    const fork = forks.find((f) => f.id === "aimplement-it-fresh");
    expect(typeof fork?.anchorMs).toBe("number");
    expect(fork?.staleMs).toBe(staleMs);
  });

  it("excludes a fork whose id is in the completed set (finished)", () => {
    writeAgent("afork-done", { agentType: "fork" });
    const forks = outstandingForkRuns(session, new Set(["afork-done"]));
    expect(forks.map((f) => f.id)).not.toContain("afork-done");
  });

  it("excludes a fork whose transcript has gone stale (orphaned)", () => {
    writeAgent("afork-stale", { agentType: "fork", ageMs: staleMs + 60_000 });
    const forks = outstandingForkRuns(session, NONE);
    expect(forks.map((f) => f.id)).not.toContain("afork-stale");
  });

  it("excludes a non-fork async agent (different/absent agentType)", () => {
    writeAgent("arun-full-ci", {});
    writeAgent("asome-task", { agentType: "task" });
    const forks = outstandingForkRuns(session, NONE);
    const ids = forks.map((f) => f.id);
    expect(ids).not.toContain("arun-full-ci");
    expect(ids).not.toContain("asome-task");
  });

  it("excludes a fork with no transcript (unobservable — phantom guard)", () => {
    writeAgent("afork-nojsonl", { agentType: "fork", withTranscript: false });
    const forks = outstandingForkRuns(session, NONE);
    expect(forks.map((f) => f.id)).not.toContain("afork-nojsonl");
  });

  it("excludes a fork whose meta is malformed JSON (can't positively classify)", () => {
    writeAgent("afork-badmeta", { metaRaw: "{ not json" });
    const forks = outstandingForkRuns(session, NONE);
    expect(forks.map((f) => f.id)).not.toContain("afork-badmeta");
  });

  it("returns [] when the subagents dir is absent (no throw)", () => {
    const fresh = {
      pid: 9,
      sessionId: "no-subagents-session",
      cwd: "/home/user/no-subagents-project",
    };
    expect(outstandingForkRuns(fresh, NONE)).toEqual([]);
  });

  it("ignores the workflows/ subdir and stray non-meta entries", () => {
    writeAgent("afork-ok", { agentType: "fork" });
    fs.mkdirSync(path.join(subagentsDir(), "workflows"), { recursive: true });
    fs.writeFileSync(path.join(subagentsDir(), "agent-stray.jsonl"), "{}\n");
    const forks = outstandingForkRuns(session, NONE);
    expect(forks.map((f) => f.id)).toContain("afork-ok");
  });

  it("uses the injected `now` for the staleness boundary", () => {
    writeAgent("afork-now", { agentType: "fork" });
    const anchor = fs.statSync(
      path.join(subagentsDir(), "agent-afork-now.jsonl"),
    ).mtimeMs;
    expect(
      outstandingForkRuns(session, NONE, anchor + staleMs - 1).map((f) => f.id),
    ).toContain("afork-now");
    expect(
      outstandingForkRuns(session, NONE, anchor + staleMs + 1).map((f) => f.id),
    ).not.toContain("afork-now");
  });

  describe("nextStaleDeadline (fork runs)", () => {
    const fork = (id: string, anchorMs: number) => ({
      id,
      anchorMs,
      staleMs,
    });

    it("returns the transcript mtime plus the stale window for a live fork", () => {
      const anchorMs = 1_000_000;
      expect(nextStaleDeadline([fork("f1", anchorMs)], 0)).toBe(
        anchorMs + staleMs,
      );
    });

    it("clamps an already-stale fork's deadline to `now` (fire immediately)", () => {
      const now = 10_000_000;
      const anchorMs = now - staleMs - 60_000;
      expect(nextStaleDeadline([fork("f1", anchorMs)], now)).toBe(now);
    });

    it("returns the earliest deadline across multiple forks", () => {
      const now = 0;
      expect(
        nextStaleDeadline([fork("old", 1_000), fork("new", 9_000)], now),
      ).toBe(1_000 + staleMs);
    });

    it("returns null for an empty run set", () => {
      expect(nextStaleDeadline([], 0)).toBeNull();
    });
  });
});

describe("createSessionWatcher — /fork lifecycle (eventing path)", () => {
  let tmpDir: string;
  let createSessionWatcher: typeof import("./index.ts").createSessionWatcher;
  let subagentsDirFor: typeof import("./index.ts").subagentsDirFor;
  let encodeProjectPath: typeof import("./index.ts").encodeProjectPath;
  const sessionId = "fork-watcher-session";
  const cwd = "/home/user/fork-watcher-project";
  const session = { pid: 1, sessionId, cwd };
  let transcriptChanged: (() => void) | null = null;

  const noopLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fork-watcher-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();

    const core = await vi.importActual<typeof import("./core.ts")>("./core.ts");
    subagentsDirFor = core.subagentsDirFor;
    encodeProjectPath = core.encodeProjectPath;
    vi.doMock("./core.ts", () => ({
      ...core,
      watchOrWaitForDir: () => () => {},
    }));

    const io = await vi.importActual<typeof import("kolu-io")>("kolu-io");
    vi.doMock("kolu-io", () => ({
      ...io,
      subscribeFileAppends: (
        _path: string,
        onChange: () => void,
      ): (() => void) => {
        transcriptChanged = onChange;
        return () => {
          transcriptChanged = null;
        };
      },
    }));

    ({ createSessionWatcher } = await import("./session-watcher.ts"));
  });

  afterAll(() => {
    vi.doUnmock("./core.ts");
    vi.doUnmock("kolu-io");
    vi.resetModules();
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const projectDir = () => path.join(tmpDir, encodeProjectPath(cwd));
  const transcriptPath = () => path.join(projectDir(), `${sessionId}.jsonl`);

  function appendTranscript(entry: object): void {
    fs.appendFileSync(transcriptPath(), `${JSON.stringify(entry)}\n`);
  }

  const endTurn = () => ({
    type: "assistant",
    message: { stop_reason: "end_turn", model: "claude-opus-4-8" },
  });

  const completion = (taskId: string) => ({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n</task-notification>`,
  });

  const forkEcho = (name: string) => ({
    type: "system",
    subtype: "local_command",
    content: `<local-command-stdout>⑂ forked ${name} (1483)</local-command-stdout>`,
  });

  function writeForkAgent(id: string): void {
    const dir = subagentsDirFor(session);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `agent-${id}.meta.json`),
      JSON.stringify({ agentType: "fork", name: id, description: id }),
    );
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), "{}\n");
  }

  it("promotes a waiting main to running_background when fork artifacts land late, then demotes on completion", async () => {
    vi.useFakeTimers();
    fs.mkdirSync(projectDir(), { recursive: true });
    fs.writeFileSync(transcriptPath(), `${JSON.stringify(endTurn())}\n`);

    const emitted: import("./index.ts").ClaudeCodeInfo[] = [];
    const watcher = createSessionWatcher(
      session,
      (info) => emitted.push(info),
      noopLog,
    );
    try {
      const latest = () => emitted.at(-1) ?? null;
      const state = () => latest()?.state ?? null;

      expect(state()).toBe("waiting");
      expect(latest()?.workflow ?? null).toBeNull();

      writeForkAgent("aimplement-it-late");
      appendTranscript(forkEcho("implement-it"));
      expect(transcriptChanged).not.toBeNull();
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      expect(state()).toBe("running_background");

      expect(latest()?.workflow ?? null).toBeNull();

      appendTranscript(completion("aimplement-it-late"));
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      expect(state()).toBe("waiting");
    } finally {
      watcher.destroy();
      vi.useRealTimers();
    }
  });
});
