import { expect, test } from "vitest";
import { acceptsSetting, settingsIn } from "./settings.ts";

test("settings retain agent ordering, grouped choices and descriptions", () => {
  const settings = settingsIn([
    {
      id: "think",
      name: "Reasoning",
      description: "Thinking budget",
      type: "select",
      currentValue: "high",
      options: [
        {
          group: "levels",
          name: "Levels",
          options: [
            { value: "high", name: "High", description: "More thought" },
          ],
        },
      ],
    },
    { id: "fast", name: "Fast", type: "boolean", currentValue: false },
  ]);
  expect(settings.map((row) => row.id)).toEqual(["think", "fast"]);
  expect(settings[0]).toMatchObject({
    description: "Thinking budget",
    options: [{ value: "high", name: "High", description: "More thought" }],
  });
  expect(acceptsSetting(settings[0]!, "high")).toBe(true);
  expect(acceptsSetting(settings[0]!, "unknown")).toBe(false);
  expect(acceptsSetting(settings[1]!, "true")).toBe(false);
  expect(acceptsSetting(settings[1]!, true)).toBe(true);
  expect(settingsIn(undefined)).toEqual([]);
});
