import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { parseMessageState, runningToolsBucket } from "./core.ts";

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

  it("returns awaiting_user when the only running tool is question", () => {
    const db = withParts([{ tool: "question", status: "running" }]);
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
