/** The settings popover's two composed decisions: the model is offered, and
 *  it is offered FIRST; a boolean is a switch rather than a heading. Both are
 *  defects a person met on a live Claude session — a panel with no model
 *  control at all, and a `FAST MODE` heading with nothing under it. */

import { describe, expect, it } from "vitest";
import {
  type SettingsOption,
  settingsSections,
  switchValue,
} from "./settingsSections";

const option = (
  over: Partial<SettingsOption> & Pick<SettingsOption, "id" | "kind">,
): SettingsOption => ({
  name: over.id,
  description: null,
  value: null,
  choices: [],
  ...over,
});

/** What the owner's own session advertised, in the order the adapter sent it:
 *  mode, effort, a boolean, and the model LAST. */
const live: ReadonlyArray<SettingsOption> = [
  option({
    id: "mode",
    kind: "choice",
    name: "Mode",
    value: "bypassPermissions",
    choices: [
      { value: "default", label: "Manual", hint: "Always ask before changes" },
      { value: "acceptEdits", label: "Accept edits", hint: null },
      { value: "bypassPermissions", label: "Bypass permissions", hint: null },
    ],
  }),
  option({
    id: "effort",
    kind: "choice",
    name: "Effort",
    value: "default",
    choices: [
      { value: "default", label: "Default", hint: null },
      { value: "max", label: "Max", hint: null },
    ],
  }),
  option({ id: "fast", kind: "boolean", name: "Fast mode", value: "false" }),
  option({
    id: "model",
    kind: "model",
    name: "Model",
    value: "opus",
    choices: [
      { value: "opus", label: "Opus 5.5", hint: "1M" },
      { value: "sonnet", label: "Sonnet 5", hint: "200k" },
    ],
  }),
];

describe("settingsSections", () => {
  it("offers the model first, then the agent's own order", () => {
    expect(settingsSections(live).map((section) => section.option.id)).toEqual([
      "model",
      "mode",
      "effort",
      "fast",
    ]);
  });

  it("draws a boolean as a switch at the value the agent confirmed", () => {
    const [fast] = settingsSections([
      option({ id: "fast", kind: "boolean", name: "Fast mode", value: "true" }),
    ]);
    expect(fast).toEqual({
      control: "switch",
      on: true,
      option: expect.objectContaining({ id: "fast" }),
    });
    expect(switchValue(false)).toBe("false");
    expect(switchValue(true)).toBe("true");
  });

  it("drops a boolean the agent never stated a value for", () => {
    // A switch has to be drawn somewhere, and `off` would be this panel
    // asserting a setting nobody confirmed.
    expect(settingsSections([option({ id: "fast", kind: "boolean" })])).toEqual(
      [],
    );
  });

  it("drops a select with no choices rather than heading an empty section", () => {
    expect(
      settingsSections([option({ id: "mode", kind: "choice", value: "x" })]),
    ).toEqual([]);
  });

  it("keeps a select whose confirmed value is unknown — nothing is claimed", () => {
    const [mode] = settingsSections([
      option({
        id: "mode",
        kind: "choice",
        choices: [{ value: "default", label: "Manual", hint: null }],
      }),
    ]);
    expect(mode).toEqual({
      control: "choices",
      option: expect.objectContaining({ id: "mode", value: null }),
    });
  });
});
