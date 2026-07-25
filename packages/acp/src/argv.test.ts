import { expect, it } from "vitest";
import { parseArgv } from "./argv.ts";

it("takes everything after `--` as the adapter command, verbatim", () => {
  expect(
    parseArgv(["--id", "e7f2", "--", "node", "--import", "x.mjs", "agent.ts"]),
  ).toEqual({
    id: "e7f2",
    command: "node",
    args: ["--import", "x.mjs", "agent.ts"],
  });
});

it("does not try to interpret the adapter's own flags", () => {
  // `--id` after the separator belongs to the adapter, not to the proxy.
  expect(parseArgv(["--id", "a", "--", "agent", "--id", "b"])).toEqual({
    id: "a",
    command: "agent",
    args: ["--id", "b"],
  });
});

it("requires the separator, so the adapter command is never guessed", () => {
  expect(() => parseArgv(["--id", "e7f2", "claude-agent-acp"])).toThrow(/`--`/);
});

it("rejects a separator with nothing after it", () => {
  expect(() => parseArgv(["--id", "e7f2", "--"])).toThrow(/no adapter command/);
});

it("requires an id", () => {
  expect(() => parseArgv(["--", "agent"])).toThrow(/--id/);
  expect(() => parseArgv(["--id", "--", "agent"])).toThrow(/--id/);
  expect(() => parseArgv(["--wat", "x", "--", "agent"])).toThrow(/--id/);
});
