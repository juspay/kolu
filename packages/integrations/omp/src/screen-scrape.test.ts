import { describe, expect, it } from "vitest";
import {
  isOmpScreenPollable,
  promoteOmpFromScreen,
  screenHasOmpPrompt,
  TAIL_REGION_LINES,
} from "./screen-scrape.ts";
import type { OmpInfo } from "./schemas.ts";

/** The tool-approval dialog, captured live from omp 18.1.21 in a 140×45 PTY
 *  (`omp --approval-mode always-ask`, a `bash` call) — the box title is
 *  `formatApprovalPrompt`'s first line, the options come from
 *  `uiContext.select(prompt, ["Approve", "Deny"])`. */
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

/** The `ask` tool's dialog, captured live the same way (omp's `which colour do
 *  you prefer?` question). */
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
    // A dialog scrolled into history is not the dialog at the cursor.
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
    // An idle agent has no dialog to find, and a lifted state is already
    // awaiting — the poll clock stays off for both.
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
