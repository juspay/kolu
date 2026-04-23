import { describe, expect, it } from "vitest";
import type { TerminalMetadata } from "kolu-common";
import { dispatchPastedImage, imagePasteMode } from "./clipboard.ts";

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

describe("imagePasteMode", () => {
  it("defaults to raw ctrl-v", () => {
    expect(imagePasteMode(meta())).toBe("raw-ctrl-v");
  });

  it("selects bracketed-path for codex foreground processes", () => {
    expect(
      imagePasteMode(meta({ foreground: { name: "codex", title: "codex" } })),
    ).toBe("bracketed-path");
  });

  it("falls back to codex agent metadata if foreground lags", () => {
    expect(
      imagePasteMode(
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
      ),
    ).toBe("bracketed-path");
  });
});

describe("dispatchPastedImage", () => {
  it("keeps raw ctrl-v behavior for raw-ctrl-v mode", () => {
    expect(dispatchPastedImage("raw-ctrl-v", "/tmp/image.png")).toBe("\x16");
  });

  it("uses bracketed-paste path input for bracketed-path mode", () => {
    expect(dispatchPastedImage("bracketed-path", "/tmp/image.png")).toBe(
      "\x1b[200~/tmp/image.png\x1b[201~",
    );
  });
});
