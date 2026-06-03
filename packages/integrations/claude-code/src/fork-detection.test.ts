/** `/fork` detection — the on-disk scan that promotes an idle (`waiting`) main
 *  to `running_background` while a forked sub-agent is still running.
 *
 *  A `/fork`'s launch lands in the transcript ONLY as a `system`/`local_command`
 *  echo (never a `tool_result`), so it is invisible to
 *  `outstandingBackgroundTasks`. These cover the filesystem-based detection that
 *  replaces it: enumerate `subagents/agent-<id>.meta.json` tagged
 *  `agentType:"fork"`, drop the finished (`completed`) and the orphaned (stale
 *  transcript mtime), and keep the live ones. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completedBackgroundTaskIds } from "./core.ts";

describe("completedBackgroundTaskIds", () => {
  /** A `queue-operation` enqueue carrying a `<task-notification>`. */
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

describe("outstandingForkRuns / nextForkStaleDeadline", () => {
  let tmpDir: string;
  let outstandingForkRuns: typeof import("./index.ts").outstandingForkRuns;
  let nextForkStaleDeadline: typeof import("./index.ts").nextForkStaleDeadline;
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
    nextForkStaleDeadline = mod.nextForkStaleDeadline;
    subagentsDirFor = mod.subagentsDirFor;
    staleMs = mod.FORK_TRANSCRIPT_STALE_MS;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const subagentsDir = () => subagentsDirFor(session);

  /** Write a sub-agent's `agent-<id>.meta.json` + streaming `agent-<id>.jsonl`.
   *  `agentType` controls the discriminator (`"fork"` for a real fork);
   *  `ageMs > 0` back-dates the transcript mtime to model an orphaned run;
   *  `withTranscript: false` writes only the meta (transcript never created). */
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
    writeAgent("arun-full-ci", {}); // meta = { name, description }, no agentType
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
    // Only the well-formed fork (meta + transcript) surfaces; the bare dir and
    // the transcript-without-meta are skipped without error.
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

  describe("nextForkStaleDeadline", () => {
    it("returns the transcript mtime plus the stale window for a live fork", () => {
      const anchorMs = 1_000_000;
      expect(nextForkStaleDeadline([{ id: "f1", anchorMs }], 0)).toBe(
        anchorMs + staleMs,
      );
    });

    it("clamps an already-stale fork's deadline to `now` (fire immediately)", () => {
      const now = 10_000_000;
      const anchorMs = now - staleMs - 60_000;
      expect(nextForkStaleDeadline([{ id: "f1", anchorMs }], now)).toBe(now);
    });

    it("returns the earliest deadline across multiple forks", () => {
      const now = 0;
      expect(
        nextForkStaleDeadline(
          [
            { id: "old", anchorMs: 1_000 },
            { id: "new", anchorMs: 9_000 },
          ],
          now,
        ),
      ).toBe(1_000 + staleMs);
    });

    it("returns null for an empty fork set", () => {
      expect(nextForkStaleDeadline([], 0)).toBeNull();
    });
  });
});

/** End-to-end through `createSessionWatcher`: drives the user-visible eventing
 *  path (the published `ClaudeCodeInfo.state`), not just the helper scan. Proves
 *  the F1 fix — the `subagents/` watcher re-runs the fork scan when the fork's
 *  artifacts land AFTER the main transcript already went idle — and that a
 *  completion notification on the main transcript demotes the row again.
 *
 *  Uses real `fs.watch` + real timers (the watcher's actual machinery), so each
 *  assertion polls for the expected published state rather than reading a single
 *  synchronous snapshot. `KOLU_CLAUDE_PROJECTS_DIR` is set, which both redirects
 *  the on-disk lookups into the tmp tree AND disables the SDK summary fetch. */
describe("createSessionWatcher — /fork lifecycle (eventing path)", () => {
  let tmpDir: string;
  let createSessionWatcher: typeof import("./index.ts").createSessionWatcher;
  let subagentsDirFor: typeof import("./index.ts").subagentsDirFor;
  let encodeProjectPath: typeof import("./index.ts").encodeProjectPath;
  const sessionId = "fork-watcher-session";
  const cwd = "/home/user/fork-watcher-project";
  const session = { pid: 1, sessionId, cwd };

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
    const mod = await import("./index.ts");
    createSessionWatcher = mod.createSessionWatcher;
    subagentsDirFor = mod.subagentsDirFor;
    encodeProjectPath = mod.encodeProjectPath;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const projectDir = () => path.join(tmpDir, encodeProjectPath(cwd));
  const transcriptPath = () => path.join(projectDir(), `${sessionId}.jsonl`);

  /** Append a JSONL entry to the main transcript (each transcript write is what
   *  fires the file watcher in production). */
  function appendTranscript(entry: object): void {
    fs.appendFileSync(transcriptPath(), `${JSON.stringify(entry)}\n`);
  }

  /** An assistant `end_turn` — the main session is idle (`waiting`). */
  const endTurn = () => ({
    type: "assistant",
    message: { stop_reason: "end_turn", model: "claude-opus-4-8" },
  });

  /** A `queue-operation` enqueue carrying a terminal `<task-notification>` for
   *  `taskId` — the fork's completion signal on the MAIN transcript. */
  const completion = (taskId: string) => ({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n</task-notification>`,
  });

  /** Write a live `/fork` sub-agent's `agent-<id>.meta.json` + streaming
   *  `agent-<id>.jsonl` into `subagents/` (fresh mtime → still running). */
  function writeForkAgent(id: string): void {
    const dir = subagentsDirFor(session);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `agent-${id}.meta.json`),
      JSON.stringify({ agentType: "fork", name: id, description: id }),
    );
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), "{}\n");
  }

  /** Poll `read()` until it equals `want` or the deadline passes. Returns the
   *  last observed value so a failed expect prints the actual state. */
  async function waitForState(
    read: () => string | null,
    want: string,
    timeoutMs = 3000,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (read() === want) return want;
      await new Promise((r) => setTimeout(r, 25));
    }
    return read();
  }

  it("promotes a waiting main to running_background when fork artifacts land late, then demotes on completion", async () => {
    fs.mkdirSync(projectDir(), { recursive: true });
    // Main is idle BEFORE any fork exists: the watcher's first derivation reads
    // `waiting`, and the fork scan finds nothing (artifacts don't exist yet).
    fs.writeFileSync(transcriptPath(), `${JSON.stringify(endTurn())}\n`);

    // Collect every emission rather than a single mutable — reading the tail
    // keeps the union type (a mutated-in-callback local narrows to `never`).
    const emitted: import("./index.ts").ClaudeCodeInfo[] = [];
    const watcher = createSessionWatcher(
      session,
      (info) => emitted.push(info),
      noopLog,
    );
    try {
      const latest = () => emitted.at(-1) ?? null;
      const state = () => latest()?.state ?? null;

      // Initial derivation: idle, no fork.
      expect(await waitForState(state, "waiting")).toBe("waiting");
      expect(latest()?.workflow ?? null).toBeNull();

      // The fork's artifacts appear AFTER the main already went quiet — the F1
      // race. Only the `subagents/` watcher can re-trigger the scan here; the
      // main transcript fires no further event. The row must promote.
      writeForkAgent("aimplement-it-late");
      expect(await waitForState(state, "running_background")).toBe(
        "running_background",
      );
      // A fork promotes the state but carries no fan-out journal.
      expect(latest()?.workflow ?? null).toBeNull();

      // The fork reports completion on the MAIN transcript. The completed-id
      // signal drops it from the live set on the next scan → demote to waiting.
      appendTranscript(completion("aimplement-it-late"));
      expect(await waitForState(state, "waiting")).toBe("waiting");
    } finally {
      watcher.destroy();
    }
  });
});
