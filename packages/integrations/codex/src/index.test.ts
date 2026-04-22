import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveSessionState } from "./index.ts";

function writeRollout(lines: Record<string, unknown>[]): string {
  const tmp = path.join(os.tmpdir(), `codex-test-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, lines.map((l) => JSON.stringify(l)).join("\n"));
  return tmp;
}

describe("deriveSessionState", () => {
  it("returns null for non-existent file", () => {
    expect(deriveSessionState("/nonexistent/file.jsonl")).toBeNull();
  });

  it("returns null when no task_started event exists", () => {
    const f = writeRollout([
      { type: "event_msg", payload: { type: "token_count", info: null } },
    ]);
    expect(deriveSessionState(f)).toBeNull();
    fs.unlinkSync(f);
  });

  it("returns thinking after task_started without task_complete", () => {
    const f = writeRollout([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn1", started_at: 1 },
      },
    ]);
    expect(deriveSessionState(f)).toEqual({
      state: "thinking",
      contextTokens: null,
    });
    fs.unlinkSync(f);
  });

  it("returns waiting after task_complete for the started turn", () => {
    const f = writeRollout([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn1", started_at: 1 },
      },
      {
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn1",
          completed_at: 2,
        },
      },
    ]);
    expect(deriveSessionState(f)).toEqual({
      state: "waiting",
      contextTokens: null,
    });
    fs.unlinkSync(f);
  });

  it("returns tool_use when function_call has no matching output", () => {
    const f = writeRollout([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn1", started_at: 1 },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call1",
          name: "exec_command",
        },
      },
    ]);
    expect(deriveSessionState(f)).toEqual({
      state: "tool_use",
      contextTokens: null,
    });
    fs.unlinkSync(f);
  });

  it("returns thinking when function_call is resolved", () => {
    const f = writeRollout([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn1", started_at: 1 },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call1",
          name: "exec_command",
        },
      },
      {
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call1" },
      },
    ]);
    expect(deriveSessionState(f)).toEqual({
      state: "thinking",
      contextTokens: null,
    });
    fs.unlinkSync(f);
  });

  it("extracts contextTokens from token_count events", () => {
    const f = writeRollout([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn1", started_at: 1 },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { total_tokens: 42000 },
          },
        },
      },
    ]);
    expect(deriveSessionState(f)).toEqual({
      state: "thinking",
      contextTokens: 42000,
    });
    fs.unlinkSync(f);
  });

  it("picks the latest turn's state", () => {
    const f = writeRollout([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn1", started_at: 1 },
      },
      {
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn1",
          completed_at: 2,
        },
      },
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn2", started_at: 3 },
      },
    ]);
    expect(deriveSessionState(f)).toEqual({
      state: "thinking",
      contextTokens: null,
    });
    fs.unlinkSync(f);
  });
});
