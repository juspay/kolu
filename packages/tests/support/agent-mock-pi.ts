import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

const SESSION_ID = "00000000-0000-7000-8000-0000000000ca";

function sessionDirNameAsPiWritesItOnDisk(cwd: string): string {
  return `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
}

export interface PiFixture {
  transcriptPath: string;
  sessionId: string;
}

function userEntry(id: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-23T15:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "mock prompt" }] },
  };
}

function assistantEntry(id: string, stopReason: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-23T15:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "mock reply" }],
      model: "mock-model-1",
      usage: {
        input: 1200,
        output: 42,
        cacheRead: 3400,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 4642,
      },
      stopReason,
    },
  };
}

function toolResultEntry(id: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-23T15:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: `bash:${id}`,
      toolName: "bash",
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
  };
}

function initialLines(state: AgentLifecycleState): object[] {
  const header = {
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: "2026-08-23T15:00:00.000Z",
    cwd: "/irrelevant",
  };
  switch (state) {
    case "thinking":
      return [header, userEntry("u1")];
    case "tool_use":
      return [header, userEntry("u1"), assistantEntry("a1", "toolUse")];
    case "waiting":
      return [
        header,
        userEntry("u1"),
        assistantEntry("a1", "toolUse"),
        toolResultEntry("r1"),
        assistantEntry("a2", "stop"),
      ];
    case "awaiting_user":
      throw new Error(
        "pi has no awaiting_user state — pi transcripts cannot express it",
      );
  }
}

function transitionLines(state: AgentLifecycleState, n: number): object[] {
  switch (state) {
    case "thinking":
      return [userEntry(`u${n}`)];
    case "tool_use":
      return [userEntry(`u${n}`), assistantEntry(`a${n}`, "toolUse")];
    case "waiting":
      return [toolResultEntry(`r${n}`), assistantEntry(`a${n}b`, "stop")];
    case "awaiting_user":
      throw new Error("pi has no awaiting_user state");
  }
}

export function writePiFixture(opts: {
  piDir: string;
  cwd: string;
  state: AgentLifecycleState;
}): PiFixture {
  const dir = path.join(
    opts.piDir,
    "sessions",
    sessionDirNameAsPiWritesItOnDisk(opts.cwd),
  );
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(
    dir,
    `2026-08-23T15-00-00-000Z_${SESSION_ID}.jsonl`,
  );
  fs.writeFileSync(
    transcriptPath,
    `${initialLines(opts.state)
      .map((l) => JSON.stringify(l))
      .join("\n")}\n`,
  );
  return { transcriptPath, sessionId: SESSION_ID };
}

let transitionCounter = 0;

export function updatePiFixture(
  fixture: PiFixture,
  state: AgentLifecycleState,
): void {
  transitionCounter += 1;
  const lines = transitionLines(state, transitionCounter);
  fs.appendFileSync(
    fixture.transcriptPath,
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}
