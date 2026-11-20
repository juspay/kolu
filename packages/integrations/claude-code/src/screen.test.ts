import { describe, expect, it } from "vitest";
import type { ClaudeCodeInfo } from "./schemas.ts";
import {
  isScreenPollable,
  promoteFromScreen,
  screenHasClaudePrompt,
} from "./screen.ts";

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

const ASK_USER_QUESTION_WITH_NOTES = ` ☐ Decomposition

Which package decomposition is cleanest?

❯ 1. Entry with behaviour
  2. Supervisor owns the entry
  3. Batteries-included supervisor

  Notes: press n to add notes

Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel`;

const ASK_USER_QUESTION_WRAPPED = ` ☐ Decomposition

Which package decomposition is cleanest?

❯ 1. Entry with behaviour
  2. Supervisor owns the entry

Enter to select · ↑/↓ to navigate · n to add
notes · Esc to cancel`;

const ASK_USER_QUESTION_MULTISELECT = `←  □ xterm title   □ Nix title   □ Nix depth   ✔ Submit  →

Title for the xterm.js memory-leak post? It's a war story: I optimized the
Chrome heap-count proxy; the real 220MB leak was in native ArrayBuffers.

❯ 1. Measuring the Wrong Thing
     Leads with the actual lesson — the proxy metric lied. Plain PG-ish.
  2. Keep: The leak that wasn't in any Context
     Current title. Already PG-ish — a plain, slightly mysterious phrase.
  3. Off by Three Orders of Magnitude
     Uses the concrete number (PG likes a surprising figure).
  4. The Proxy Lies
     Short and punchy; names the villain directly.
  5. Type something.

  6. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel`;

const FORK_AGENT_LIST = `* Crunched for 51s · 1 local agent still running

❯ s

▶▶ bypass permissions on (shift+tab to cycle) · PR #1158

● main
○ meer4ge-latest-master  Running typecheck on merged BrowseFileDispatcher.tsx
                                    ↑/↓ to select · Enter to view
                                    1m 14s · ↓ 232.4k tokens`;

const MODEL_PICKER = `  Select model
  Switch between Claude models. Your pick becomes the default for new sessions.

    1. Default (recommended)  Opus 4.8 with 1M context · Most capable for complex work
    2. Sonnet                 Sonnet 4.6 · Best for everyday tasks
  ❯ 3. Haiku ✔                Haiku 4.5 · Fastest for quick answers

  Enter to set as default · s to use this session only · Esc to cancel`;

const TRUST_PROMPT = ` Do you trust the files in this folder?

❯ 1. Yes, I trust the files
  2. No, exit

 Enter to confirm · Esc to cancel`;

const SCROLLBACK_NAV = ` Enter to select · ↑/↓ to navigate · Esc to cancel
${Array.from({ length: 50 }, (_, i) => `line ${i} of subsequent build output`).join("\n")}
srid on pureintent /tmp/project
❯ `;

const PROSE_NAVIGATE = `● Use the arrow keys to navigate the file tree, then press
  enter to open the file you want.`;

const PROSE_NAVIGATE_WITH_SEPARATOR = `● Use arrow keys to navigate the tree · Esc to cancel
  is roughly how that other tool's footer reads — ours differs.`;

const PLAIN_ASSISTANT_TEXT = `● The function returns null when the file is
  missing, so the caller treats it as "retry".`;

const PROSE_TAB_TO_AMEND = `● Git's interactive rebase opens an editor; press
  Tab to amend the commit message before saving.`;

const PROSE_DONT_ASK_AGAIN = `● I'll remember that preference and won't ask
  again for this project — let me know if you change your mind, and don't ask
  again about the linter config either.`;

const WRITE_PERMISSION = `● Write(notes.txt)

 Create file
 notes.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  1 hello
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to create notes.txt?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No
 Esc to cancel · Tab to amend`;

const WEBFETCH_PERMISSION = `● Fetch(https://example.com)

 Fetch
   url: "https://example.com", prompt: "Summarize the main content of this page"
   Claude wants to fetch content from example.com
 Do you want to allow Claude to fetch this content?
 ❯ 1. Yes
   2. Yes, and don't ask again for example.com
   3. No, and tell Claude what to do differently (esc)`;

describe("screenHasClaudePrompt — AskUserQuestion", () => {
  it("detects the single-select '↑/↓ to navigate' footer", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION)).toBe(true);
  });

  it("detects the multi-select 'Tab/Arrow keys to navigate' footer", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION_MULTISELECT)).toBe(true);
  });

  it("detects the footer with the 'n to add notes' segment (v2.1.173)", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION_WITH_NOTES)).toBe(true);
  });

  it("detects the v2.1.173 footer when soft-wrapped across rows", () => {
    expect(screenHasClaudePrompt(ASK_USER_QUESTION_WRAPPED)).toBe(true);
  });
});

describe("screenHasClaudePrompt — permission gates", () => {
  it("detects the edit-family gate via its 'Tab to amend' footer", () => {
    expect(screenHasClaudePrompt(WRITE_PERMISSION)).toBe(true);
  });

  it("detects other gates via the 'don't ask again for' option", () => {
    expect(screenHasClaudePrompt(WEBFETCH_PERMISSION)).toBe(true);
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

  it("ignores prose where '·' trails the object, not the nav hint", () => {
    expect(screenHasClaudePrompt(PROSE_NAVIGATE_WITH_SEPARATOR)).toBe(false);
  });

  it("ignores ordinary assistant prose", () => {
    expect(screenHasClaudePrompt(PLAIN_ASSISTANT_TEXT)).toBe(false);
  });

  it("ignores prose mentioning 'Tab to amend' outside the gate footer", () => {
    expect(screenHasClaudePrompt(PROSE_TAB_TO_AMEND)).toBe(false);
  });

  it("ignores prose mentioning 'don't ask again' outside a numbered gate option", () => {
    expect(screenHasClaudePrompt(PROSE_DONT_ASK_AGAIN)).toBe(false);
  });
});

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
    startedAt: null,
  };
}

describe("isScreenPollable", () => {
  it("is true for the working states a pending prompt can leave on disk", () => {
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

    expect(promoted).toEqual({ ...info, state: "awaiting_user" });
  });

  it("lifts from thinking too (the real AskUserQuestion flow)", () => {
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
