import { describe, expect, it } from "vitest";
import { deriveRolloutState } from "./index.ts";

describe("deriveRolloutState", () => {
  it("returns waiting after task_complete", () => {
    expect(
      deriveRolloutState([
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_started" },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_complete" },
        }),
      ]),
    ).toBe("waiting");
  });

  it("returns tool_use for an unresolved function call in the current turn", () => {
    expect(
      deriveRolloutState([
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_started" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call", call_id: "call_1" },
        }),
      ]),
    ).toBe("tool_use");
  });

  it("returns thinking once the outstanding tool call has completed", () => {
    expect(
      deriveRolloutState([
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_started" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call", call_id: "call_1" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", call_id: "call_1" },
        }),
      ]),
    ).toBe("thinking");
  });

  it("returns null when no Codex task boundary is present", () => {
    expect(
      deriveRolloutState([
        JSON.stringify({
          type: "response_item",
          payload: { type: "message" },
        }),
      ]),
    ).toBeNull();
  });

  it("ignores malformed JSON lines", () => {
    expect(
      deriveRolloutState([
        "{",
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_started" },
        }),
      ]),
    ).toBe("thinking");
  });
});
