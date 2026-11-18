import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import { acceptsSetting, settingsIn } from "./settings.ts";

const THINK: SessionConfigOption = {
  id: "think",
  name: "Reasoning",
  description: "Thinking budget",
  type: "select",
  currentValue: "high",
  options: [
    {
      group: "levels",
      name: "Levels",
      options: [{ value: "high", name: "High", description: "More thought" }],
    },
  ],
};
const FAST: SessionConfigOption = {
  id: "fast",
  name: "Fast",
  type: "boolean",
  currentValue: false,
};
const MODEL: SessionConfigOption = {
  id: "model",
  name: "Model",
  type: "select",
  currentValue: "opus",
  options: [{ value: "opus", name: "Opus" }],
};

test("settings retain agent ordering, grouped choices and descriptions", () => {
  const settings = settingsIn([THINK, FAST], null);
  expect(settings.map((row) => row.id)).toEqual(["think", "fast"]);
  expect(settings[0]).toEqual({
    id: "think",
    kind: "choice",
    name: "Reasoning",
    description: "Thinking budget",
    value: "high",
    choices: [{ value: "high", label: "High", hint: "More thought" }],
  });
  // A boolean with nothing to pick is a switch, and its value travels as text.
  expect(settings[1]).toMatchObject({ kind: "boolean", value: "false" });
  expect(acceptsSetting(settings[0]!, "high")).toBe(true);
  expect(acceptsSetting(settings[0]!, "unknown")).toBe(false);
  expect(acceptsSetting(settings[1]!, "true")).toBe(false);
  expect(acceptsSetting(settings[1]!, true)).toBe(true);
  expect(settingsIn(undefined, null)).toEqual([]);
});

test("the model row is in the list, first, and marked as the model", () => {
  // Left out of the list, the model was a header with no picker under it: the
  // popover offered every setting except the one people open it to change.
  const settings = settingsIn([THINK, MODEL, FAST], "model");
  expect(settings.map((row) => [row.id, row.kind])).toEqual([
    ["model", "model"],
    ["think", "choice"],
    ["fast", "boolean"],
  ]);
});
