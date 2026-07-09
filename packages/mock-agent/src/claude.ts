/**
 * Claude Code artifacts, written by the mock-agent AS the agent (relocated from
 * the old test-side `claude_code_steps.ts` builders — `buildTranscript`,
 * `writeWorkflowJournal`, `writeForkSubagent`, `buildTaskLines`, the session
 * file — verbatim in shape).
 *
 * The one faithfulness win: the session file is keyed on THIS process's pid
 * (`process.pid`) and the mock-agent IS the terminal's foreground process, so
 * the provider's foreground-pid → `<sessions>/<pid>.json` lookup resolves the
 * SAME way it does for a real `claude`. The old mock used the shell's pid and
 * planted the file from outside.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { claudeProjectsDir, claudeSessionsDir } from "./paths.ts";
import type { AgentState, MockKind, StateOpts } from "./protocol.ts";

const SESSION_ID = "test-claude-session-00000000-0000-0000-0000";
const WORKFLOW_TASK_ID = "task-bg-0000";
const WORKFLOW_RUN_ID = "wf-test-run-0000";
const WORKFLOW_NAME = "deep-research";
const WORKFLOW_AGENTS = 5;
/** A `/fork` sub-agent id — the `agent-<id>` basename of its on-disk artifacts. */
const FORK_SUBAGENT_ID = "aimplement-it-test00000000000000";

function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

function buildTranscript(state: AgentState): string {
  const userMsg = JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  });
  const assistantMsg = (stopReason: string) =>
    JSON.stringify({
      type: "assistant",
      uuid: "a1",
      timestamp: new Date().toISOString(),
      message: {
        model: "claude-opus-4-6",
        role: "assistant",
        stop_reason: stopReason,
        content: [{ type: "text", text: "Done!" }],
      },
    });
  const interruptTextMsg = (uuid: string, text: string) =>
    JSON.stringify({
      type: "user",
      uuid,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text }] },
    });

  const lines = [userMsg];
  if (state === "tool_use") lines.push(assistantMsg("tool_use"));
  if (state === "waiting") lines.push(assistantMsg("end_turn"));
  if (state === "awaiting_user") {
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: new Date().toISOString(),
        message: {
          model: "claude-opus-4-6",
          role: "assistant",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu-ask",
              name: "AskUserQuestion",
              input: {},
            },
          ],
        },
      }),
    );
  }
  if (
    state === "running_background" ||
    state === "orphaned_workflow" ||
    state === "journalless_workflow"
  ) {
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-bg",
              content: `Workflow launched in background. Task ID: ${WORKFLOW_TASK_ID}\nRun ID: ${WORKFLOW_RUN_ID}`,
            },
          ],
        },
      }),
    );
    lines.push(assistantMsg("end_turn"));
  }
  if (state === "background_bash") {
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-bash",
              content:
                "Command running in background with ID: bg-bash-0000. Output is being written to: /tmp/bg-bash-0000.output.",
            },
          ],
        },
      }),
    );
    lines.push(assistantMsg("end_turn"));
  }
  if (state === "fork") {
    lines.push(assistantMsg("end_turn"));
    lines.push(
      JSON.stringify({
        type: "system",
        subtype: "local_command",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        content:
          "<local-command-stdout>⑂ forked implement-it (1483)</local-command-stdout>",
        level: "info",
      }),
    );
  }
  if (state === "interrupted") {
    lines.push(interruptTextMsg("u2", "[Request interrupted by user]"));
  }
  if (state === "interrupted_tool_use") {
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-int",
              is_error: true,
              content:
                "The user doesn't want to proceed with this tool use. The tool use was rejected.",
            },
          ],
        },
      }),
      interruptTextMsg("u3", "[Request interrupted by user for tool use]"),
    );
  }
  if (state === "compact") {
    lines.push(assistantMsg("end_turn"));
    const userArtifact = (uuid: string, content: string) =>
      JSON.stringify({
        type: "user",
        uuid,
        timestamp: new Date().toISOString(),
        message: { role: "user", content },
      });
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        isCompactSummary: true,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: "This session is being continued from a previous…",
        },
      }),
      userArtifact(
        "u3",
        "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>",
      ),
      userArtifact(
        "u4",
        "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>",
      ),
      userArtifact(
        "u5",
        "<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>",
      ),
    );
  }
  // "thinking" = user message only (no assistant response yet)
  return `${lines.join("\n")}\n`;
}

/** TaskCreate result + TaskUpdate lines appended for the task-progress scenario. */
function buildTaskLines(total: number, completed: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= total; i++) {
    const id = String(i);
    const status = i <= completed ? "completed" : "in_progress";
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: `task-create-${id}`,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              tool_use_id: `tool-${id}`,
              type: "tool_result",
              content: `Task #${id} created successfully: Task ${id}`,
            },
          ],
        },
        toolUseResult: { task: { id, subject: `Task ${id}` } },
      }),
    );
    // Every mock task is completed or in_progress (never pending), so a
    // TaskUpdate line always follows the create — the state the tile reads.
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: `task-update-${id}`,
        timestamp: new Date().toISOString(),
        message: {
          model: "claude-opus-4-6",
          role: "assistant",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: `tool-update-${id}`,
              name: "TaskUpdate",
              input: { taskId: id, status },
            },
          ],
        },
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

export class ClaudeAgent implements MockKind {
  private readonly sessionsDir = claudeSessionsDir();
  private readonly projectsDir = claudeProjectsDir();
  private readonly cwd = process.cwd();
  private readonly pid = process.pid;
  private readonly projectDir = join(this.projectsDir, encodeCwd(this.cwd));
  private readonly transcriptPath = join(
    this.projectDir,
    `${SESSION_ID}.jsonl`,
  );
  private readonly sessionFile = join(this.sessionsDir, `${this.pid}.json`);
  // Captured ONCE at construction, never per-transition. The adapter's
  // sessionKey is `sessionId:pid:startedAt` (agent-adapter.ts), so a fresh
  // `Date.now()` on every setState would change the key each transition and
  // tear-down + cold-re-resolve the transcript watcher — a churn neither the
  // real Claude nor the old mock produces (both stamp startedAt once). Pinning
  // it keeps ONE stable watcher; detection still fires via the transcript write.
  private readonly startedAt = Date.now();
  private removed = false;

  setState(state: AgentState, opts: StateOpts): void {
    // ORDER MATTERS — transcript + project dir BEFORE the session file. The
    // session file is the trigger: the server's SESSIONS_DIR watcher fires on
    // its creation and immediately reads the transcript. Data-then-trigger
    // removes the dependency on a second (droppable) fs.watch event.
    mkdirSync(this.projectDir, { recursive: true });
    writeFileSync(this.transcriptPath, buildTranscript(state));
    if (state === "running_background") this.writeWorkflowJournal({});
    if (state === "orphaned_workflow")
      this.writeWorkflowJournal({ stale: true });
    if (state === "fork") this.writeForkSubagent();
    if (opts.staleJsonl) this.writeStalePreviousSessionJsonl();
    if (opts.tasks)
      appendFileSync(
        this.transcriptPath,
        buildTaskLines(opts.tasks.total, opts.tasks.completed),
      );

    mkdirSync(this.sessionsDir, { recursive: true });
    writeFileSync(
      this.sessionFile,
      JSON.stringify({
        pid: this.pid,
        sessionId: SESSION_ID,
        cwd: this.cwd,
        startedAt: this.startedAt,
      }),
    );
  }

  private writeWorkflowJournal(opts: { stale?: boolean }): void {
    const wfDir = join(this.projectDir, SESSION_ID, "workflows");
    mkdirSync(wfDir, { recursive: true });
    const journalPath = join(wfDir, `${WORKFLOW_RUN_ID}.json`);
    writeFileSync(
      journalPath,
      JSON.stringify({
        workflowName: WORKFLOW_NAME,
        status: "running",
        agentCount: WORKFLOW_AGENTS,
      }),
    );
    if (opts.stale) {
      const old = new Date(Date.now() - 10 * 60 * 1000);
      utimesSync(journalPath, old, old);
    }
  }

  private writeForkSubagent(): void {
    const subagentsDir = join(this.projectDir, SESSION_ID, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, `agent-${FORK_SUBAGENT_ID}.meta.json`),
      JSON.stringify({
        agentType: "fork",
        description: "implement it!",
        name: "implement-it",
      }),
    );
    writeFileSync(
      join(subagentsDir, `agent-${FORK_SUBAGENT_ID}.jsonl`),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "go" } })}\n`,
    );
  }

  /** The MRU-regression guard: a previous-session JSONL with a FUTURE mtime, so
   *  an MRU fallback would wrongly prefer it over the current transcript. */
  private writeStalePreviousSessionJsonl(): void {
    const stalePath = join(this.projectDir, "stale-previous-session.jsonl");
    writeFileSync(
      stalePath,
      `${JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "previous" }],
        },
      })}\n`,
    );
    const future = new Date(Date.now() + 60_000);
    utimesSync(stalePath, future, future);
  }

  nudge(): void {
    if (this.removed) {
      // Post-removal: re-fire the SESSIONS_DIR watcher for a dropped DELETION
      // event (create+unlink a sentinel so the server re-scans and finds the
      // session gone — the old `nudgeSessionsDir`). Repeated on the timer so a
      // dropped delete can't leave the indicator wedged on stale state.
      if (!existsSync(this.sessionsDir)) return;
      const sentinel = join(this.sessionsDir, `.kolu-nudge-${this.pid}`);
      writeFileSync(sentinel, "");
      unlinkSync(sentinel);
      return;
    }
    // Live: re-touch the mock files so a dropped fs.watch APPEARANCE event can't
    // wedge detection (the old `nudgeFiles`). No-op before setState.
    const now = new Date();
    for (const f of [this.sessionFile, this.transcriptPath]) {
      if (existsSync(f)) utimesSync(f, now, now);
    }
  }

  remove(): void {
    // Delete the session file + transcript so the server re-reads and finds the
    // session gone (the "Claude Code session ends" clear). `nudge()` then keeps
    // re-firing the deletion signal while the bin's removal window runs.
    this.removed = true;
    if (existsSync(this.sessionFile)) unlinkSync(this.sessionFile);
    if (existsSync(this.transcriptPath)) unlinkSync(this.transcriptPath);
    if (existsSync(this.projectDir))
      rmSync(this.projectDir, { recursive: true });
    this.nudge();
  }
}
