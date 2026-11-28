import { describe, expect, it } from "vitest";
import type { AntigravityInfo } from "./schemas.ts";
import {
  isAntigravityScreenPollable,
  promoteAntigravityFromScreen,
  screenHasAntigravityMenu,
} from "./screen.ts";

// Screens are invented around `agy`'s own fixed menu lines — the question, the
// first item, the footer — which are the markers themselves. Rows are padded
// with trailing blanks the way a terminal grid returns them.

const pad = (row: string): string => row.padEnd(80, " ");
const screen = (...rows: string[]): string =>
  [...rows.map(pad), pad(""), pad("")].join("\n");

const FOOTER = "esc to cancel                              some model · low";

const COMMAND_MENU = screen(
  "> list the files",
  "● Ran (ls) (ctrl+o to expand)",
  "Command",
  "────────────────────────────────────────",
  "Requesting permission for:",
  "   ls",
  "Run this command?",
  "> 1. Yes, run command",
  "  2. (another choice)",
  "  ↑/↓ Navigate",
  FOOTER,
);

const info = (state: AntigravityInfo["state"]): AntigravityInfo => ({
  kind: "antigravity",
  state,
  sessionId: "0a1b2c3d-0000-4000-8000-00000000000a",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
});

describe("screenHasAntigravityMenu", () => {
  it("sees the command permission menu", () => {
    expect(screenHasAntigravityMenu(COMMAND_MENU)).toBe(true);
  });

  it("sees it with the selection moved off the first item", () => {
    const moved = COMMAND_MENU.replace(
      "> 1. Yes, run command",
      "  1. Yes, run command",
    );
    expect(screenHasAntigravityMenu(moved)).toBe(true);
  });

  it("does not fire on the same words in an answer at the idle prompt", () => {
    const quoted = screen(
      "> what does the menu say?",
      "Run this command?",
      "> 1. Yes, run command",
      "────────────────────────────────────────",
      ">",
      "────────────────────────────────────────",
      "? for shortcuts                            some model · low",
    );
    expect(screenHasAntigravityMenu(quoted)).toBe(false);
  });

  it("does not fire on a running tool, whose footer is the same", () => {
    const running = screen(
      "⣾  Running command... 5s",
      "────────────────────────────────────────",
      ">",
      "────────────────────────────────────────",
      FOOTER,
    );
    expect(screenHasAntigravityMenu(running)).toBe(false);
  });

  it("does not fire on the words indented as tool output", () => {
    const output = screen(
      "  ⎿  Run this command?",
      "  ⎿  1. Yes, run command",
      FOOTER,
    );
    expect(screenHasAntigravityMenu(output)).toBe(false);
  });

  it("does not fire once the menu has scrolled above the bottom", () => {
    const answered = COMMAND_MENU.replace(
      pad(FOOTER),
      [pad("  ⎿  done"), pad(">"), pad("? for shortcuts")].join("\n"),
    );
    expect(screenHasAntigravityMenu(answered)).toBe(false);
  });
});

describe("promoteAntigravityFromScreen", () => {
  it("lifts tool_use to awaiting_user while the menu shows", () => {
    expect(
      promoteAntigravityFromScreen(info("tool_use"), COMMAND_MENU),
    ).toEqual(info("awaiting_user"));
  });

  it("returns the same info when no menu shows", () => {
    const current = info("tool_use");
    expect(promoteAntigravityFromScreen(current, screen(">", FOOTER))).toBe(
      current,
    );
  });

  it("polls only tool_use", () => {
    expect(isAntigravityScreenPollable(info("tool_use"))).toBe(true);
    for (const state of ["thinking", "waiting", "awaiting_user"] as const) {
      expect(isAntigravityScreenPollable(info(state))).toBe(false);
      expect(promoteAntigravityFromScreen(info(state), COMMAND_MENU)).toEqual(
        info(state),
      );
    }
  });
});
