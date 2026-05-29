import { describe, expect, it } from "vitest";
import { mergeClaudeHooks } from "./claudeHooks.ts";

const PRE = "'/home/u/.claude/kolu-hooks/awaiting-writer' set";
const POST = "'/home/u/.claude/kolu-hooks/awaiting-writer' clear";

/** Pull the kolu command strings out of one hook event's entries. */
function koluCommands(
  settings: { hooks?: Record<string, unknown[]> },
  event: string,
): string[] {
  const arr = (settings.hooks?.[event] ?? []) as Array<{
    matcher?: string;
    hooks?: Array<{ command?: string }>;
  }>;
  return arr
    .filter((e) => e.matcher === "AskUserQuestion|ExitPlanMode")
    .flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ""));
}

describe("mergeClaudeHooks", () => {
  it("installs both matcher entries into empty settings", () => {
    const { settings, changed } = mergeClaudeHooks({}, PRE, POST);
    expect(changed).toBe(true);
    expect(koluCommands(settings, "PreToolUse")).toEqual([PRE]);
    expect(koluCommands(settings, "PostToolUse")).toEqual([POST]);
  });

  it("treats a non-object (missing/unparseable) input as empty", () => {
    for (const input of [null, undefined, "garbage", 42, [1, 2]]) {
      const { settings, changed } = mergeClaudeHooks(input, PRE, POST);
      expect(changed).toBe(true);
      expect(koluCommands(settings, "PreToolUse")).toEqual([PRE]);
    }
  });

  it("preserves unrelated hooks and other top-level keys", () => {
    const input = {
      model: "opus",
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
        ],
        SessionStart: [{ hooks: [{ type: "command", command: "boot" }] }],
      },
    };
    const { settings } = mergeClaudeHooks(input, PRE, POST);
    expect(settings.model).toBe("opus");
    // Existing Bash entry still present...
    const pre = settings.hooks?.PreToolUse ?? [];
    expect(pre.some((e) => e.matcher === "Bash")).toBe(true);
    // ...alongside ours.
    expect(koluCommands(settings, "PreToolUse")).toEqual([PRE]);
    // Unrelated event untouched.
    expect(settings.hooks?.SessionStart).toEqual(input.hooks.SessionStart);
  });

  it("is idempotent — a re-run adds nothing", () => {
    const first = mergeClaudeHooks({}, PRE, POST);
    expect(first.changed).toBe(true);
    const second = mergeClaudeHooks(first.settings, PRE, POST);
    expect(second.changed).toBe(false);
    expect(koluCommands(second.settings, "PreToolUse")).toEqual([PRE]);
    expect(koluCommands(second.settings, "PostToolUse")).toEqual([POST]);
  });

  it("re-adds only the missing event if the user removed one", () => {
    const full = mergeClaudeHooks({}, PRE, POST).settings;
    // User deleted the PostToolUse entry but kept PreToolUse.
    if (full.hooks) full.hooks.PostToolUse = [];
    const { changed, settings } = mergeClaudeHooks(full, PRE, POST);
    expect(changed).toBe(true);
    expect(koluCommands(settings, "PreToolUse")).toEqual([PRE]); // not duplicated
    expect(koluCommands(settings, "PostToolUse")).toEqual([POST]); // restored
  });

  it("does not mutate the input object", () => {
    const input = { hooks: { PreToolUse: [] as unknown[] } };
    mergeClaudeHooks(input, PRE, POST);
    expect(input.hooks.PreToolUse).toEqual([]);
  });
});
