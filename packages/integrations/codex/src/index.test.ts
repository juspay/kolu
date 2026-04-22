import { describe, it, expect } from "vitest";
import { parseRolloutContextTokens, parseRolloutState } from "./index.ts";

/** Build a token_count event_msg with the given `last_token_usage`
 *  fields. Only the fields `parseRolloutContextTokens` reads are
 *  populated; real Codex events carry more (total_token_usage,
 *  rate_limits, etc.) — but the parser ignores everything else, which
 *  is the invariant these tests protect. */
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

describe("parseRolloutContextTokens", () => {
  it("returns null when no token_count event is in the tail", () => {
    expect(parseRolloutContextTokens([taskStarted("turn-1")])).toBeNull();
  });

  it("sums input_tokens + cached_input_tokens from the latest token_count", () => {
    // Real numbers from a live rollout: 46,783 uncached + 45,696 cached
    // = 92,479 tokens in the model's context this turn. Against a
    // 258,400 context window this is ~36%.
    expect(parseRolloutContextTokens([tokenCount(46783, 45696)])).toBe(92479);
  });

  it("picks the LATEST token_count when the tail holds several", () => {
    // Codex emits token_count once per turn; a tail spanning multiple
    // turns has multiple events. Only the newest reflects current
    // context usage — earlier ones are stale.
    const lines = [
      tokenCount(10000, 5000),
      taskStarted("turn-2"),
      tokenCount(46783, 45696),
    ];
    expect(parseRolloutContextTokens(lines)).toBe(92479);
  });

  it("treats missing cached_input_tokens as 0", () => {
    // Early-session token_count events sometimes land before the
    // prompt cache warms up — cached_input_tokens can be absent.
    const line = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 1234 } },
      },
    });
    expect(parseRolloutContextTokens([line])).toBe(1234);
  });

  it("returns null when the sum is zero (accounting not yet happened)", () => {
    // A token_count can land with a zero/empty last_token_usage in the
    // narrow window before the first assistant turn — rendering 0
    // would flash a misleading "0k" badge.
    expect(parseRolloutContextTokens([tokenCount(0, 0)])).toBeNull();
  });

  it("ignores token_count events that lack last_token_usage", () => {
    // Codex writes one token_count without the `info` field at
    // rate-limit refresh time (seen in the live rollouts as the
    // very first token_count event).
    const noInfo = JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", info: null },
    });
    expect(parseRolloutContextTokens([noInfo])).toBeNull();
  });

  it("is independent of state — fires even mid-turn", () => {
    // Context tokens should surface even when the lifecycle parser
    // would return `thinking` or `tool_use`; they aren't gated on
    // the last event being a `task_complete`.
    const lines = [
      taskStarted("turn-1"),
      tokenCount(32549, 4480),
      funcCall("call-X"),
    ];
    expect(parseRolloutContextTokens(lines)).toBe(37029);
  });

  it("skips malformed JSON lines without aborting", () => {
    const lines = ["not json", tokenCount(100, 50)];
    expect(parseRolloutContextTokens(lines)).toBe(150);
  });
});
