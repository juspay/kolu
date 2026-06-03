import { describe, expect, it } from "vitest";
import type { ClaudeCodeInfo } from "./schemas.ts";
import {
  detectClaudePrompt,
  isScreenPollable,
  promoteFromScreen,
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

describe("detectClaudePrompt — ExitPlanMode", () => {
  it("detects the 'Ready to code?' header", () => {
    expect(detectClaudePrompt(EXIT_PLAN_READY_TO_CODE)).toEqual({
      tool: "ExitPlanMode",
    });
  });

  it("detects the 'ready to execute. Would you like to proceed?' variant", () => {
    expect(detectClaudePrompt(EXIT_PLAN_READY_TO_EXECUTE)).toEqual({
      tool: "ExitPlanMode",
    });
  });

  it("detects via the unique 'No, keep planning' option alone", () => {
    expect(detectClaudePrompt(EXIT_PLAN_KEEP_PLANNING)).toEqual({
      tool: "ExitPlanMode",
    });
  });

  it("wins over the question structure it also carries", () => {
    // EXIT_PLAN_READY_TO_CODE has a caret + footer too; the literal must
    // discriminate it as ExitPlanMode, never AskUserQuestion.
    expect(detectClaudePrompt(EXIT_PLAN_READY_TO_CODE)?.tool).toBe(
      "ExitPlanMode",
    );
  });
});

describe("detectClaudePrompt — AskUserQuestion", () => {
  it("detects a caret + footer select prompt and extracts the question", () => {
    expect(detectClaudePrompt(ASK_USER_QUESTION)).toEqual({
      tool: "AskUserQuestion",
      question: "Which database should we target for the first cut?",
    });
  });

  it("detects the ASCII fallback caret", () => {
    const result = detectClaudePrompt(ASK_USER_QUESTION_ASCII);
    expect(result?.tool).toBe("AskUserQuestion");
  });

  it("extracts the question, skipping option and footer lines", () => {
    const result = detectClaudePrompt(ASK_USER_QUESTION_ASCII);
    expect(result).toMatchObject({
      tool: "AskUserQuestion",
      question: "Pick a deployment target",
    });
  });
});

describe("detectClaudePrompt — negatives", () => {
  it("returns null for empty input", () => {
    expect(detectClaudePrompt("")).toBeNull();
  });

  it("ignores 'proceed' buried in scrollback (bottom-region gate)", () => {
    expect(detectClaudePrompt(SCROLLBACK_PROCEED)).toBeNull();
  });

  it("ignores a plain numbered list with no caret/footer", () => {
    expect(detectClaudePrompt(PLAIN_NUMBERED_LIST)).toBeNull();
  });

  it("ignores a bare 'Would you like to proceed?' with no plan anchor", () => {
    expect(detectClaudePrompt(BARE_PROCEED)).toBeNull();
  });

  it("ignores ordinary assistant prose", () => {
    expect(detectClaudePrompt(PLAIN_ASSISTANT_TEXT)).toBeNull();
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
