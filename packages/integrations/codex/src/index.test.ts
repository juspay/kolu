import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  missingThreadColumns,
  parseRolloutContextTokens,
  parseRolloutState,
  REQUIRED_THREAD_COLUMNS,
  uuidV7TimestampMs,
} from "./core.ts";

function tokenCount(input: number, cached: number): string {
  return JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
        },
      },
    },
  });
}

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function taskStarted(turnId: string): string {
  return line({
    type: "event_msg",
    payload: { type: "task_started", turn_id: turnId },
  });
}
function taskComplete(turnId: string): string {
  return line({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: turnId },
  });
}
function turnAborted(turnId: string, reason?: string): string {
  return line({
    type: "event_msg",
    payload: { type: "turn_aborted", turn_id: turnId, reason },
  });
}
function funcCall(callId: string, name = "shell"): string {
  return line({
    type: "response_item",
    payload: { type: "function_call", call_id: callId, name },
  });
}
function funcOutput(callId: string): string {
  return line({
    type: "response_item",
    payload: { type: "function_call_output", call_id: callId },
  });
}

describe("parseRolloutState", () => {
  it("returns null when no task events have fired", () => {
    const lines = [
      line({ type: "session_meta", payload: { id: "t1" } }),
      line({ type: "event_msg", payload: { type: "thread_name_updated" } }),
    ];
    expect(parseRolloutState(lines)).toBeNull();
  });

  it("returns thinking after task_started with no tool calls", () => {
    const lines = [
      line({ type: "session_meta", payload: { id: "t1" } }),
      taskStarted("turn-1"),
    ];
    expect(parseRolloutState(lines)).toBe("thinking");
  });

  it("returns tool_use when a function_call has no matching output", () => {
    const lines = [taskStarted("turn-1"), funcCall("call-A")];
    expect(parseRolloutState(lines)).toBe("tool_use");
  });

  it("returns thinking once all function_calls have outputs", () => {
    const lines = [
      taskStarted("turn-1"),
      funcCall("call-A"),
      funcOutput("call-A"),
    ];
    expect(parseRolloutState(lines)).toBe("thinking");
  });

  it("tracks multiple concurrent function_calls independently", () => {
    const lines = [
      taskStarted("turn-1"),
      funcCall("call-A"),
      funcCall("call-B"),
      funcOutput("call-A"),
    ];
    expect(parseRolloutState(lines)).toBe("tool_use");
  });

  it("returns waiting when latest task_started matches latest task_complete", () => {
    const lines = [
      taskStarted("turn-1"),
      funcCall("call-A"),
      funcOutput("call-A"),
      taskComplete("turn-1"),
    ];
    expect(parseRolloutState(lines)).toBe("waiting");
  });

  it.each([
    "interrupted",
    "other",
    undefined,
  ])("returns waiting after an aborted turn (reason: %s)", (reason) => {
    expect(
      parseRolloutState([taskStarted("turn-1"), turnAborted("turn-1", reason)]),
    ).toBe("waiting");
  });

  it.each([
    "shell",
    "request_user_input",
  ])("returns waiting after abort with an unfinished %s call", (name) => {
    expect(
      parseRolloutState([
        taskStarted("turn-1"),
        funcCall("call-A", name),
        turnAborted("turn-1"),
      ]),
    ).toBe("waiting");
  });

  it("returns thinking when a new turn follows an abort", () => {
    expect(
      parseRolloutState([
        taskStarted("turn-1"),
        funcCall("call-A"),
        turnAborted("turn-1"),
        taskStarted("turn-2"),
      ]),
    ).toBe("thinking");
  });

  it("returns waiting when the tail contains only an abort", () => {
    expect(parseRolloutState([turnAborted("turn-1")])).toBe("waiting");
  });

  it("ignores an abort without a turn_id", () => {
    expect(
      parseRolloutState([
        taskStarted("turn-1"),
        line({ type: "event_msg", payload: { type: "turn_aborted" } }),
      ]),
    ).toBe("thinking");
  });

  it("returns thinking after a new task_started follows a task_complete", () => {
    const lines = [
      taskStarted("turn-1"),
      taskComplete("turn-1"),
      taskStarted("turn-2"),
    ];
    expect(parseRolloutState(lines)).toBe("thinking");
  });

  it("returns tool_use when a new turn is in flight with an open call", () => {
    const lines = [
      taskStarted("turn-1"),
      taskComplete("turn-1"),
      taskStarted("turn-2"),
      funcCall("call-B"),
    ];
    expect(parseRolloutState(lines)).toBe("tool_use");
  });

  it("skips malformed JSON lines without aborting", () => {
    const lines = [
      "not json",
      taskStarted("turn-1"),
      "{bad",
      funcCall("call-A"),
    ];
    expect(parseRolloutState(lines)).toBe("tool_use");
  });

  it("ignores event_msg with missing turn_id", () => {
    const lines = [
      line({ type: "event_msg", payload: { type: "task_started" } }),
    ];
    expect(parseRolloutState(lines)).toBeNull();
  });

  it.each([
    "request_user_input",
    "request_permissions",
    "request_plugin_install",
  ])("returns awaiting_user when the only open call is %s", (toolName) => {
    const lines = [taskStarted("turn-1"), funcCall("call-A", toolName)];
    expect(parseRolloutState(lines)).toBe("awaiting_user");
  });

  it("returns awaiting_user when every open call is some awaiting-user tool", () => {
    const lines = [
      taskStarted("turn-1"),
      funcCall("call-A", "request_user_input"),
      funcCall("call-B", "request_permissions"),
    ];
    expect(parseRolloutState(lines)).toBe("awaiting_user");
  });

  it("stays tool_use when request_user_input runs alongside another tool", () => {
    const lines = [
      taskStarted("turn-1"),
      funcCall("call-A", "request_user_input"),
      funcCall("call-B", "shell"),
    ];
    expect(parseRolloutState(lines)).toBe("tool_use");
  });

  it("returns waiting when tail kept task_complete but chopped the start", () => {
    const lines = [taskComplete("turn-A")];
    expect(parseRolloutState(lines)).toBe("waiting");
  });

  it("discards an orphan function_call from a prior turn when the next turn starts", () => {
    const lines = [
      taskStarted("turn-1"),
      funcCall("call-A"),
      taskComplete("turn-1"),
      taskStarted("turn-2"),
    ];
    expect(parseRolloutState(lines)).toBe("thinking");
  });

  it("discards an orphan function_call even when the tail began mid-prior-turn", () => {
    const lines = [
      funcCall("call-A"),
      taskComplete("turn-1"),
      taskStarted("turn-2"),
    ];
    expect(parseRolloutState(lines)).toBe("thinking");
  });

  it("scopes openCalls to the new turn — prior-turn orphans don't prevent tool_use detection", () => {
    const lines = [
      funcCall("call-A"),
      taskComplete("turn-1"),
      taskStarted("turn-2"),
      funcCall("call-B"),
    ];
    expect(parseRolloutState(lines)).toBe("tool_use");
  });
});

describe("parseRolloutContextTokens", () => {
  it("returns null when no token_count event is in the tail", () => {
    expect(parseRolloutContextTokens([taskStarted("turn-1")])).toBeNull();
  });

  it("returns input_tokens alone — cached_input_tokens is a subset, not additional", () => {
    expect(parseRolloutContextTokens([tokenCount(48843, 48640)])).toBe(48843);
  });

  it("picks the LATEST token_count when the tail holds several", () => {
    const lines = [
      tokenCount(10000, 5000),
      taskStarted("turn-2"),
      tokenCount(48843, 48640),
    ];
    expect(parseRolloutContextTokens(lines)).toBe(48843);
  });

  it("reads input_tokens even when cached_input_tokens is absent", () => {
    const line = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 1234 } },
      },
    });
    expect(parseRolloutContextTokens([line])).toBe(1234);
  });

  it("returns null when input_tokens is zero (accounting not yet happened)", () => {
    expect(parseRolloutContextTokens([tokenCount(0, 0)])).toBeNull();
  });

  it("ignores token_count events that lack last_token_usage", () => {
    const noInfo = JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", info: null },
    });
    expect(parseRolloutContextTokens([noInfo])).toBeNull();
  });

  it("is independent of state — fires even mid-turn", () => {
    const lines = [
      taskStarted("turn-1"),
      tokenCount(32549, 4480),
      funcCall("call-X"),
    ];
    expect(parseRolloutContextTokens(lines)).toBe(32549);
  });

  it("skips malformed JSON lines without aborting", () => {
    const lines = ["not json", tokenCount(100, 50)];
    expect(parseRolloutContextTokens(lines)).toBe(100);
  });
});

describe("missingThreadColumns", () => {
  function dbWithColumns(cols: string[]): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(
      `CREATE TABLE threads (${cols.map((c) => `${c} TEXT`).join(", ")})`,
    );
    return db;
  }

  it("returns empty array when all required columns are present", () => {
    const db = dbWithColumns([...REQUIRED_THREAD_COLUMNS]);
    expect(missingThreadColumns(db)).toEqual([]);
    db.close();
  });

  it("tolerates extra columns beyond the required set", () => {
    const db = dbWithColumns([
      ...REQUIRED_THREAD_COLUMNS,
      "created_at",
      "tokens_used",
      "sandbox_policy",
      "cli_version",
    ]);
    expect(missingThreadColumns(db)).toEqual([]);
    db.close();
  });

  it("lists every column the schema is missing", () => {
    const kept = REQUIRED_THREAD_COLUMNS.filter(
      (c) => c !== "rollout_path" && c !== "archived",
    );
    const db = dbWithColumns([...kept, "rollout_uri"]);
    expect(missingThreadColumns(db).sort()).toEqual(
      ["archived", "rollout_path"].sort(),
    );
    db.close();
  });

  it("reports every required column as missing when the threads table does not exist", () => {
    const db = new DatabaseSync(":memory:");
    expect(missingThreadColumns(db).sort()).toEqual(
      [...REQUIRED_THREAD_COLUMNS].sort(),
    );
    db.close();
  });
});

describe("uuidV7TimestampMs", () => {
  it("round-trips the embedded unix-ms timestamp of a uuidv7", () => {
    const ms = 1_700_000_000_000;
    const hex = ms.toString(16).padStart(12, "0");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-89ab-0123456789ab`;
    expect(uuidV7TimestampMs(id)).toBe(ms);
  });

  it("decodes a real-world Codex thread id into a plausible recent time", () => {
    const ms = uuidV7TimestampMs("019db605-1234-7abc-89ab-0123456789ab");
    expect(ms).not.toBeNull();
    expect(ms).toBeGreaterThan(Date.UTC(2025, 0, 1));
    expect(ms).toBeLessThan(Date.UTC(2027, 0, 1));
  });

  it("returns null for a non-v7 uuid (wrong version nibble)", () => {
    expect(
      uuidV7TimestampMs("0192b450-0000-4abc-89ab-0123456789ab"),
    ).toBeNull();
  });

  it("returns null for strings that aren't a uuid", () => {
    expect(uuidV7TimestampMs("not-a-uuid")).toBeNull();
    expect(uuidV7TimestampMs("")).toBeNull();
  });

  it("returns null for a truncated id whose 13th char happens to be 7", () => {
    expect(uuidV7TimestampMs("019db60512347")).toBeNull();
  });

  it("returns null for a v7-looking id with an invalid variant nibble", () => {
    expect(
      uuidV7TimestampMs("019db605-1234-7abc-0123-0123456789ab"),
    ).toBeNull();
  });
});
