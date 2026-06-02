import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deriveState,
  deriveTaskProgress,
  encodeProjectPath,
  extractTasks,
  INTERRUPT_TEXT_PREFIX,
  INTERRUPT_TOOL_RESULT_PREFIX,
  outstandingBackgroundTasks,
  tailJsonlLines,
  watchOrWaitForDir,
} from "./core.ts";

// --- Shared fixtures for dynamic-workflow background-task entries ---

/** A `user` `tool_result` confirming a background launch. Omit `runId` to
 *  model a plain background `Task`/`Agent` (no workflow journal). */
function bgLaunch(taskId: string, runId?: string): string {
  const runLine = runId ? `\nRun ID: ${runId}` : "";
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `tu-${taskId}`,
          content: `Workflow launched in background. Task ID: ${taskId}\nTranscript dir: /x/subagents/workflows/${runId ?? "none"}${runLine}`,
        },
      ],
    },
  });
}

/** A `user` `tool_result` confirming a backgrounded `Bash` command. The id is
 *  followed by punctuation, matching the real "… with ID: <id>. Output …". */
function bashLaunch(id: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `tu-${id}`,
          content: `Command running in background with ID: ${id}. Output is being written to: /tmp/${id}.output.`,
        },
      ],
    },
  });
}

/** A `user` `tool_result` confirming a backgrounded `Agent`. */
function agentLaunch(id: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `tu-${id}`,
          content: `Async agent launched successfully.\nagentId: ${id} (internal ID — do not mention to user.)`,
        },
      ],
    },
  });
}

/** A `queue-operation` enqueue carrying a terminal task-notification. */
function bgComplete(taskId: string, status = "completed"): string {
  return JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`,
  });
}

const endTurn = JSON.stringify({
  type: "assistant",
  message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
});

describe("deriveState", () => {
  it("returns null for empty lines", () => {
    expect(deriveState([])).toBeNull();
  });

  it.each([
    { stop_reason: "end_turn", expected: "waiting" },
    { stop_reason: "tool_use", expected: "tool_use" },
    { stop_reason: null, expected: "thinking" },
  ])("assistant with stop_reason=$stop_reason → $expected", ({
    stop_reason,
    expected,
  }) => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason, model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: expected,
      model: "claude-opus-4-6",
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("returns awaiting_user when the only pending tool is AskUserQuestion", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        model: "claude-opus-4-7",
        content: [
          { type: "text", text: "Need a decision before I proceed." },
          { type: "tool_use", name: "AskUserQuestion", id: "tu_1" },
        ],
      },
    });
    expect(deriveState([line])).toEqual({
      state: "awaiting_user",
      model: "claude-opus-4-7",
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("returns awaiting_user when ExitPlanMode is the only pending tool", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        model: "claude-opus-4-7",
        content: [{ type: "tool_use", name: "ExitPlanMode", id: "tu_1" }],
      },
    });
    expect(deriveState([line])).toMatchObject({ state: "awaiting_user" });
  });

  it("stays tool_use when AskUserQuestion is mixed with a real tool call", () => {
    // Mixed batch: the human-input prompt is real, but so is the Read —
    // there's compute in flight, so "Running tools" is honest.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        model: "claude-opus-4-7",
        content: [
          { type: "tool_use", name: "AskUserQuestion", id: "tu_1" },
          { type: "tool_use", name: "Read", id: "tu_2" },
        ],
      },
    });
    expect(deriveState([line])).toMatchObject({ state: "tool_use" });
  });

  it("falls back to tool_use when content is missing on a tool_use stop", () => {
    // Synthetic transcripts (e.g. `claude -c` replays) may omit content;
    // we can't tell what's pending so treat it as the conservative case.
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "tool_use", model: "claude-opus-4-7" },
    });
    expect(deriveState([line])).toMatchObject({ state: "tool_use" });
  });

  it("returns thinking for assistant with missing stop_reason", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: "claude-opus-4-6",
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("returns thinking for user message", () => {
    const line = JSON.stringify({ type: "user" });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: null,
      timestampMs: null,
    });
  });

  // Interrupt-marker fixtures composed from the same constants the
  // implementation matches against — so a change to the marker policy in
  // core.ts moves these in lockstep instead of silently decoupling.
  const MID_TURN_MARKER = `${INTERRUPT_TEXT_PREFIX}]`;
  const TOOL_CALL_MARKER = `${INTERRUPT_TEXT_PREFIX} for tool use]`;
  const TOOL_RESULT_MARKER = `${INTERRUPT_TOOL_RESULT_PREFIX}. The tool use was rejected.`;

  it("returns waiting when the newest user entry is a mid-turn interrupt marker", () => {
    // Esc mid-turn appends `user [text: "[Request interrupted by user]"]`.
    // The agent is idle awaiting the next prompt, not thinking.
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: MID_TURN_MARKER }] },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: null,
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("returns waiting for an interrupt marker carried as a plain string", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: TOOL_CALL_MARKER },
    });
    expect(deriveState([line])).toMatchObject({ state: "waiting" });
  });

  it("returns waiting when interrupted during a tool call", () => {
    // Esc mid-tool-call appends an errored tool_result then the text marker.
    // The text marker is newest; either alone settles the dock to idle.
    const toolResult = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", is_error: true, content: TOOL_RESULT_MARKER },
        ],
      },
    });
    const textMarker = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: TOOL_CALL_MARKER }] },
    });
    expect(deriveState([toolResult, textMarker])).toMatchObject({
      state: "waiting",
    });
    // The errored tool_result on its own is also an interrupt signal.
    expect(deriveState([toolResult])).toMatchObject({ state: "waiting" });
  });

  it("returns thinking when a real prompt follows an interrupt marker", () => {
    // The `ralph` shape: after the marker the user types again; that newest
    // user entry is a genuine prompt → thinking, as before.
    const marker = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: MID_TURN_MARKER }] },
    });
    const prompt = JSON.stringify({
      type: "user",
      message: { content: "n/m. run ci" },
    });
    expect(deriveState([marker, prompt])).toMatchObject({ state: "thinking" });
  });

  it("uses last relevant message (walks backwards)", () => {
    const user = JSON.stringify({ type: "user" });
    const assistant = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
    });
    expect(deriveState([user, assistant])).toEqual({
      state: "waiting",
      model: "claude-opus-4-6",
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("skips non-user/assistant types", () => {
    const system = JSON.stringify({ type: "system" });
    const user = JSON.stringify({ type: "user" });
    expect(deriveState([user, system])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("sums input + cache_creation + cache_read from assistant usage", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 6,
          cache_creation_input_tokens: 810,
          cache_read_input_tokens: 28663,
          output_tokens: 380,
        },
      },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: "claude-opus-4-7",
      contextTokens: 29479,
      timestampMs: null,
    });
  });

  it("keeps last-assistant contextTokens sticky when user entry is newest", () => {
    // Thinking state: user just submitted a prompt, so `user` is newer than
    // the previous assistant's reply. State should come from the user entry
    // (thinking), but contextTokens must be preserved from the prior turn's
    // usage — otherwise the token count blanks out mid-conversation.
    const assistant = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 29_000,
        },
      },
    });
    const user = JSON.stringify({ type: "user" });
    expect(deriveState([assistant, user])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: 29_105,
      timestampMs: null,
    });
  });

  it("returns null contextTokens when usage has no input-side fields", () => {
    // `claude -c` session restore can write synthetic assistant entries
    // whose `usage` block lacks all three input-side counters (only
    // `output_tokens`, or fully empty). Treat that as absent telemetry so
    // the UI hides the badge — rendering 0K would flash during restore
    // before the first real API reply lands.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        model: "claude-opus-4-7",
        usage: { output_tokens: 0 },
      },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: "claude-opus-4-7",
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("tolerates missing usage fields (treats absent as zero)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: { cache_read_input_tokens: 27871 },
      },
    });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: "claude-opus-4-7",
      contextTokens: 27871,
      timestampMs: null,
    });
  });

  it("skips malformed JSON lines", () => {
    const valid = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
    });
    expect(deriveState(["not json", valid])).toEqual({
      state: "waiting",
      model: "claude-opus-4-6",
      contextTokens: null,
      timestampMs: null,
    });
  });

  it("returns null when only malformed lines", () => {
    expect(deriveState(["bad", "also bad"])).toBeNull();
  });

  it("returns model null when assistant message has no model", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn" },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: null,
      contextTokens: null,
      timestampMs: null,
    });
  });

  // --- Dynamic-workflow: running_background promotion ---

  it("promotes end_turn to running_background when a launched task is outstanding", () => {
    // The agent yielded its turn (end_turn) but a background workflow it
    // launched has no completion yet — it is busy-waiting, not awaiting user.
    expect(deriveState([bgLaunch("t1", "wf_1"), endTurn])).toMatchObject({
      state: "running_background",
    });
  });

  it("does not promote a backgrounded Bash command (no observable journal)", () => {
    // A detached Bash command (runId null) leaves only a permanent launch
    // marker — its completion notification can be lost forever to a restart, so
    // promoting on it spins the pill indefinitely. Only an observable
    // `Workflow` run (with a journal) is enough to read as working.
    expect(deriveState([bashLaunch("b9ezdjva9"), endTurn])).toMatchObject({
      state: "waiting",
    });
  });

  it("does not promote a plain background Task/Agent (runId null)", () => {
    expect(deriveState([bgLaunch("t1"), endTurn])).toMatchObject({
      state: "waiting",
    });
  });

  it("stays waiting once the outstanding task reports a terminal status", () => {
    expect(
      deriveState([bgLaunch("t1", "wf_1"), bgComplete("t1"), endTurn]),
    ).toMatchObject({ state: "waiting" });
  });

  it("stays waiting on end_turn with no background task", () => {
    expect(deriveState([endTurn])).toMatchObject({ state: "waiting" });
  });

  it("does not promote a tool_use turn even with an outstanding task", () => {
    // tool_use already reads as working; only the bare end_turn was the
    // misclassified case.
    const toolUse = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "tool_use", model: "claude-opus-4-6" },
    });
    expect(deriveState([bgLaunch("t1", "wf_1"), toolUse])).toMatchObject({
      state: "tool_use",
    });
  });

  it("honors a precomputed outstanding set passed by the caller", () => {
    expect(
      deriveState([endTurn], [{ taskId: "t1", runId: "wf_1" }]),
    ).toMatchObject({ state: "running_background" });
  });

  it("does not promote a precomputed set whose only task lacks a runId", () => {
    expect(
      deriveState([endTurn], [{ taskId: "t1", runId: null }]),
    ).toMatchObject({ state: "waiting" });
  });

  it("ignores unknown/new entry types and reads state from the assistant turn", () => {
    // Entry types introduced alongside dynamic workflows must not crash the
    // parser or shift classification.
    const noise = [
      JSON.stringify({ type: "mode", mode: "normal" }),
      JSON.stringify({ type: "permission-mode", permissionMode: "default" }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "hi" }),
      JSON.stringify({ type: "attachment" }),
      JSON.stringify({ type: "file-history-snapshot" }),
    ];
    expect(deriveState([...noise, endTurn, ...noise])).toMatchObject({
      state: "waiting",
      model: "claude-opus-4-6",
    });
  });
});

describe("outstandingBackgroundTasks", () => {
  it("captures task ID and workflow run ID from a launch confirmation", () => {
    expect(outstandingBackgroundTasks([bgLaunch("t1", "wf_1")])).toEqual([
      { taskId: "t1", runId: "wf_1" },
    ]);
  });

  it("reports runId null for a plain background task (no Run ID line)", () => {
    expect(outstandingBackgroundTasks([bgLaunch("t1")])).toEqual([
      { taskId: "t1", runId: null },
    ]);
  });

  it("drops a task once a terminal-status notification arrives", () => {
    expect(
      outstandingBackgroundTasks([bgLaunch("t1", "wf_1"), bgComplete("t1")]),
    ).toEqual([]);
  });

  it.each([
    "failed",
    "stopped",
    "killed",
  ])("treats %s as a terminal status", (status) => {
    expect(
      outstandingBackgroundTasks([
        bgLaunch("t1", "wf_1"),
        bgComplete("t1", status),
      ]),
    ).toEqual([]);
  });

  it("detects a backgrounded Bash launch (runId null), trailing period excluded", () => {
    // The id is followed by ". Output …"; the period must not be captured or
    // it wouldn't match the completion's <task-id>.
    expect(outstandingBackgroundTasks([bashLaunch("b9ezdjva9")])).toEqual([
      { taskId: "b9ezdjva9", runId: null },
    ]);
    expect(
      outstandingBackgroundTasks([
        bashLaunch("b9ezdjva9"),
        bgComplete("b9ezdjva9"),
      ]),
    ).toEqual([]);
  });

  it("detects a backgrounded Agent launch (runId null)", () => {
    const id = "a6be52c77dea34cba";
    expect(outstandingBackgroundTasks([agentLaunch(id)])).toEqual([
      { taskId: id, runId: null },
    ]);
    expect(
      outstandingBackgroundTasks([agentLaunch(id), bgComplete(id, "killed")]),
    ).toEqual([]);
  });

  it("does not match a templated/quoted marker in pasted text", () => {
    // A tool_result echoing source code shouldn't mint a phantom task.
    const pasted = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-paste",
            content:
              "content: `Workflow launched in background. Task ID: ${taskId}`",
          },
        ],
      },
    });
    expect(outstandingBackgroundTasks([pasted])).toEqual([]);
  });

  it("keeps a task outstanding when the notification is non-terminal", () => {
    expect(
      outstandingBackgroundTasks([
        bgLaunch("t1", "wf_1"),
        bgComplete("t1", "running"),
      ]),
    ).toEqual([{ taskId: "t1", runId: "wf_1" }]);
  });

  it("ignores queue-operation dequeue entries", () => {
    const dequeue = JSON.stringify({
      type: "queue-operation",
      operation: "dequeue",
    });
    expect(
      outstandingBackgroundTasks([bgLaunch("t1", "wf_1"), dequeue]),
    ).toEqual([{ taskId: "t1", runId: "wf_1" }]);
  });

  it("tracks multiple tasks independently", () => {
    expect(
      outstandingBackgroundTasks([
        bgLaunch("t1", "wf_1"),
        bgLaunch("t2", "wf_2"),
        bgComplete("t1"),
      ]),
    ).toEqual([{ taskId: "t2", runId: "wf_2" }]);
  });

  it("reads launch markers from array-form tool_result content", () => {
    // tool_result.content can be a string or an array of text blocks; the
    // marker must be found in both forms.
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu",
            content: [
              {
                type: "text",
                text: "Workflow launched in background. Task ID: t9\nRun ID: wf_9",
              },
            ],
          },
        ],
      },
    });
    expect(outstandingBackgroundTasks([line])).toEqual([
      { taskId: "t9", runId: "wf_9" },
    ]);
  });
});

describe("liveOutstandingTasks", () => {
  let tmpDir: string;
  let live: typeof import("./index.ts").liveOutstandingTasks;
  let nextDeadline: typeof import("./index.ts").nextWorkflowStaleDeadline;
  let staleMs: number;
  const sessionId = "live-test-session";
  const cwd = "/home/user/live-project";
  const session = { pid: 1, sessionId, cwd };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-live-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    live = mod.liveOutstandingTasks;
    nextDeadline = mod.nextWorkflowStaleDeadline;
    staleMs = mod.WORKFLOW_JOURNAL_STALE_MS;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const wfDir = () =>
    path.join(tmpDir, encodeProjectPath(cwd), sessionId, "workflows");

  /** Write a workflow journal; `ageMs > 0` back-dates its mtime. */
  function writeJournal(runId: string, status: string, ageMs = 0): void {
    fs.mkdirSync(wfDir(), { recursive: true });
    const p = path.join(wfDir(), `${runId}.json`);
    fs.writeFileSync(
      p,
      JSON.stringify({ workflowName: "wf", status, agentCount: 3 }),
    );
    if (ageMs > 0) {
      const t = new Date(Date.now() - ageMs);
      fs.utimesSync(p, t, t);
    }
  }

  // #1123: live run dir is `<session>/subagents/workflows/<runId>/` — the
  // runtime writes `journal.jsonl` (one `started` event per sub-agent) plus
  // streaming `agent-*.jsonl` here during the run; the `workflows/<runId>.json`
  // snapshot only appears at completion.
  const liveDir = (runId: string) =>
    path.join(
      tmpDir,
      encodeProjectPath(cwd),
      sessionId,
      "subagents",
      "workflows",
      runId,
    );

  /** Write a live workflow run dir with `agents` `started` events in
   *  journal.jsonl and one streaming agent file; `ageMs > 0` back-dates both
   *  file mtimes (the liveness anchor is the newest file mtime in the dir). */
  function writeLiveJournal(runId: string, agents: number, ageMs = 0): void {
    const d = liveDir(runId);
    fs.mkdirSync(d, { recursive: true });
    const lines = Array.from({ length: agents }, (_, i) =>
      JSON.stringify({ type: "started", agentId: `a${i}` }),
    ).join("\n");
    const jp = path.join(d, "journal.jsonl");
    const ap = path.join(d, "agent-a0.jsonl");
    fs.writeFileSync(jp, lines);
    fs.writeFileSync(ap, "{}");
    if (ageMs > 0) {
      const t = new Date(Date.now() - ageMs);
      fs.utimesSync(jp, t, t);
      fs.utimesSync(ap, t, t);
    }
  }

  const wf = (runId: string) => ({ taskId: `t-${runId}`, runId });

  it("keeps a workflow with a fresh, running journal", () => {
    writeJournal("wf_live", "running");
    expect(live(session, [wf("wf_live")])).toEqual([wf("wf_live")]);
  });

  it("drops a workflow whose journal reports a terminal status", () => {
    writeJournal("wf_done", "completed");
    expect(live(session, [wf("wf_done")])).toEqual([]);
  });

  it("drops a workflow whose journal has gone stale (orphaned by a restart)", () => {
    writeJournal("wf_stale", "running", staleMs + 60_000);
    expect(live(session, [wf("wf_stale")])).toEqual([]);
  });

  it("keeps a LIVE workflow read from subagents/workflows/<runId>/ (the #1123 layout)", () => {
    // No completion snapshot yet — progress lives only in the live run dir. The
    // gate must observe it there and keep the run promoted.
    writeLiveJournal("wf_live2", 3);
    expect(live(session, [wf("wf_live2")])).toEqual([wf("wf_live2")]);
  });

  it("#1123 regression: keeps a live workflow even with NO completion snapshot, anchored on the live run dir", () => {
    // Pre-fix, with no `<session>/workflows/<runId>.json` the gate fell back to
    // the (launch-stamped, never-bumped) `workflows/` dir mtime and demoted at
    // launch+window mid-run. Now the anchor is the live run dir's streaming
    // files, so a fresh live run stays promoted regardless of the snapshot path.
    writeLiveJournal("wf_nosnap", 2);
    const anchor = fs.statSync(
      path.join(liveDir("wf_nosnap"), "agent-a0.jsonl"),
    ).mtimeMs;
    expect(live(session, [wf("wf_nosnap")], anchor + staleMs - 1)).toEqual([
      wf("wf_nosnap"),
    ]);
    expect(live(session, [wf("wf_nosnap")], anchor + staleMs + 1)).toEqual([]);
  });

  it("drops a live workflow whose run-dir files have gone stale (orphaned)", () => {
    writeLiveJournal("wf_livestale", 3, staleMs + 60_000);
    expect(live(session, [wf("wf_livestale")])).toEqual([]);
  });

  it("demotes an unobservable workflow immediately, at any `now` (phantom guard)", () => {
    // The phantom `running_background` bug: a launch marker carrying a `Run ID`
    // whose progress kolu can never read must NOT promote forever. With neither
    // a completion snapshot (`workflows/<runId>.json`) nor a live run dir
    // (`subagents/workflows/<runId>/`), there is no observable anchor, so the
    // gate demotes on the spot — independent of the injected clock. The empty
    // `workflows/` dir (a bare launch marker) carries no anchor of its own.
    fs.mkdirSync(wfDir(), { recursive: true });
    expect(live(session, [wf("wf_phantom")], 0)).toEqual([]);
    expect(live(session, [wf("wf_phantom")], Date.now())).toEqual([]);
    expect(live(session, [wf("wf_phantom")], Number.MAX_SAFE_INTEGER)).toEqual(
      [],
    );
  });

  it("drops a journal-less workflow when the workflows dir is absent (no anchor at all)", () => {
    // A fresh module with no projects dir written yet: neither the journal nor
    // its directory is stat-able, so there is no observable liveness anchor and
    // nothing can justify an indefinite spinner — demote.
    const fresh = {
      pid: 9,
      sessionId: "no-dir-session",
      cwd: "/home/user/no-dir-project",
    };
    expect(live(fresh, [wf("wf_nodir")])).toEqual([]);
  });

  it("passes non-workflow tasks (runId null) through unchanged", () => {
    const bash = { taskId: "b1", runId: null };
    expect(live(session, [bash])).toEqual([bash]);
  });

  it("filters a mixed set to live workflows plus all non-workflows", () => {
    writeJournal("wf_a", "running");
    writeJournal("wf_b", "completed");
    const bash = { taskId: "b1", runId: null };
    expect(live(session, [wf("wf_a"), wf("wf_b"), bash])).toEqual([
      wf("wf_a"),
      bash,
    ]);
  });

  it("uses the injected `now` for the staleness boundary", () => {
    writeJournal("wf_now", "running");
    const { mtimeMs } = fs.statSync(path.join(wfDir(), "wf_now.json"));
    expect(live(session, [wf("wf_now")], mtimeMs + staleMs - 1)).toEqual([
      wf("wf_now"),
    ]);
    expect(live(session, [wf("wf_now")], mtimeMs + staleMs + 1)).toEqual([]);
  });

  describe("nextWorkflowStaleDeadline", () => {
    it("returns the journal mtime plus the stale window for a live workflow", () => {
      writeJournal("wf_d1", "running");
      const { mtimeMs } = fs.statSync(path.join(wfDir(), "wf_d1.json"));
      expect(nextDeadline(session, [wf("wf_d1")])).toBe(mtimeMs + staleMs);
    });

    it("clamps an already-stale journal's deadline to `now` (fire immediately)", () => {
      writeJournal("wf_d2", "running", staleMs + 60_000);
      const now = Date.now();
      expect(nextDeadline(session, [wf("wf_d2")], now)).toBe(now);
    });

    it("returns the earliest deadline across multiple workflows", () => {
      writeJournal("wf_old", "running", 90_000); // ages out sooner
      writeJournal("wf_new", "running");
      const oldMtime = fs.statSync(path.join(wfDir(), "wf_old.json")).mtimeMs;
      expect(nextDeadline(session, [wf("wf_old"), wf("wf_new")])).toBe(
        oldMtime + staleMs,
      );
    });

    it("anchors the deadline on the live run dir's newest file mtime (no snapshot)", () => {
      writeLiveJournal("wf_dlive", 2);
      const anchor = fs.statSync(
        path.join(liveDir("wf_dlive"), "agent-a0.jsonl"),
      ).mtimeMs;
      expect(nextDeadline(session, [wf("wf_dlive")])).toBe(anchor + staleMs);
    });

    it("returns null when nothing observable anchors the run (gate has already demoted it)", () => {
      // No workflows dir at all → no anchor → no deadline; the gate drops the
      // task in the same pass, so there is nothing left to age out.
      const fresh = {
        pid: 9,
        sessionId: "no-dir-deadline-session",
        cwd: "/home/user/no-dir-deadline-project",
      };
      expect(nextDeadline(fresh, [wf("wf_absent")])).toBeNull();
      expect(nextDeadline(session, [{ taskId: "b1", runId: null }])).toBeNull();
    });
  });
});

describe("encodeProjectPath", () => {
  it.each([
    { input: "/home/user/project.name", expected: "-home-user-project-name" },
    { input: "/", expected: "-" },
    { input: "simple", expected: "simple" },
  ])("encodeProjectPath($input) → $expected", ({ input, expected }) => {
    expect(encodeProjectPath(input)).toBe(expected);
  });
});

describe("tailJsonlLines", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tail-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads all lines from a small file", () => {
    const filePath = path.join(tmpDir, "small.jsonl");
    const lines = [
      JSON.stringify({ type: "user" }),
      JSON.stringify({
        type: "assistant",
        message: { stop_reason: "end_turn" },
      }),
    ];
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
    const result = tailJsonlLines(filePath, 16_384);
    expect(result).toEqual(lines);
  });

  it("skips partial first line when reading from middle of file", () => {
    const filePath = path.join(tmpDir, "large.jsonl");
    const longLine = JSON.stringify({ type: "system", data: "x".repeat(200) });
    const lastLine = JSON.stringify({ type: "user" });
    fs.writeFileSync(filePath, `${longLine}\n${lastLine}\n`);
    const result = tailJsonlLines(filePath, 50);
    expect(result).toEqual([lastLine]);
  });

  it("returns empty array for nonexistent file", () => {
    expect(tailJsonlLines(path.join(tmpDir, "nope.jsonl"), 1024)).toEqual([]);
  });

  it("returns empty array for empty file", () => {
    const filePath = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(filePath, "");
    expect(tailJsonlLines(filePath, 1024)).toEqual([]);
  });

  it("handles file with no trailing newline", () => {
    const filePath = path.join(tmpDir, "no-newline.jsonl");
    const line = JSON.stringify({ type: "user" });
    fs.writeFileSync(filePath, line);
    const result = tailJsonlLines(filePath, 16_384);
    expect(result).toEqual([line]);
  });
});

describe("findTranscriptPath", () => {
  let tmpDir: string;
  let findTranscriptPathFn: typeof import("./index.ts").findTranscriptPath;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-find-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    findTranscriptPathFn = mod.findTranscriptPath;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns exact match by session ID", () => {
    const cwd = "/home/user/myproject";
    const sessionId = "test-session-123";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(transcriptPath, `${JSON.stringify({ type: "user" })}\n`);

    const result = findTranscriptPathFn({ pid: 1, sessionId, cwd });
    expect(result).toBe(transcriptPath);
  });

  it("returns null when session JSONL doesn't exist, ignoring other files in dir", () => {
    const cwd = "/home/user/multi-session-project";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });

    const otherPath = path.join(projectDir, "other-session.jsonl");
    fs.writeFileSync(otherPath, `${JSON.stringify({ type: "user" })}\n`);

    const result = findTranscriptPathFn({
      pid: 1,
      sessionId: "current-session-id",
      cwd,
    });
    expect(result).toBeNull();
  });

  it("returns null when project dir does not exist", () => {
    const result = findTranscriptPathFn({
      pid: 1,
      sessionId: "any",
      cwd: "/nonexistent/path",
    });
    expect(result).toBeNull();
  });
});

describe("extractTasks", () => {
  const mockLog = { error: vi.fn() };

  function taskCreateResult(id: string, subject: string): string {
    return JSON.stringify({
      type: "user",
      uuid: `u-${id}`,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [] },
      toolUseResult: { task: { id, subject } },
    });
  }

  function taskUpdate(taskId: string, status: string): string {
    return JSON.stringify({
      type: "assistant",
      uuid: `a-${taskId}-${status}`,
      timestamp: new Date().toISOString(),
      message: {
        model: "claude-opus-4-6",
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: `tool-${taskId}`,
            name: "TaskUpdate",
            input: { taskId, status },
          },
        ],
      },
    });
  }

  it("extracts tasks from TaskCreate results", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    const lines = [
      taskCreateResult("1", "Task one"),
      taskCreateResult("2", "Task two"),
    ];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(true);
    expect(tasks.size).toBe(2);
    expect(tasks.get("1")).toBe("pending");
    expect(tasks.get("2")).toBe("pending");
  });

  it("updates task status from TaskUpdate calls", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    tasks.set("1", "pending");
    const lines = [taskUpdate("1", "in_progress")];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(true);
    expect(tasks.get("1")).toBe("in_progress");
  });

  it("handles TaskUpdate with deleted status", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    tasks.set("1", "pending");
    const lines = [taskUpdate("1", "deleted")];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(true);
    expect(tasks.has("1")).toBe(false);
  });

  it("returns false when nothing changed", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    tasks.set("1", "completed");
    const lines = [taskUpdate("1", "completed")];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(false);
  });

  it("warns on unexpected TaskUpdate input shape", () => {
    mockLog.error.mockClear();
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "TaskUpdate", input: { bad: true } },
        ],
      },
    });
    extractTasks([line], tasks, mockLog);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it("ignores non-task tool calls", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
      },
    });
    const changed = extractTasks([line], tasks, mockLog);
    expect(changed).toBe(false);
    expect(tasks.size).toBe(0);
  });
});

describe("deriveTaskProgress", () => {
  it("returns null for empty map", () => {
    expect(deriveTaskProgress(new Map())).toBeNull();
  });

  it("returns correct counts", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">([
      ["1", "completed"],
      ["2", "in_progress"],
      ["3", "completed"],
      ["4", "pending"],
    ]);
    expect(deriveTaskProgress(tasks)).toEqual({ total: 4, completed: 2 });
  });
});

describe("deriveWorkflowProgress", () => {
  let tmpDir: string;
  let deriveWorkflowProgressFn: typeof import("./index.ts").deriveWorkflowProgress;
  const cwd = "/home/user/project";
  const sessionId = "sess-1";

  function writeJournal(runId: string, body: Record<string, unknown>): void {
    const dir = path.join(
      tmpDir,
      encodeProjectPath(cwd),
      sessionId,
      "workflows",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${runId}.json`), JSON.stringify(body));
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-wf-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    deriveWorkflowProgressFn = mod.deriveWorkflowProgress;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const session = () => ({ pid: 1, sessionId, cwd });

  it("reads name, status, and agent count from the run journal", () => {
    writeJournal("wf_run", {
      workflowName: "deep-research",
      status: "running",
      agentCount: 12,
    });
    expect(
      deriveWorkflowProgressFn(session(), [{ taskId: "t1", runId: "wf_run" }]),
    ).toEqual({ name: "deep-research", status: "running", agents: 12 });
  });

  it("reads the agent count from the LIVE run dir when no snapshot exists yet (#1123)", () => {
    // During a run there is no `workflows/<runId>.json`; progress lives in
    // `subagents/workflows/<runId>/journal.jsonl` (one `started` per sub-agent).
    const live = path.join(
      tmpDir,
      encodeProjectPath(cwd),
      sessionId,
      "subagents",
      "workflows",
      "wf_runlive",
    );
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(
      path.join(live, "journal.jsonl"),
      [0, 1, 2, 3]
        .map((i) => JSON.stringify({ type: "started", agentId: `a${i}` }))
        .join("\n"),
    );
    expect(
      deriveWorkflowProgressFn(session(), [
        { taskId: "t1", runId: "wf_runlive" },
      ]),
    ).toEqual({ name: "workflow", status: "running", agents: 4 });
  });

  it("derives the real workflow name from the persisted script during a live run (#1123)", () => {
    // A live run has no completion snapshot, but the launch-time script
    // `workflows/scripts/<name>-<runId>.js` carries the user-visible name — the
    // tile badge/inspector must show it, not a hard-coded "workflow".
    const live = path.join(
      tmpDir,
      encodeProjectPath(cwd),
      sessionId,
      "subagents",
      "workflows",
      "wf_named",
    );
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(
      path.join(live, "journal.jsonl"),
      JSON.stringify({ type: "started", agentId: "a0" }),
    );
    const scriptsDir = path.join(
      tmpDir,
      encodeProjectPath(cwd),
      sessionId,
      "workflows",
      "scripts",
    );
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, "deep-research-wf_named.js"),
      "// script body\n",
    );
    expect(
      deriveWorkflowProgressFn(session(), [
        { taskId: "t1", runId: "wf_named" },
      ]),
    ).toEqual({ name: "deep-research", status: "running", agents: 1 });
  });

  it("returns null for a task with no run ID (plain background task)", () => {
    expect(
      deriveWorkflowProgressFn(session(), [{ taskId: "t1", runId: null }]),
    ).toBeNull();
  });

  it("returns null when the journal file is missing", () => {
    expect(
      deriveWorkflowProgressFn(session(), [
        { taskId: "t1", runId: "wf_absent" },
      ]),
    ).toBeNull();
  });

  it("prefers a running journal over a completed one", () => {
    writeJournal("wf_done", {
      workflowName: "a",
      status: "completed",
      agentCount: 3,
    });
    writeJournal("wf_live", {
      workflowName: "b",
      status: "running",
      agentCount: 7,
    });
    expect(
      deriveWorkflowProgressFn(session(), [
        { taskId: "t1", runId: "wf_done" },
        { taskId: "t2", runId: "wf_live" },
      ]),
    ).toMatchObject({ name: "b", status: "running" });
  });
});

// #1123: the live workflow root sits two lazily-created levels below the
// session dir (`<session>/subagents/workflows/`). A single-level parent
// fallback can't attach when `subagents/` is also absent at setup time — the
// regression these tests pin.
describe("watchOrWaitForDir — deep, lazily-created targets", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-watch-test-"));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // fs.watch delivers asynchronously; give the event loop a beat to flush.
  const settle = () => new Promise((r) => setTimeout(r, 120));

  it("fires when neither intermediate dir exists at setup (fresh session)", async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, "fresh-"));
    // Target two levels deep; only `root` exists right now.
    const target = path.join(root, "subagents", "workflows");
    let changes = 0;
    const cleanup = watchOrWaitForDir(target, () => changes++, undefined, true);
    try {
      // Materialize both missing components together (mirrors the runtime
      // creating `subagents/workflows/` on the first Workflow launch).
      fs.mkdirSync(target, { recursive: true });
      await settle();
      // A nested per-run append should now re-derive (recursive watch).
      const runDir = path.join(target, "wf_1");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "journal.jsonl"), "{}\n");
      await settle();
      expect(changes).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("fires for a target one level deep created later", async () => {
    const root = fs.mkdtempSync(path.join(tmpDir, "one-"));
    const target = path.join(root, "workflows");
    let changes = 0;
    const cleanup = watchOrWaitForDir(target, () => changes++, undefined);
    try {
      fs.mkdirSync(target);
      await settle();
      fs.writeFileSync(path.join(target, "wf_1.json"), "{}");
      await settle();
      expect(changes).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});
