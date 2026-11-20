import { describe, expect, it } from "vitest";
import {
  isOmpScreenPollable,
  ompSteerPane,
  promoteOmpFromScreen,
  screenHasOmpPrompt,
  TAIL_REGION_LINES,
} from "./screen-scrape.ts";
import type { OmpInfo } from "./schemas.ts";

const APPROVAL_DIALOG = [
  " run the bash command: echo hello",
  "",
  "╭──────────────────────────────────────────────╮",
  "│ $ echo hello                                 │",
  "╰──────────────────────────────────────────────╯",
  "",
  "  ⎋ Running requested echo command",
  "╭─ Allow tool: bash ───────────────────────────╮",
  "│                                              │",
  "│ Command: echo hello                          │",
  "│                                              │",
  "│  ❯ Approve                                   │",
  "│    Deny                                      │",
  "│                                              │",
  "│ up/down navigate  enter select  esc cancel   │",
  "│                                              │",
  "╰──────────────────────────────────────────────╯",
  "",
].join("\n");

const ASK_DIALOG = [
  "  ⎋ Asking user for colour preference",
  "╭─ Ask ────────────────────────────────────────╮",
  "│ Which colour do you prefer?                  │",
  "├──────────────────────────────────────────────┤",
  "│ ❯ ○ Blue (Recommended)                       │",
  "│       Cool, high-contrast.                   │",
  "│   ○ Green                                    │",
  "│   ○ Other (type your own)                    │",
  "├──────────────────────────────────────────────┤",
  "│ Enter select · n note · ↑/↓ move · Esc cancel│",
  "╰──────────────────────────────────────────────╯",
].join("\n");

const info = (state: OmpInfo["state"]): OmpInfo => ({
  kind: "omp",
  state,
  sessionId: "01a0a0e3-1843-701b-bfde-c9c816e3e92f",
  sessionPath:
    "/home/u/.omp/agent/sessions/-work/2026-09-14T17-07-12-579Z_x.jsonl",
  model: "deepseek-v4.1-flash",
  summary: "Fix the flake",
  taskProgress: null,
  contextTokens: 1234,
  startedAt: Date.now(),
  lastPromptId: null,
  lastPromptText: null,
});

describe("screenHasOmpPrompt", () => {
  it("recognizes both blocking dialogs", () => {
    expect(screenHasOmpPrompt(APPROVAL_DIALOG)).toBe(true);
    expect(screenHasOmpPrompt(ASK_DIALOG)).toBe(true);
    expect(screenHasOmpPrompt(`${ASK_DIALOG}\n`)).toBe(true);
  });

  it("recognizes the timed ask dialog (`Ask (30s)`)", () => {
    expect(
      screenHasOmpPrompt(
        "╭─ Ask (30s) ──────────────────────────────────╮\n│ pick one │",
      ),
    ).toBe(true);
  });

  it("does not fire on prose or output that merely mentions the words", () => {
    expect(
      screenHasOmpPrompt(
        "The approval dialog reads `Allow tool: bash` and offers Approve / Deny.\n",
      ),
    ).toBe(false);
    expect(
      screenHasOmpPrompt("Ask me anything — I'm idle at the prompt.\n"),
    ).toBe(false);
    const scrolled = `${APPROVAL_DIALOG}\n${Array.from(
      { length: TAIL_REGION_LINES + 5 },
      (_, i) => `line ${i}`,
    ).join("\n")}`;
    expect(screenHasOmpPrompt(scrolled)).toBe(false);
  });
});

describe("isOmpScreenPollable", () => {
  it("polls only the states a dialog can appear in", () => {
    expect(isOmpScreenPollable(info("tool_use"))).toBe(true);
    expect(isOmpScreenPollable(info("thinking"))).toBe(true);
    expect(isOmpScreenPollable(info("waiting"))).toBe(false);
    expect(isOmpScreenPollable(info("awaiting_user"))).toBe(false);
  });
});

describe("promoteOmpFromScreen", () => {
  it("lifts a pollable state while a dialog is on screen", () => {
    for (const state of ["tool_use", "thinking"] as const) {
      expect(promoteOmpFromScreen(info(state), APPROVAL_DIALOG).state).toBe(
        "awaiting_user",
      );
      expect(promoteOmpFromScreen(info(state), ASK_DIALOG).state).toBe(
        "awaiting_user",
      );
    }
  });

  it("returns the SAME reference when nothing warrants a promotion", () => {
    const settled = info("waiting");
    expect(promoteOmpFromScreen(settled, APPROVAL_DIALOG)).toBe(settled);
    const pollable = info("tool_use");
    expect(promoteOmpFromScreen(pollable, "ordinary output\n")).toBe(pollable);
  });

  it("never lowers an already-awaiting state", () => {
    const awaiting = info("awaiting_user");
    expect(promoteOmpFromScreen(awaiting, "ordinary output\n")).toBe(awaiting);
  });
});

const HELD = [
  "│ print('EVAL2DONE')                                                           │",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
  "",
  " Steering · 1 ",
  "   1. STEER-FOUR: also say the word LYCHEE. ",
  "   └ Alt+↑ to edit ",
  "",
  "  ⎋ sleep 150 again                            😴 SLEEP: Run sleep 90 echo SLEPT",
  "╰─                                                                              ",
].join("\n");
const HELD_LONG = HELD.replace(
  "STEER-FOUR: also say the word LYCHEE. ",
  "STEER-THREE: this is a deliberately long single line, the length of a re… ",
);
const HELD_MULTILINE = HELD.replace(
  "STEER-FOUR: also say the word LYCHEE. ",
  "STEER-FIVE, a multiline steer. ↵ Line two of it. ↵ When you reply, also … ",
);
const TYPED_ONLY = [
  "  ⎋ sleep 150                                  😴 SLEEP: Run sleep 90 echo SLEPT",
  "╰─ STEER-FOUR: also say the word LYCHEE.                                       ",
].join("\n");

describe("ompSteerPane", () => {
  it("finds a short line, a line cut at the width, and a multiline paste in the pane", () => {
    expect(ompSteerPane(HELD, "STEER-FOUR: also say the word LYCHEE.")).toEqual(
      {
        kind: "holds",
      },
    );
    expect(
      ompSteerPane(
        HELD_LONG,
        `STEER-THREE: this is a deliberately long single line, the length of a real brief, ${"padding ".repeat(60)}`,
      ),
    ).toEqual({ kind: "holds" });
    expect(
      ompSteerPane(
        HELD_MULTILINE,
        "STEER-FIVE, a multiline steer.\nLine two of it.\nWhen you reply, also say the word GUAVA.",
      ),
    ).toEqual({ kind: "holds" });
  });

  it("words still in the input box, or another message in the pane, are ABSENT", () => {
    expect(
      ompSteerPane(TYPED_ONLY, "STEER-FOUR: also say the word LYCHEE."),
    ).toEqual({ kind: "absent" });
    expect(ompSteerPane(HELD, "a different message entirely")).toEqual({
      kind: "absent",
    });
  });

  it("a pane whose rows do not parse into the count it states is UNREADABLE", () => {
    const WRAPPED = [
      " Steering · 2 ",
      "   1. the first message, which wrapped onto ",
      "      a second row the item pattern cannot read ",
      "   └ Alt+↑ to edit ",
    ].join("\n");
    const reading = ompSteerPane(WRAPPED, "ship it");
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("2");
  });

  it("a pane whose header is above the rows kolu was GIVEN is UNREADABLE", () => {
    const tall = [
      "   7. a message kolu never sees the header of ",
      "   └ Alt+↑ to edit ",
    ].join("\n");
    expect(ompSteerPane(tall, "ship it").kind).toBe("unreadable");
  });

  it("no pane at all is ABSENT", () => {
    expect(ompSteerPane("ordinary output\n", "ship it")).toEqual({
      kind: "absent",
    });
  });
});
