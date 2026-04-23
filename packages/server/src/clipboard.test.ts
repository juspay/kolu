import { describe, expect, it } from "vitest";
import type { TerminalMetadata } from "kolu-common";
import { dispatchPastedImage } from "./clipboard.ts";

function meta(overrides: Partial<TerminalMetadata> = {}): TerminalMetadata {
  return {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    sortOrder: 1000,
    ...overrides,
  };
}

describe("dispatchPastedImage", () => {
  it("keeps raw ctrl-v behavior for non-codex terminals", () => {
    expect(dispatchPastedImage(meta(), "/tmp/image.png")).toBe("\x16");
  });

  it("uses bracketed-paste path input for codex foreground processes", () => {
    expect(
      dispatchPastedImage(
        meta({ foreground: { name: "codex", title: "codex" } }),
        "/tmp/image.png",
      ),
    ).toBe("\x1b[200~/tmp/image.png\x1b[201~");
  });

  it("falls back to codex agent metadata if foreground lags", () => {
    expect(
      dispatchPastedImage(
        meta({
          agent: {
            kind: "codex",
            state: "waiting",
            sessionId: "session-1",
            model: null,
            summary: null,
            taskProgress: null,
            contextTokens: null,
          },
        }),
        "/tmp/image.png",
      ),
    ).toBe("\x1b[200~/tmp/image.png\x1b[201~");
  });
});
