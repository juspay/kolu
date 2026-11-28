import { describe, expect, it } from "vitest";
import type { AntigravityInfo } from "./schemas.ts";
import {
  isAntigravityScreenPollable,
  promoteAntigravityFromScreen,
  screenHasAntigravityMenu,
} from "./screen.ts";

// The only lines taken from `agy` are the markers themselves: each menu's
// question, its first item, and the cancel footer. Every other row here is
// invented. Rows are padded with trailing blanks the way a terminal grid
// returns them.

const pad = (row: string): string => row.padEnd(80, " ");
const screen = (...rows: string[]): string =>
  [...rows.map(pad), pad(""), pad("")].join("\n");

const FOOTER = "esc to cancel                              some model · low";

const COMMAND_QUESTION = "Run this command?";
const COMMAND_FIRST = "1. Yes, run command";
const CREATE_QUESTION = "Allow creation of this file?";
const CREATE_FIRST = "1. Yes, allow creation";

/** A menu as `agy` lays it out: invented context rows, then the question,
 *  the first item (selected unless `moved`), another item, a hint row, and
 *  the footer on the bottom line. */
const menu = (question: string, first: string, moved = false): string =>
  screen(
    "> do the thing",
    "(a summary of the tool call)",
    "(the permission heading)",
    "(what the tool will do)",
    question,
    `${moved ? "  " : "> "}${first}`,
    `${moved ? "> " : "  "}2. (another choice)`,
    "  (key hints)",
    FOOTER,
  );

const IDLE = (...rows: string[]): string =>
  screen(...rows, "(input box)", "(idle footer)          some model · low");

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

describe.each([
  ["command", COMMAND_QUESTION, COMMAND_FIRST],
  ["file-creation", CREATE_QUESTION, CREATE_FIRST],
])("the %s permission menu", (_name, question, first) => {
  it("is seen", () => {
    expect(screenHasAntigravityMenu(menu(question, first))).toBe(true);
  });

  it("is seen with the selection moved off the first item", () => {
    expect(screenHasAntigravityMenu(menu(question, first, true))).toBe(true);
  });

  it("is not seen in an answer quoted at the idle prompt", () => {
    expect(screenHasAntigravityMenu(IDLE(question, `> ${first}`))).toBe(false);
  });

  it("is not seen as tool output above the cancel footer", () => {
    expect(
      screenHasAntigravityMenu(
        screen(`  | ${question}`, `  | ${first}`, FOOTER),
      ),
    ).toBe(false);
  });

  it("is not seen once it has scrolled above the bottom", () => {
    const answered = menu(question, first).replace(
      pad(FOOTER),
      [pad("(the tool's result)"), pad("(idle footer)")].join("\n"),
    );
    expect(screenHasAntigravityMenu(answered)).toBe(false);
  });

  it("is not seen with its question but no first item under it", () => {
    expect(
      screenHasAntigravityMenu(screen(question, "(something else)", FOOTER)),
    ).toBe(false);
  });
});

describe("screenHasAntigravityMenu", () => {
  it("does not fire on a running tool, whose footer is the cancel footer too", () => {
    expect(
      screenHasAntigravityMenu(
        screen("(a tool running)", "(input box)", FOOTER),
      ),
    ).toBe(false);
  });
});

describe("promoteAntigravityFromScreen", () => {
  it("lifts tool_use to awaiting_user while a menu shows", () => {
    for (const [question, first] of [
      [COMMAND_QUESTION, COMMAND_FIRST],
      [CREATE_QUESTION, CREATE_FIRST],
    ] as const) {
      expect(
        promoteAntigravityFromScreen(info("tool_use"), menu(question, first)),
      ).toEqual(info("awaiting_user"));
    }
  });

  it("returns the same info when no menu shows", () => {
    const current = info("tool_use");
    expect(
      promoteAntigravityFromScreen(current, screen("(a tool running)", FOOTER)),
    ).toBe(current);
  });

  it("polls only tool_use", () => {
    const shown = menu(COMMAND_QUESTION, COMMAND_FIRST);
    expect(isAntigravityScreenPollable(info("tool_use"))).toBe(true);
    for (const state of ["thinking", "waiting", "awaiting_user"] as const) {
      expect(isAntigravityScreenPollable(info(state))).toBe(false);
      expect(promoteAntigravityFromScreen(info(state), shown)).toEqual(
        info(state),
      );
    }
  });
});
