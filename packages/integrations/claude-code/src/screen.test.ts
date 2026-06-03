import { describe, expect, it } from "vitest";
import type { ClaudeCodeInfo } from "./schemas.ts";
import {
  isScreenPollable,
  promoteFromScreen,
  screenHasClaudePrompt,
} from "./screen.ts";

// --- Fixtures (rendered-screen snapshots, VT already resolved) ---
//
// Approximations of the Claude Code prompts as `getScreenText` returns them —
// no box-drawing corners (the signature must not depend on borders), caret
// `❯` beside the highlighted option, an arrow-key select footer. The literals
// are the #905 measured corpus; the surrounding prose is illustrative.

/** ExitPlanMode, newer "Ready to code?" header. */
const EXIT_PLAN_READY_TO_CODE = `● Here is my plan for the refactor.

 Ready to code?

❯ 1. Yes, and auto-accept edits
  2. Yes, and manually approve edits
  3. No, keep planning

 ↑/↓ to select · Enter to confirm`;

/** ExitPlanMode, plan-summary-led "ready to execute" variant. */
const EXIT_PLAN_READY_TO_EXECUTE = `● I've drafted the migration plan above.

 The plan is ready to execute. Would you like to proceed?

❯ 1. Yes
  2. No, keep planning`;

/** ExitPlanMode whose only tell is the unique "No, keep planning" option. */
const EXIT_PLAN_KEEP_PLANNING = `● Plan drafted.

❯ 1. Approve
  2. No, keep planning

 ↑/↓ to select`;

/** AskUserQuestion — a question above a caret-marked option list + footer. */
const ASK_USER_QUESTION = `● I need a decision before continuing.

 Which database should we target for the first cut?

❯ 1. Postgres (recommended)
  2. SQLite
  3. MySQL

 ↑/↓ to select · Enter to confirm`;

/** AskUserQuestion rendered with the ASCII fallback caret `>` on the options. */
const ASK_USER_QUESTION_ASCII = `Pick a deployment target

> 1. Cloudflare
  2. Vercel

 to select`;

/** Adversarial negative: idle shell prompt, with the word "proceed" buried far
 *  up in scrollback — must NOT match (bottom-region gate). */
const SCROLLBACK_PROCEED = `Would you like to proceed? (this was answered long ago)
${Array.from({ length: 50 }, (_, i) => `line ${i} of build output`).join("\n")}
user@host project %`;

/** Adversarial negative: a plain numbered list in assistant output, no caret,
 *  no select footer. */
const PLAIN_NUMBERED_LIST = `● Here are the steps:

 1. Install dependencies
 2. Run the build
 3. Deploy

● Done.`;

/** Adversarial negative: a bare "Would you like to proceed?" with no plan
 *  anchor and no select structure. */
const BARE_PROCEED = `● Should I keep going? Would you like to proceed?

(waiting at the prompt)`;

const PLAIN_ASSISTANT_TEXT = `● The function returns null when the file is
  missing, so the caller treats it as "retry".`;

/** Adversarial negative: a completed response whose shell redirection (`cat >
 *  file`) supplies a `>` and whose prose says "to select" — the conjunction the
 *  old "any whitespace-delimited `>`" caret would have falsely matched. The
 *  redirect isn't a line-leading caret marking a numbered option, so it must
 *  NOT promote. */
const SHELL_REDIRECT_PROSE = `● Run this to capture the output:

  cat config.json > /tmp/file

Then open /tmp/file to select the target host for the next step.`;

/** Adversarial negative: a Markdown blockquote (`> quoted`) plus prose with
 *  "to navigate" — a blockquote `>` is line-leading but doesn't mark a numbered
 *  option, so it must NOT match. */
const MARKDOWN_BLOCKQUOTE = `● As the docs note:

> Use the arrow keys to navigate the file tree.

That's the recommended flow.`;

/** Adversarial negative: prose that literally contains "to select" with no
 *  option list anywhere. */
const PROSE_TO_SELECT = `● I went ahead and updated the query to select only the
  active rows, since that's what the report needs.`;

describe("screenHasClaudePrompt — ExitPlanMode", () => {
  it("detects the 'Ready to code?' header", () => {
    expect(screenHasClaudePrompt(EXIT_PLAN_READY_TO_CODE)).toBe(true);
  });

  it("detects the 'ready to execute. Would you like to proceed?' variant", () => {
    expect(screenHasClaudePrompt(EXIT_PLAN_READY_TO_EXECUTE)).toBe(true);
  });

  it("detects via the unique 'No, keep planning' option alone", () => {
    expect(screenHasClaudePrompt(EXIT_PLAN_KEEP_PLANNING)).toBe(true);
  });
});

describe("screenHasClaudePrompt — AskUserQuestion", () => {
  it("detects a caret + footer select prompt", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION)).toBe(true);
  });

  it("detects the ASCII fallback caret", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION_ASCII)).toBe(true);
  });
});

describe("screenHasClaudePrompt — negatives", () => {
  it("returns false for empty input", () => {
    expect(screenHasClaudePrompt("")).toBe(false);
  });

  it("ignores 'proceed' buried in scrollback (bottom-region gate)", () => {
    expect(screenHasClaudePrompt(SCROLLBACK_PROCEED)).toBe(false);
  });

  it("ignores a plain numbered list with no caret/footer", () => {
    expect(screenHasClaudePrompt(PLAIN_NUMBERED_LIST)).toBe(false);
  });

  it("ignores a bare 'Would you like to proceed?' with no plan anchor", () => {
    expect(screenHasClaudePrompt(BARE_PROCEED)).toBe(false);
  });

  it("ignores ordinary assistant prose", () => {
    expect(screenHasClaudePrompt(PLAIN_ASSISTANT_TEXT)).toBe(false);
  });

  it("ignores shell redirection + 'to select' prose (caret must mark an option)", () => {
    expect(screenHasClaudePrompt(SHELL_REDIRECT_PROSE)).toBe(false);
  });

  it("ignores a Markdown blockquote + 'to navigate' prose", () => {
    expect(screenHasClaudePrompt(MARKDOWN_BLOCKQUOTE)).toBe(false);
  });

  it("ignores prose that merely contains 'to select'", () => {
    expect(screenHasClaudePrompt(PROSE_TO_SELECT)).toBe(false);
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

  it("returns the same reference (no promotion) when no prompt is on screen", () => {
    const info = waitingInfo();
    expect(promoteFromScreen(info, PLAIN_ASSISTANT_TEXT)).toBe(info);
  });

  it("never promotes a non-waiting state, even with a prompt on screen", () => {
    const thinking = { ...waitingInfo(), state: "thinking" as const };
    expect(promoteFromScreen(thinking, ASK_USER_QUESTION)).toBe(thinking);
  });
});
