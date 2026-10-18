import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  type ContentPart,
  deriveSessionState,
  findSessionsByDirectory,
  getLatestAssistantFacts,
  parseMessageState,
  runningToolsBucket,
} from "./core.ts";

/** A Logger whose four methods are vi spies — lets a test assert which
 *  level fired and with what message/context. */
function spyLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** The OpenCode 2.x tables kolu reads — the columns it touches, with the
 *  upstream index names, as measured on a v2.0.29 database. The e2e fixture
 *  builder in `packages/tests` writes the same shape; it is inlined here so
 *  the unit test stays package-local. */
const V2_SCHEMA = `
CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT NOT NULL, title TEXT, revert TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER);
CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);
CREATE INDEX session_message_session_type_seq_idx ON session_message (session_id, type, seq);
CREATE INDEX session_message_session_time_created_id_idx ON session_message (session_id, time_created, id);
`;

interface Row {
  type: string;
  data: unknown;
  /** Defaults to the row's seq — set it to disagree with seq. */
  time_created?: number;
}

/** One session `s1` (in `/repo`) holding `rows` in seq order. `data` is
 *  JSON-encoded unless it is already a string (to plant a malformed blob). */
function withSession(
  rows: Row[],
  session: { revert?: unknown } = {},
): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(V2_SCHEMA);
  db.prepare(
    "INSERT INTO session_v2 (id, directory, title, revert, time_created, time_updated) VALUES ('s1', '/repo', 'A title', ?, 1, 1)",
  ).run(session.revert === undefined ? null : JSON.stringify(session.revert));
  rows.forEach((r, seq) => {
    const t = r.time_created ?? seq;
    db.prepare(
      "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, 's1', ?, ?, ?, ?, ?)",
    ).run(
      `m${seq}`,
      r.type,
      seq,
      t,
      t,
      typeof r.data === "string" ? r.data : JSON.stringify(r.data),
    );
  });
  return db;
}

const usage = (input: number, cacheRead = 0) => ({
  input,
  output: 10,
  reasoning: 5,
  cache: { read: cacheRead, write: 1 },
});

const NO_MESSAGES_MSG = "no messages yet for opencode session";
const PARSE_FAILED_MSG = "opencode message.data parse failed";

describe("parseMessageState", () => {
  it("returns thinking for a user message", () => {
    const data = JSON.stringify({
      time: { created: 1775861127582 },
      text: "hello",
    });
    expect(parseMessageState("user", data)).toEqual({ state: "thinking" });
  });

  it("returns waiting for a completed assistant message with finish=stop", () => {
    const data = JSON.stringify({
      model: { id: "glm-latest", providerID: "litellm" },
      finish: "stop",
      time: { created: 1775861127596, completed: 1775861130376 },
      content: [{ type: "text", text: "Done." }],
    });
    expect(parseMessageState("assistant", data)).toEqual({ state: "waiting" });
  });

  it("returns thinking for an assistant message without time.completed", () => {
    const data = JSON.stringify({
      model: { id: "glm-latest", providerID: "litellm" },
      time: { created: 1775861127596 },
      content: [{ type: "reasoning", text: "hmm" }],
    });
    expect(parseMessageState("assistant", data)).toEqual({ state: "thinking" });
  });

  it("returns thinking for assistant with non-stop finish reason", () => {
    const data = JSON.stringify({
      model: { id: "claude-sonnet-4-5", providerID: "anthropic" },
      finish: "tool-calls",
      time: { created: 1, completed: 2 },
    });
    expect(parseMessageState("assistant", data)).toEqual({ state: "thinking" });
  });

  it("refines an in-flight assistant by its running tool parts", () => {
    const data = JSON.stringify({
      time: { created: 1 },
      content: [
        { type: "tool", id: "c1", name: "shell", state: { status: "running" } },
      ],
    });
    expect(parseMessageState("assistant", data)).toEqual({ state: "tool_use" });
  });

  it("returns null for a message type we don't model", () => {
    expect(
      parseMessageState("system", JSON.stringify({ text: "x" })),
    ).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseMessageState("assistant", "not json")).toBeNull();
  });

  it("logs an error (not silence) for malformed JSON, tagged with sessionId", () => {
    const log = spyLog();
    expect(parseMessageState("assistant", "not json", log, "s1")).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1" }),
      PARSE_FAILED_MSG,
    );
  });

  it("stays silent for valid JSON with an unmodelled type", () => {
    // A parseable blob is not an anomaly worth an error — only malformed
    // JSON is. This guards the error path from firing on rows we simply
    // don't map to a state.
    const log = spyLog();
    expect(
      parseMessageState("system", JSON.stringify({ text: "x" }), log),
    ).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("deriveSessionState", () => {
  it("logs 'no messages yet' at debug for a genuinely empty session", () => {
    const log = spyLog();
    expect(deriveSessionState("s1", log, withSession([]))).toBeNull();
    expect(log.debug).toHaveBeenCalledWith(expect.anything(), NO_MESSAGES_MSG);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs a parse error — never 'no messages yet' — for a malformed latest row", () => {
    const log = spyLog();
    const db = withSession([{ type: "assistant", data: "not json" }]);
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

  it("derives state from the highest seq, not the latest time_created", () => {
    const db = withSession([
      { type: "user", data: { text: "go" }, time_created: 50 },
      {
        type: "assistant",
        data: { finish: "stop", time: { created: 2, completed: 3 } },
        time_created: 2,
      },
    ]);
    expect(deriveSessionState("s1", undefined, db)).toEqual({
      state: "waiting",
    });
  });

  it("looks past system / synthetic / idle rows to the latest turn", () => {
    // A settled 2.x session often ends on a non-conversational row (a
    // tool-rename notice, a turn-end marker) — picking that as "the latest
    // message" would leave a live session with no state at all.
    const db = withSession([
      { type: "user", data: { text: "go" } },
      {
        type: "assistant",
        data: { finish: "stop", time: { created: 1, completed: 2 } },
      },
      { type: "idle", data: { outcome: "succeeded" } },
      { type: "system", data: { text: "The available tools have changed." } },
    ]);
    expect(deriveSessionState("s1", undefined, db)).toEqual({
      state: "waiting",
    });
  });

  it("reports awaiting_user while a question tool is running", () => {
    const db = withSession([
      { type: "user", data: { text: "set it up" } },
      {
        type: "assistant",
        data: {
          time: { created: 1 },
          content: [
            {
              type: "tool",
              id: "c1",
              name: "question",
              state: { status: "running", input: { questions: [] } },
            },
          ],
        },
      },
    ]);
    expect(deriveSessionState("s1", undefined, db)).toEqual({
      state: "awaiting_user",
    });
  });
});

describe("findSessionsByDirectory", () => {
  it("detects a session_v2 row, with its first message as startedAt", () => {
    const db = withSession([
      { type: "user", data: { text: "hi" }, time_created: 700 },
      { type: "assistant", data: {}, time_created: 800 },
    ]);
    expect(findSessionsByDirectory("/repo", undefined, db)).toEqual([
      { id: "s1", title: "A title", directory: "/repo", startedAt: 700 },
    ]);
  });

  it("omits archived sessions and orders the rest newest first", () => {
    const db = withSession([]);
    db.exec(`
      INSERT INTO session_v2 (id, directory, title, time_created, time_updated) VALUES ('s2', '/repo', NULL, 1, 5);
      INSERT INTO session_v2 (id, directory, title, time_created, time_updated, time_archived) VALUES ('s3', '/repo', 'gone', 1, 9, 9);
    `);
    expect(
      findSessionsByDirectory("/repo", undefined, db)?.map((s) => s.id),
    ).toEqual(["s2", "s1"]);
  });

  it("fails loud on a pre-2.0 database — null and an error, never an empty list", () => {
    // `null` is "could not read the store"; `[]` would claim "no sessions
    // here" and release the terminal's match.
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE session (id TEXT, directory TEXT, time_updated INTEGER, time_archived INTEGER)",
    );
    const log = spyLog();
    expect(findSessionsByDirectory("/repo", log, db)).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.anything(),
      "opencode session query failed",
    );
  });
});

describe("getLatestAssistantFacts", () => {
  it("keeps the latest assistant's model and tokens when a newer user prompt starts the next turn", () => {
    // The regression this guards: both facts used to be read off the single
    // newest message, so a user prompt as the newest row blanked the
    // published model and token count for that whole window.
    const db = withSession([
      {
        type: "assistant",
        data: {
          model: { id: "glm-latest", providerID: "litellm" },
          tokens: usage(1_000),
        },
      },
      {
        type: "assistant",
        data: {
          model: { id: "claude-opus-4-6", providerID: "anthropic" },
          tokens: usage(3_000, 20_000),
        },
      },
      { type: "user", data: { text: "next" } },
    ]);

    expect(getLatestAssistantFacts("s1", undefined, db)).toEqual({
      model: "anthropic/claude-opus-4-6",
      // input + output + reasoning + cache.read + cache.write — the TUI's sum.
      contextTokens: 3_000 + 10 + 5 + 20_000 + 1,
    });
  });

  it("holds the previous step's count while the newest assistant is still streaming", () => {
    const db = withSession([
      {
        type: "assistant",
        data: { model: { id: "m1", providerID: "p" }, tokens: usage(100) },
      },
      { type: "assistant", data: { model: { id: "m2", providerID: "p" } } },
    ]);
    expect(getLatestAssistantFacts("s1", undefined, db)).toEqual({
      model: "p/m2",
      contextTokens: 116,
    });
  });

  it("counts nothing from before the last completed compaction", () => {
    const db = withSession([
      { type: "assistant", data: { tokens: usage(100) } },
      { type: "compaction", data: { status: "completed", summary: "…" } },
      { type: "user", data: { text: "continue" } },
    ]);
    expect(getLatestAssistantFacts("s1", undefined, db)?.contextTokens).toBe(
      null,
    );
  });

  it("counts nothing at or after the session's revert boundary", () => {
    const db = withSession(
      [
        { type: "assistant", data: { tokens: usage(100) } },
        { type: "user", data: { text: "undo me" } },
        { type: "assistant", data: { tokens: usage(900) } },
      ],
      { revert: { messageID: "m1" } },
    );
    expect(getLatestAssistantFacts("s1", undefined, db)?.contextTokens).toBe(
      116,
    );
  });

  it("counts nothing when the revert boundary names no message", () => {
    // Upstream's `lastAssistantWithUsage` returns undefined for a boundary it
    // cannot find — the TUI then shows no context usage at all.
    const db = withSession(
      [{ type: "assistant", data: { tokens: usage(100) } }],
      {
        revert: { messageID: "gone" },
      },
    );
    expect(getLatestAssistantFacts("s1", undefined, db)?.contextTokens).toBe(
      null,
    );
  });

  it("falls back to the model id alone if providerID is missing", () => {
    const db = withSession([
      { type: "assistant", data: { model: { id: "glm-latest" } } },
    ]);
    expect(getLatestAssistantFacts("s1", undefined, db)).toEqual({
      model: "glm-latest",
      contextTokens: null,
    });
  });

  it("returns null before the first assistant message", () => {
    const db = withSession([{ type: "user", data: { text: "hi" } }]);
    expect(getLatestAssistantFacts("s1", undefined, db)).toBeNull();
  });
});

describe("runningToolsBucket", () => {
  const tool = (name: string, status: string): ContentPart => ({
    type: "tool",
    name,
    state: { status },
  });

  it("returns null when no parts are running", () => {
    expect(runningToolsBucket([])).toBeNull();
    expect(runningToolsBucket(undefined)).toBeNull();
  });

  it("returns tool_use for a running shell tool", () => {
    expect(runningToolsBucket([tool("shell", "running")])).toBe("tool_use");
  });

  it("returns awaiting_user when the only running tool is question", () => {
    expect(runningToolsBucket([tool("question", "running")])).toBe(
      "awaiting_user",
    );
  });

  it("returns awaiting_user when every running tool is a question", () => {
    expect(
      runningToolsBucket([
        tool("question", "running"),
        tool("question", "running"),
      ]),
    ).toBe("awaiting_user");
  });

  it("returns tool_use when question runs alongside another tool", () => {
    expect(
      runningToolsBucket([
        tool("question", "running"),
        tool("shell", "running"),
      ]),
    ).toBe("tool_use");
  });

  it("ignores completed parts and non-tool parts", () => {
    expect(
      runningToolsBucket([
        { type: "reasoning" },
        tool("shell", "completed"),
        tool("question", "running"),
      ]),
    ).toBe("awaiting_user");
  });
});
