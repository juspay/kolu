import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  deriveSessionState,
  parseMessageState,
  runningToolsBucket,
} from "./core.ts";

/** A Logger whose four methods are vi spies — lets a test assert which
 *  level fired and with what message/context. */
function spyLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Minimal `message` schema OpenCode writes — enough for `deriveSessionState`
 *  to pick the latest row by `time_created`. */
const MESSAGE_SCHEMA = `
CREATE TABLE message (id TEXT, session_id TEXT NOT NULL, data TEXT NOT NULL, time_created INTEGER);
`;

function withMessages(
  rows: Array<{ id: string; data: string; time_created: number }>,
): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(MESSAGE_SCHEMA);
  for (const r of rows) {
    db.prepare(
      "INSERT INTO message (id, session_id, data, time_created) VALUES (?, ?, ?, ?)",
    ).run(r.id, "s1", r.data, r.time_created);
  }
  return db;
}

const NO_MESSAGES_MSG = "no messages yet for opencode session";
const PARSE_FAILED_MSG = "opencode message.data parse failed";

/** Minimal `part` schema OpenCode writes — enough for `runningToolsBucket`
 *  to do its single index scan. The fixture builder in `packages/tests`
 *  uses the same shape; we inline it here so the unit test stays
 *  package-local. */
const PART_SCHEMA = `
CREATE TABLE part (id TEXT, message_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX part_message_id_id_idx ON part(message_id, id);
`;

function withParts(
  rows: Array<{ tool: string | null; status: string }>,
): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(PART_SCHEMA);
  rows.forEach((row, i) => {
    db.prepare("INSERT INTO part (id, message_id, data) VALUES (?, ?, ?)").run(
      `p${i}`,
      "m1",
      JSON.stringify({
        type: "tool",
        ...(row.tool !== null && { tool: row.tool }),
        state: { status: row.status },
      }),
    );
  });
  return db;
}

describe("parseMessageState", () => {
  it("returns thinking for a user message", () => {
    const data = JSON.stringify({
      role: "user",
      time: { created: 1775861127582 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "thinking",
      model: null,
    });
  });

  it("returns waiting for a completed assistant message with finish=stop", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "glm-latest",
      providerID: "litellm",
      finish: "stop",
      time: { created: 1775861127596, completed: 1775861130376 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "waiting",
      model: "litellm/glm-latest",
    });
  });

  it("returns thinking for an assistant message without time.completed", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "glm-latest",
      providerID: "litellm",
      time: { created: 1775861127596 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "thinking",
      model: "litellm/glm-latest",
    });
  });

  it("returns thinking for assistant with non-stop finish reason", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "claude-sonnet-4-5",
      providerID: "anthropic",
      finish: "tool-calls",
      time: { created: 1, completed: 2 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "thinking",
      model: "anthropic/claude-sonnet-4-5",
    });
  });

  it("falls back to modelID alone if providerID is missing", () => {
    const data = JSON.stringify({
      role: "assistant",
      modelID: "glm-latest",
      finish: "stop",
      time: { created: 1, completed: 2 },
    });
    expect(parseMessageState(data)).toEqual({
      state: "waiting",
      model: "glm-latest",
    });
  });

  it("returns null for unknown role", () => {
    expect(parseMessageState(JSON.stringify({ role: "system" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseMessageState("not json")).toBeNull();
  });

  it("logs an error (not silence) for malformed JSON, tagged with sessionId", () => {
    const log = spyLog();
    expect(parseMessageState("not json", log, "s1")).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1" }),
      PARSE_FAILED_MSG,
    );
  });

  it("stays silent for valid JSON with an unmodelled role", () => {
    // A parseable blob is not an anomaly worth an error — only malformed
    // JSON is. This guards the error path from firing on schema we simply
    // don't map to a state.
    const log = spyLog();
    expect(
      parseMessageState(JSON.stringify({ role: "system" }), log),
    ).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("deriveSessionState", () => {
  it("logs 'no messages yet' at debug for a genuinely empty session", () => {
    const log = spyLog();
    expect(deriveSessionState("s1", log, withMessages([]))).toBeNull();
    expect(log.debug).toHaveBeenCalledWith(expect.anything(), NO_MESSAGES_MSG);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs a parse error — never 'no messages yet' — for a malformed latest row", () => {
    const log = spyLog();
    const db = withMessages([{ id: "m1", data: "not json", time_created: 1 }]);
    expect(deriveSessionState("s1", log, db)).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1" }),
      PARSE_FAILED_MSG,
    );
    expect(log.debug).not.toHaveBeenCalledWith(
      expect.anything(),
      NO_MESSAGES_MSG,
    );
  });

  it("derives state from the latest message by time_created", () => {
    const db = withMessages([
      { id: "m0", data: JSON.stringify({ role: "user" }), time_created: 1 },
      {
        id: "m1",
        data: JSON.stringify({
          role: "assistant",
          finish: "stop",
          time: { created: 2, completed: 3 },
        }),
        time_created: 2,
      },
    ]);
    expect(deriveSessionState("s1", undefined, db)).toEqual({
      state: "waiting",
      model: null,
      messageId: "m1",
    });
  });
});

describe("runningToolsBucket", () => {
  it("returns null when no parts are running", () => {
    const db = withParts([]);
    expect(runningToolsBucket("m1", undefined, db)).toBeNull();
  });

  it("returns tool_use for a running shell tool", () => {
    const db = withParts([{ tool: "shell", status: "running" }]);
    expect(runningToolsBucket("m1", undefined, db)).toBe("tool_use");
  });

  it.each([
    "question",
    "plan_exit",
  ])("returns awaiting_user when the only running tool is %s", (toolName) => {
    const db = withParts([{ tool: toolName, status: "running" }]);
    expect(runningToolsBucket("m1", undefined, db)).toBe("awaiting_user");
  });

  it("returns awaiting_user when every running tool is some awaiting-user tool", () => {
    const db = withParts([
      { tool: "question", status: "running" },
      { tool: "plan_exit", status: "running" },
    ]);
    expect(runningToolsBucket("m1", undefined, db)).toBe("awaiting_user");
  });

  it("returns tool_use when question runs alongside another tool", () => {
    const db = withParts([
      { tool: "question", status: "running" },
      { tool: "shell", status: "running" },
    ]);
    expect(runningToolsBucket("m1", undefined, db)).toBe("tool_use");
  });

  it("ignores completed parts even when the only running one is a question", () => {
    const db = withParts([
      { tool: "shell", status: "completed" },
      { tool: "question", status: "running" },
    ]);
    expect(runningToolsBucket("m1", undefined, db)).toBe("awaiting_user");
  });

  it("returns tool_use for legacy parts with no tool field", () => {
    // Existing fixtures (and OpenCode versions that predated the tool
    // field) write parts without `$.tool`. Those must keep counting as
    // real work — the conservative bucket — not be promoted to
    // awaiting_user just because they aren't named `question`.
    const db = withParts([{ tool: null, status: "running" }]);
    expect(runningToolsBucket("m1", undefined, db)).toBe("tool_use");
  });
});
