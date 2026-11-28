import { describe, expect, it } from "vitest";
import {
  normalizeAntigravityToolInput,
  parseAntigravityTranscript,
} from "./transcript.ts";

// Invented lines in the shapes `agy` 1.5.19 writes.
const LINES = [
  {
    step_index: 0,
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    status: "DONE",
    created_at: "2026-01-01T09:00:00Z",
    content:
      "<USER_REQUEST>\nlist the files\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nlocal time\n</ADDITIONAL_METADATA>",
  },
  {
    step_index: 1,
    source: "SYSTEM",
    type: "SYSTEM_MESSAGE",
    status: "DONE",
    created_at: "2026-01-01T09:00:00Z",
    content: "a note to the model",
  },
  {
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-01-01T09:00:01Z",
    model: "some-model-slug",
    input_tokens: 1300,
    cache_read_tokens: 900,
    output_tokens: 40,
    tool_calls: [
      {
        name: "run_command",
        args: { CommandLine: '"ls -1"', WaitMsBeforeAsync: "500" },
      },
    ],
  },
  {
    step_index: 3,
    source: "MODEL",
    type: "GENERIC",
    status: "DONE",
    created_at: "2026-01-01T09:00:02Z",
    content: "a.txt\nb.txt",
  },
  {
    step_index: 4,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-01-01T09:00:03Z",
    model: "some-model-slug",
    input_tokens: 1400,
    cache_read_tokens: 950,
    output_tokens: 5,
    content: "Two files.",
  },
  {
    step_index: 6,
    source: "MODEL",
    type: "GENERIC",
    status: "ERROR",
    created_at: "2026-01-01T09:00:04Z",
    content: "refused",
    error: "the user declined",
  },
];

describe("parseAntigravityTranscript", () => {
  const events = parseAntigravityTranscript(
    `${LINES.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );

  it("renders user words, tool calls, results and answers; drops system lines", () => {
    expect(events.map((e) => e.kind)).toEqual([
      "user",
      "tool_call",
      "tool_result",
      "assistant",
      "tool_result",
    ]);
  });

  it("keeps only the USER_REQUEST block of a user line", () => {
    expect(events[0]).toEqual({
      kind: "user",
      text: "list the files",
      ts: Date.parse("2026-01-01T09:00:00Z"),
    });
  });

  it("decodes a command's JSON-literal argument", () => {
    expect(events[1]).toMatchObject({
      kind: "tool_call",
      id: null,
      toolName: "run_command",
      inputs: { kind: "bash", command: "ls -1" },
    });
  });

  it("marks an ERROR result as an error", () => {
    expect(events[2]).toMatchObject({ kind: "tool_result", isError: false });
    expect(events[4]).toMatchObject({
      kind: "tool_result",
      output: "refused",
      isError: true,
    });
  });

  it("carries the answer's model", () => {
    expect(events[3]).toMatchObject({
      kind: "assistant",
      text: "Two files.",
      model: "some-model-slug",
    });
  });
});

describe("normalizeAntigravityToolInput", () => {
  it("maps a read and a whole-file write", () => {
    expect(
      normalizeAntigravityToolInput("read_file", { Path: '"/w/a.txt"' }),
    ).toEqual({ kind: "read", filePath: "/w/a.txt" });
    expect(
      normalizeAntigravityToolInput("write_file", {
        Path: '"/w/a.txt"',
        Content: '"hello\\n"',
        Append: "false",
      }),
    ).toEqual({ kind: "write", filePath: "/w/a.txt", content: "hello\n" });
  });

  it("does not render an append as a whole-file write", () => {
    expect(
      normalizeAntigravityToolInput("write_file", {
        Path: '"/w/a.txt"',
        Content: '"more\\n"',
        Append: "true",
      }),
    ).toMatchObject({ kind: "unknown", toolName: "write_file" });
  });

  it("keeps an unknown tool as unknown, arguments decoded", () => {
    expect(
      normalizeAntigravityToolInput("search_web", { Query: '"tides"' }),
    ).toEqual({
      kind: "unknown",
      toolName: "search_web",
      raw: { Query: "tides" },
    });
  });
});
