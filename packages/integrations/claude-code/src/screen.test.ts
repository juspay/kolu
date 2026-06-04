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

/** Adversarial NEGATIVE — Claude's own `/fork` background-agent list (captured
 *  live from a real session). Its footer is `↑/↓ to select` — "to select", NOT
 *  "to navigate" — so the marker must NOT fire while a user browses it. This is
 *  the closest known look-alike to the AskUserQuestion footer, so it's the
 *  load-bearing regression guard for the single-marker choice. */
const FORK_AGENT_LIST = `* Crunched for 51s · 1 local agent still running

❯ s

▶▶ bypass permissions on (shift+tab to cycle) · PR #1158

● main
○ meer4ge-latest-master  Running typecheck on merged BrowseFileDispatcher.tsx
                                    ↑/↓ to select · Enter to view
                                    1m 14s · ↓ 232.4k tokens`;

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

describe("screenHasClaudePrompt — AskUserQuestion", () => {
  it("detects the live '↑/↓ to navigate' select footer", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION)).toBe(true);
  });
});

describe("screenHasClaudePrompt — negatives", () => {
  it("returns false for empty input", () => {
    expect(screenHasClaudePrompt("")).toBe(false);
  });

  it("ignores Claude's /fork agent list (footer is '↑/↓ to select', not 'to navigate')", () => {
    expect(screenHasClaudePrompt(FORK_AGENT_LIST)).toBe(false);
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
  it("is true for the working states a pending prompt can leave on disk", () => {
    // A pending AskUserQuestion most often reads as `thinking` (the user's
    // prompt is the newest on-disk entry), but `waiting`/`tool_use` are
    // possible too — all must be polled.
    for (const state of ["thinking", "tool_use", "waiting"] as const) {
      expect(isScreenPollable({ ...waitingInfo(), state })).toBe(true);
    }
  });

  it("is false for already-awaiting and workflow busy-wait", () => {
    for (const state of ["awaiting_user", "running_background"] as const) {
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

  it("lifts from thinking too (the real AskUserQuestion flow)", () => {
    // The dock-stuck-on-Thinking bug: a pending prompt reads as `thinking`, so
    // the scrape MUST promote from it, not only from `waiting`.
    const thinking = { ...waitingInfo(), state: "thinking" as const };
    expect(promoteFromScreen(thinking, ASK_USER_QUESTION).state).toBe(
      "awaiting_user",
    );
  });

  it("does not promote on the /model picker", () => {
    const info = waitingInfo();
    expect(promoteFromScreen(info, MODEL_PICKER)).toBe(info);
  });

  it("returns the same reference (no promotion) when no prompt is on screen", () => {
    const info = waitingInfo();
    expect(promoteFromScreen(info, PLAIN_ASSISTANT_TEXT)).toBe(info);
  });

  it("never promotes a non-promotable state, even with a prompt on screen", () => {
    const running = { ...waitingInfo(), state: "running_background" as const };
    expect(promoteFromScreen(running, ASK_USER_QUESTION)).toBe(running);
  });
});
