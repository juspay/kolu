/**
 * `RightPanelPerTerminalStateSchema` — the per-terminal right-panel record. The
 * load-bearing invariant pinned here is BACKWARD COMPATIBILITY of the `collapsed`
 * field added when the panel's collapsed posture moved off the global preference
 * to follow the terminal (#959): the field carries a schema `.default(false)`, so
 * a `rightPanel` record persisted BEFORE the field existed (only
 * `activeTab`/`codeMode`) must parse back as OPEN with no migration — the shipped
 * runtime default. Without the default, session restore would reject every
 * pre-#959 terminal record.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  RightPanelPerTerminalStateSchema,
} from "./chromeVocab.ts";

describe("RightPanelPerTerminalStateSchema — collapsed is backward-compatible", () => {
  it("parses a LEGACY record (no `collapsed`) back as open (collapsed: false)", () => {
    // A record persisted before #959 carried only the task fields.
    const legacy = {
      activeTab: "code",
      codeMode: "branch",
      selectedFileByMode: { local: "a.ts", branch: "b.ts", browse: "c.ts" },
    };
    const parsed = RightPanelPerTerminalStateSchema.parse(legacy);
    expect(parsed.collapsed).toBe(false);
    // The rest of the legacy record survives untouched.
    expect(parsed.activeTab).toBe("code");
    expect(parsed.codeMode).toBe("branch");
  });

  it("keeps an explicit collapsed:true (a post-#959 record round-trips)", () => {
    const parsed = RightPanelPerTerminalStateSchema.parse({
      collapsed: true,
      activeTab: "inspector",
      codeMode: "browse",
    });
    expect(parsed.collapsed).toBe(true);
  });

  it("the shipped per-terminal default reads as open", () => {
    expect(DEFAULT_RIGHT_PANEL_PER_TERMINAL.collapsed).toBe(false);
  });
});
