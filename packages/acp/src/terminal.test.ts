import { expect, test } from "vitest";
import { terminalMetaIn } from "./terminal.ts";

test("terminal extensions decode deltas and exits without interpreting unrelated metadata", () => {
  expect(
    terminalMetaIn({
      terminal_info: { terminal_id: "a" },
      terminal_output: { terminal_id: "a", data: "hi" },
      terminal_exit: { terminal_id: "a", exit_code: 3, signal: null },
    }),
  ).toEqual([
    { kind: "begin", id: "a" },
    { kind: "output", id: "a", data: "hi" },
    { kind: "exit", id: "a", code: 3, signal: null },
  ]);
  expect(
    terminalMetaIn({
      terminal_output_delta: { terminal_id: "a", data: "tail" },
    }),
  ).toEqual([{ kind: "output", id: "a", data: "tail" }]);
  for (const value of [null, "bad", {}, { terminal_output: { data: "no id" } }])
    expect(terminalMetaIn(value)).toEqual([]);
});
