import { describe, it, expect } from "vitest";
import { parseRolloutState } from "./index.ts";

/** Build a JSONL line. Thin helper so the tests read like the data. */
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
function funcCall(callId: string): string {
  return line({
    type: "response_item",
    payload: { type: "function_call", call_id: callId },
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
    // call-B is still open → tool_use
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
    // No turn_id → not counted as a real task_started
    expect(parseRolloutState(lines)).toBeNull();
  });

  it("returns waiting when tail kept task_complete but chopped the start", () => {
    // Simulates a Codex turn whose events exceed TAIL_BYTES: the tail
    // slid past task_started(A) and captured only task_complete(A).
    // The old two-variable implementation misclassified this as
    // thinking (matching-turn-id check failed). The last-signal model
    // handles it structurally.
    const lines = [taskComplete("turn-A")];
    expect(parseRolloutState(lines)).toBe("waiting");
  });
});
