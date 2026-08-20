/** Background sub-agent detection — the on-disk scan that promotes an idle
 *  (`waiting`) main to `running_background` while a background sub-agent — a
 *  `/fork` or a positively async-launched `Agent`/`Task` — is still running.
 *
 *  A `/fork`'s launch lands in the transcript ONLY as a `system`/
 *  `local_command` echo (never a `tool_result`), and an async `Agent`/`Task`
 *  confirmation carries no `Run ID:` (so `deriveState`'s runId-narrowing
 *  skips it) — neither reaches the promoted set through the transcript
 *  alone. These cover the filesystem-based detection that closes the gap:
 *  enumerate `subagents/agent-<id>.meta.json`, keep only the POSITIVELY
 *  background-class candidates (meta `agentType:"fork"` or an async-launch
 *  confirmation on the main transcript — a synchronous `Task`/`Explore`/
 *  skill sub-agent writes byte-identical artifacts and must NOT promote),
 *  drop the finished (`completed`) and the orphaned (stale transcript mtime),
 *  and keep the live ones. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asyncLaunchedAgentIds, completedBackgroundTaskIds } from "./core.ts";

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

describe("asyncLaunchedAgentIds", () => {
  /** A `user` entry whose `tool_result` block carries `text`. */
  const toolResultLine = (text: string) =>
    JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu-1", content: text }],
      },
    });

  it("matches the REAL confirmation shape — a parenthetical between the phrases", () => {
    // The actual tool-result text interposes a long parenthetical between
    // "successfully." and "agentId:" — the plain `\\s*` phrasing matched zero
    // real transcripts (#2171 review, F2). The fixture keeps the gap.
    const text =
      "Async agent launched successfully. (This agent is running in the background. " +
      "You can continue working or wait for its result. Use the TaskOutput tool " +
      "with the task_id to check on it later.)\n\nagentId: arun-full-ci\n\n" +
      "You can use TaskOutput to check progress.";
    expect(asyncLaunchedAgentIds([toolResultLine(text)])).toEqual(
      new Set(["arun-full-ci"]),
    );
  });

  it("still matches the gapless phrasing and collects distinct ids", () => {
    const lines = [
      toolResultLine("Async agent launched successfully. agentId: afirst-1"),
      toolResultLine(
        "Async agent launched successfully. (…)\nagentId: asecond-2",
      ),
    ];
    expect(asyncLaunchedAgentIds(lines)).toEqual(
      new Set(["afirst-1", "asecond-2"]),
    );
  });

  it("ignores non-user entries, non-tool_result blocks, and other launch phrasings", () => {
    const lines = [
      // A system echo of the phrase is NOT a launch confirmation.
      JSON.stringify({
        type: "system",
        subtype: "local_command",
        content:
          "<local-command-stdout>Async agent launched successfully. agentId: anot-real</local-command-stdout>",
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "launched?" }] },
      }),
      toolResultLine("Command running in background with ID: bg-bash-0000."),
      "not json",
    ];
    expect(asyncLaunchedAgentIds(lines).size).toBe(0);
  });
});

describe("outstandingSubagentRuns / nextStaleDeadline", () => {
  let tmpDir: string;
  let outstandingSubagentRuns: typeof import("./index.ts").outstandingSubagentRuns;
  let nextStaleDeadline: typeof import("./index.ts").nextStaleDeadline;
  let subagentsDirFor: typeof import("./index.ts").subagentsDirFor;
  let staleMs: number;
  const sessionId = "subagent-test-session";
  const cwd = "/home/user/subagent-project";
  const session = { pid: 1, sessionId, cwd };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-subagent-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    outstandingSubagentRuns = mod.outstandingSubagentRuns;
    nextStaleDeadline = mod.nextStaleDeadline;
    subagentsDirFor = mod.subagentsDirFor;
    staleMs = mod.SUBAGENT_TRANSCRIPT_STALE_MS;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const subagentsDir = () => subagentsDirFor(session);

  /** The main-transcript `user` `tool_result` confirming an async launch of
   *  `id` — the transcript-side half of the class discriminator. */
  const asyncLaunchLine = (id: string) =>
    JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: `Async agent launched successfully. (This agent is running in the background.)\nagentId: ${id}`,
          },
        ],
      },
    });

  /** Write a sub-agent's `agent-<id>.meta.json` + streaming `agent-<id>.jsonl`.
   *  `agentType` feeds the class discriminator (`"fork"` promotes on the meta
   *  alone; anything else needs the id in `asyncLaunched`); `ageMs > 0`
   *  back-dates the transcript mtime to model an orphaned run;
   *  `withTranscript: false` writes only the meta (transcript never
   *  created). */
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
  const NO_LINES: string[] = [];

  it("returns a live fork: agentType fork, fresh transcript, not completed", () => {
    writeAgent("aimplement-it-fresh", { agentType: "fork" });
    const runs = outstandingSubagentRuns(session, NO_LINES, NONE);
    expect(runs.map((f) => f.id)).toContain("aimplement-it-fresh");
    const run = runs.find((f) => f.id === "aimplement-it-fresh");
    expect(typeof run?.anchorMs).toBe("number");
    // A sub-agent projects to the shared `LiveRun` shape carrying its own window.
    expect(run?.staleMs).toBe(staleMs);
  });

  it("promotes an async Agent sub-agent (agentType absent) with a fresh transcript + async-launch confirmation", () => {
    writeAgent("arun-full-ci", {}); // meta = { name, description }, no agentType
    // No confirmation → not positively background-class → excluded…
    expect(
      outstandingSubagentRuns(session, NO_LINES, NONE).map((f) => f.id),
    ).not.toContain("arun-full-ci");
    // …with the launch confirmation on the main transcript → promoted.
    const runs = outstandingSubagentRuns(
      session,
      [asyncLaunchLine("arun-full-ci")],
      NONE,
    );
    expect(runs.map((f) => f.id)).toContain("arun-full-ci");
  });

  it("promotes an async Task sub-agent (agentType task) with an async-launch confirmation", () => {
    writeAgent("asome-task", { agentType: "task" });
    const runs = outstandingSubagentRuns(
      session,
      [asyncLaunchLine("asome-task")],
      NONE,
    );
    expect(runs.map((f) => f.id)).toContain("asome-task");
  });

  it("excludes a synchronously-launched sub-agent even with a fresh transcript (F1 phantom)", () => {
    // The negative case the promotion must never fire on: an ordinary sync
    // `Task`/`Explore`/skill sub-agent writes byte-identical artifacts, but
    // no async-launch confirmation for it exists on the main transcript — so
    // the idle main stays `waiting`, keeping the "your agent needs you"
    // alert alive (#2171 review, F1).
    writeAgent("asub-sync", { agentType: "general-purpose" });
    // Even a stray async confirmation for a DIFFERENT id changes nothing.
    const runs = outstandingSubagentRuns(
      session,
      [asyncLaunchLine("asome-other-agent")],
      NONE,
    );
    expect(runs.map((f) => f.id)).not.toContain("asub-sync");
  });

  it("excludes a sub-agent whose id is in the completed set (finished)", () => {
    writeAgent("asub-done", { agentType: "fork" });
    const runs = outstandingSubagentRuns(session, NO_LINES, new Set(["asub-done"]));
    expect(runs.map((f) => f.id)).not.toContain("asub-done");
  });

  it("excludes a sub-agent whose transcript has gone stale (orphaned)", () => {
    writeAgent("asub-stale", { agentType: "fork", ageMs: staleMs + 60_000 });
    const runs = outstandingSubagentRuns(session, NO_LINES, NONE);
    expect(runs.map((f) => f.id)).not.toContain("asub-stale");
  });

  it("excludes a sub-agent with no transcript (unobservable — phantom guard)", () => {
    writeAgent("asub-nojsonl", { agentType: "fork", withTranscript: false });
    const runs = outstandingSubagentRuns(session, NO_LINES, NONE);
    expect(runs.map((f) => f.id)).not.toContain("asub-nojsonl");
  });

  it("excludes a streaming transcript with no meta file even with positive async evidence", () => {
    const dir = subagentsDir();
    fs.mkdirSync(dir, { recursive: true });
    // The transcript exists and the main transcript positively launched this
    // id — but without its `agent-<id>.meta.json` sibling the id is never
    // enumerated, so the phantom guard holds from the enumeration side too.
    fs.writeFileSync(path.join(dir, "agent-anometa.jsonl"), "{}\n");
    const runs = outstandingSubagentRuns(
      session,
      [asyncLaunchLine("anometa")],
      NONE,
    );
    expect(runs.map((f) => f.id)).not.toContain("anometa");
  });

  it("excludes a malformed meta with no async evidence; promotes it with positive async evidence", () => {
    // A malformed meta cannot be positively classified as a fork, so on its
    // own it must NOT promote (unclassifiable → conservative exclusion).
    writeAgent("asub-badmeta", { metaRaw: "{ not json" });
    expect(
      outstandingSubagentRuns(session, NO_LINES, NONE).map((f) => f.id),
    ).not.toContain("asub-badmeta");
    // The async-launch confirmation is independent positive evidence of the
    // background class — the meta's parseability is not consulted for it.
    const runs = outstandingSubagentRuns(
      session,
      [asyncLaunchLine("asub-badmeta")],
      NONE,
    );
    expect(runs.map((f) => f.id)).toContain("asub-badmeta");
  });

  it("returns [] when the subagents dir is absent (no throw)", () => {
    const fresh = {
      pid: 9,
      sessionId: "no-subagents-session",
      cwd: "/home/user/no-subagents-project",
    };
    expect(outstandingSubagentRuns(fresh, NO_LINES, NONE)).toEqual([]);
  });

  it("ignores the workflows/ subdir (real nested shape) and stray non-meta entries", () => {
    writeAgent("asub-ok", { agentType: "fork" });
    // The REAL workflows tree shape: `workflows/wf_<run>/agent-<id>.meta.json`
    // + streaming transcripts, tagged `agentType:"workflow-subagent"`. The
    // scan is a flat readdir, so these nested agents are never enumerated —
    // this pins that a future recursive scan can't silently flood the live
    // set.
    const wfDir = path.join(subagentsDir(), "workflows", "wf_x");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "agent-awf-fanout.meta.json"),
      JSON.stringify({ agentType: "workflow-subagent", name: "wf" }),
    );
    fs.writeFileSync(path.join(wfDir, "agent-awf-fanout.jsonl"), "{}\n");
    fs.writeFileSync(path.join(subagentsDir(), "agent-stray.jsonl"), "{}\n");
    const runs = outstandingSubagentRuns(
      session,
      [asyncLaunchLine("awf-fanout")], // even with positive async evidence
      NONE,
    );
    expect(runs.map((f) => f.id)).toContain("asub-ok");
    expect(runs.map((f) => f.id)).not.toContain("awf-fanout");
  });

  it("uses the injected `now` for the staleness boundary", () => {
    writeAgent("asub-now", { agentType: "fork" });
    const anchor = fs.statSync(
      path.join(subagentsDir(), "agent-asub-now.jsonl"),
    ).mtimeMs;
    expect(
      outstandingSubagentRuns(session, NO_LINES, NONE, anchor + staleMs - 1).map(
        (f) => f.id,
      ),
    ).toContain("asub-now");
    expect(
      outstandingSubagentRuns(session, NO_LINES, NONE, anchor + staleMs + 1).map(
        (f) => f.id,
      ),
    ).not.toContain("asub-now");
  });

  // The sub-agent stale deadline folds through the shared `nextStaleDeadline`
  // receptacle: each run projects to a `LiveRun` carrying
  // `SUBAGENT_TRANSCRIPT_STALE_MS`.
  describe("nextStaleDeadline (sub-agent runs)", () => {
    const run = (id: string, anchorMs: number) => ({
      id,
      anchorMs,
      staleMs,
    });

    it("returns the transcript mtime plus the stale window for a live sub-agent", () => {
      const anchorMs = 1_000_000;
      expect(nextStaleDeadline([run("s1", anchorMs)], 0)).toBe(
        anchorMs + staleMs,
      );
    });

    it("clamps an already-stale sub-agent's deadline to `now` (fire immediately)", () => {
      const now = 10_000_000;
      const anchorMs = now - staleMs - 60_000;
      expect(nextStaleDeadline([run("s1", anchorMs)], now)).toBe(now);
    });

    it("returns the earliest deadline across multiple sub-agents", () => {
      const now = 0;
      expect(
        nextStaleDeadline([run("old", 1_000), run("new", 9_000)], now),
      ).toBe(1_000 + staleMs);
    });

    it("returns null for an empty run set", () => {
      expect(nextStaleDeadline([], 0)).toBeNull();
    });
  });
});

/** End-to-end through `createSessionWatcher`: drives the user-visible eventing
 *  path (the published `ClaudeCodeInfo.state`), not just the helper scan. The
 *  transcript subscription callback is captured and driven under Vitest's fake
 *  clock; the IO package separately owns real `fs.watch` + append-floor coverage.
 *  This test therefore proves the watcher wiring and derivation without making
 *  correctness depend on an OS edge or host scheduling latency. */
describe("createSessionWatcher — background sub-agent lifecycle (eventing path)", () => {
  let tmpDir: string;
  let createSessionWatcher: typeof import("./index.ts").createSessionWatcher;
  let subagentsDirFor: typeof import("./index.ts").subagentsDirFor;
  let encodeProjectPath: typeof import("./index.ts").encodeProjectPath;
  const sessionId = "subagent-watcher-session";
  const cwd = "/home/user/subagent-watcher-project";
  const session = { pid: 1, sessionId, cwd };
  let transcriptChanged: (() => void) | null = null;

  const noopLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-subagent-watcher-"));
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

  /** Wipe the session's on-disk state (transcript + subagents) so each test
   *  starts from a clean slate — the tests below share one `session`, and a
   *  leftover sub-agent from an earlier test would otherwise promote the next
   *  test's initial (should-be-idle) read. */
  function resetSessionDirs(): void {
    fs.rmSync(projectDir(), { recursive: true, force: true });
  }

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

  /** A `user` `tool_result` confirming an async launch of `id` — the REAL
   *  shape, parenthetical included (see `asyncLaunchedAgentIds`). */
  const asyncLaunch = (id: string) => ({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu-async",
          content: `Async agent launched successfully. (This agent is running in the background.)\nagentId: ${id}`,
        },
      ],
    },
  });

  /** A `queue-operation` enqueue carrying a terminal `<task-notification>` for
   *  `taskId` — the sub-agent's completion signal on the MAIN transcript. */
  const completion = (taskId: string) => ({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n</task-notification>`,
  });

  /** Write a live sub-agent's `agent-<id>.meta.json` + streaming
   *  `agent-<id>.jsonl` into `subagents/` (fresh mtime → still running).
   *  `agentType` tags the class — `"fork"` promotes on the meta alone; any
   *  other/absent tag needs the id in the transcript's async-launched set. */
  function writeSubagentAgent(id: string, agentType?: string): void {
    const dir = subagentsDirFor(session);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `agent-${id}.meta.json`),
      JSON.stringify({
        ...(agentType ? { agentType } : {}),
        name: id,
        description: id,
      }),
    );
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), "{}\n");
  }

  it("promotes a waiting main to running_background when fork artifacts land late, then demotes on completion", async () => {
    vi.useFakeTimers();
    resetSessionDirs();
    fs.mkdirSync(projectDir(), { recursive: true });
    // Main is idle BEFORE any sub-agent exists: the watcher's first derivation
    // reads `waiting`, and the sub-agent scan finds nothing (artifacts don't
    // exist yet).
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

      // Initial derivation: idle, no sub-agent.
      expect(state()).toBe("waiting");
      expect(latest()?.workflow ?? null).toBeNull();

      // The fork's artifacts appear AFTER the main already went quiet (the F1
      // race). The synchronous subagents readdir finds the now-present fork and
      // promotes — no transcript append is even needed (the subagents-dir
      // watcher fires the check in production).
      writeSubagentAgent("aimplement-it-late", "fork");
      expect(transcriptChanged).not.toBeNull();
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      expect(state()).toBe("running_background");
      // A sub-agent promotes the state but carries no fan-out journal.
      expect(latest()?.workflow ?? null).toBeNull();

      // The sub-agent reports completion on the MAIN transcript. The
      // completed-id signal drops it from the live set on the next scan →
      // demote to waiting.
      appendTranscript(completion("aimplement-it-late"));
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      expect(state()).toBe("waiting");
    } finally {
      watcher.destroy();
      vi.useRealTimers();
    }
  });

  it("promotes a waiting main for an async Agent only once its launch confirmation is on the transcript", async () => {
    vi.useFakeTimers();
    resetSessionDirs();
    fs.mkdirSync(projectDir(), { recursive: true });
    // The tail BEFORE the async launch: an idle main with the sub-agent's
    // artifacts already on disk must NOT promote — the discriminator is the
    // launch confirmation, not the artifacts' presence.
    fs.writeFileSync(transcriptPath(), `${JSON.stringify(endTurn())}\n`);
    writeSubagentAgent("arun-full-ci"); // agentType absent

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
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      // No async-launch confirmation anywhere in the tail → no promotion: a
      // sub-agent that cannot be positively classified as background leaves
      // the idle main at `waiting` (the sync-subagent phantom, F1).
      expect(state()).toBe("waiting");

      // The async launch confirmation lands on the MAIN transcript (the real
      // shape: a `user` `tool_result`), then the main ends its turn. The id is
      // now positively async-launched → promote.
      appendTranscript(asyncLaunch("arun-full-ci"));
      appendTranscript(endTurn());
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      expect(state()).toBe("running_background");

      // Completion demotes, same as the fork path.
      appendTranscript(completion("arun-full-ci"));
      transcriptChanged?.();
      await vi.advanceTimersByTimeAsync(150);
      expect(state()).toBe("waiting");
    } finally {
      watcher.destroy();
      vi.useRealTimers();
    }
  });
});
