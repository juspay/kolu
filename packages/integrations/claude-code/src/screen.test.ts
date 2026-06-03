import { describe, expect, it } from "vitest";
import type { ClaudeCodeInfo } from "./schemas.ts";
import {
  isScreenPollable,
  promoteFromScreen,
  screenHasClaudePrompt,
} from "./screen.ts";

// --- Fixtures (rendered-screen snapshots, VT already resolved) ---
//
// Verbatim captures from claude-code v2.1.162 via `tmux capture-pane` — the same
// VT-resolved text `getScreenText` returns. The awaiting-user prompts and the
// idle select-menus that look similar but must NOT promote.

/** AskUserQuestion — captured live. The select footer `↑/↓ to navigate` is the
 *  marker; the question + option labels are model-supplied. */
const ASK_USER_QUESTION = ` ☐ Database

Which database do you prefer?

❯ 1. Postgres
     Advanced open-source relational database with rich features and scalability
  2. SQLite
     Lightweight, embedded SQL database ideal for development and single-file storage
  3. MySQL
     Popular open-source relational database known for reliability and performance
  4. Type something.

  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`;

/** ExitPlanMode — header `Ready to code?`. Note the option labels (`Tell Claude
 *  what to change`) and the footer carry NO arrow-nav hint, so the marker is the
 *  header, not the footer. */
const EXIT_PLAN_READY_TO_CODE = ` Ready to code?

 Here is Claude's plan:
 Add a hello() function to foo.js and export it.

❯ 1. Yes, and auto-accept edits
  2. Yes, and manually approve edits
  3. Tell Claude what to change

 shift+tab to approve with this feedback
 ctrl-g to edit in Nvim · ~/.claude/plans/foo.md`;

/** ExitPlanMode — older plan-summary-led "ready to execute" phrasing. */
const EXIT_PLAN_READY_TO_EXECUTE = `● I've drafted the migration plan above.

 The migration is ready to execute. Would you like to proceed?

❯ 1. Yes
  2. No`;

/** Adversarial NEGATIVE — the real `/model` picker (captured live). It IS a
 *  caret-marked numbered select list (`❯ 3. Haiku ✔`), but its footer carries no
 *  `↑/↓ to navigate`, so a user opening it while idle must NOT promote. This is
 *  the menu-collision case from the review discussion. */
const MODEL_PICKER = `  Select model
  Switch between Claude models. Your pick becomes the default for new sessions.

    1. Default (recommended)  Opus 4.8 with 1M context · Most capable for complex work
    2. Sonnet                 Sonnet 4.6 · Best for everyday tasks
  ❯ 3. Haiku ✔                Haiku 4.5 · Fastest for quick answers

  Enter to set as default · s to use this session only · Esc to cancel`;

/** Adversarial NEGATIVE — the folder-trust prompt (captured live). Also a
 *  caret-marked numbered list, footer `Enter to confirm · Esc to cancel`, no
 *  arrow-nav — must NOT promote. */
const TRUST_PROMPT = ` Do you trust the files in this folder?

❯ 1. Yes, I trust the files
  2. No, exit

 Enter to confirm · Esc to cancel`;

/** Adversarial NEGATIVE — a real AskUserQuestion footer, but scrolled far above
 *  the bottom region by later output (the prompt was answered long ago). The
 *  bottom-region gate must keep it from matching. */
const SCROLLBACK_NAV = ` Enter to select · ↑/↓ to navigate · Esc to cancel
${Array.from({ length: 50 }, (_, i) => `line ${i} of subsequent build output`).join("\n")}
srid on pureintent /tmp/project
❯ `;

/** Adversarial NEGATIVE — prose that mentions navigating with arrow keys but
 *  carries no `↑/↓` glyphs, so the marker can't fire. */
const PROSE_NAVIGATE = `● Use the arrow keys to navigate the file tree, then press
  enter to open the file you want.`;

const PLAIN_ASSISTANT_TEXT = `● The function returns null when the file is
  missing, so the caller treats it as "retry".`;

describe("screenHasClaudePrompt — ExitPlanMode", () => {
  it("detects the 'Ready to code?' header", () => {
    expect(screenHasClaudePrompt(EXIT_PLAN_READY_TO_CODE)).toBe(true);
  });

  it("detects the 'ready to execute. Would you like to proceed?' variant", () => {
    expect(screenHasClaudePrompt(EXIT_PLAN_READY_TO_EXECUTE)).toBe(true);
  });
});

describe("screenHasClaudePrompt — AskUserQuestion", () => {
  it("detects the live '↑/↓ to navigate' select footer", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION)).toBe(true);
  });
});

describe("screenHasClaudePrompt — negatives", () => {
  it("returns false for empty input", () => {
    expect(screenHasClaudePrompt("")).toBe(false);
  });

  it("ignores the /model picker (real select menu, different footer)", () => {
    expect(screenHasClaudePrompt(MODEL_PICKER)).toBe(false);
  });

  it("ignores the folder-trust prompt (real select menu, different footer)", () => {
    expect(screenHasClaudePrompt(TRUST_PROMPT)).toBe(false);
  });

  it("ignores a nav footer scrolled out of the bottom region", () => {
    expect(screenHasClaudePrompt(SCROLLBACK_NAV)).toBe(false);
  });

  it("ignores prose mentioning 'arrow keys to navigate' with no glyphs", () => {
    expect(screenHasClaudePrompt(PROSE_NAVIGATE)).toBe(false);
  });

  it("ignores ordinary assistant prose", () => {
    expect(screenHasClaudePrompt(PLAIN_ASSISTANT_TEXT)).toBe(false);
  });
});

// --- Promote-only policy ---

function waitingInfo(): ClaudeCodeInfo {
  return {
    kind: "claude-code",
    state: "waiting",
    sessionId: "s1",
    model: "claude-opus-4-8",
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: 1234,
  };
}

describe("isScreenPollable", () => {
  it("is true only for waiting", () => {
    expect(isScreenPollable(waitingInfo())).toBe(true);
    for (const state of [
      "thinking",
      "tool_use",
      "awaiting_user",
      "running_background",
    ] as const) {
      expect(isScreenPollable({ ...waitingInfo(), state })).toBe(false);
    }
  });
});

describe("promoteFromScreen", () => {
  it("lifts waiting → awaiting_user when a prompt is on screen", () => {
    const info = waitingInfo();
    const promoted = promoteFromScreen(info, ASK_USER_QUESTION);
    expect(promoted.state).toBe("awaiting_user");
    // Promote-only changes the state; every other field rides through.
    expect(promoted).toEqual({ ...info, state: "awaiting_user" });
  });

  it("lifts on an ExitPlanMode screen too", () => {
    expect(
      promoteFromScreen(waitingInfo(), EXIT_PLAN_READY_TO_CODE).state,
    ).toBe("awaiting_user");
  });

  it("does not promote on the /model picker", () => {
    const info = waitingInfo();
    expect(promoteFromScreen(info, MODEL_PICKER)).toBe(info);
  });

  it("returns the same reference (no promotion) when no prompt is on screen", () => {
    const info = waitingInfo();
    expect(promoteFromScreen(info, PLAIN_ASSISTANT_TEXT)).toBe(info);
  });

  it("never promotes a non-waiting state, even with a prompt on screen", () => {
    const thinking = { ...waitingInfo(), state: "thinking" as const };
    expect(promoteFromScreen(thinking, ASK_USER_QUESTION)).toBe(thinking);
  });
});
