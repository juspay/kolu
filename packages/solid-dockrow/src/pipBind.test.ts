import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { PipVariant } from "@kolu/solid-statepip/pipVariant";
import { describe, expect, it } from "vitest";
import { type DockRowBucket, pipGlyphFor, pipVariant } from "./pipBind.ts";

const cases: Array<[DockRowBucket, PipVariant]> = [
  ["awaiting", "awaiting"],
  ["linger", "linger"],
  ["working", "working"],
  ["idle", "idle"],
  ["none", "empty"],
  ["parked", "empty"],
  ["sleeping", "sleeping"],
];

describe("pipVariant", () => {
  for (const [bucket, expected] of cases) {
    it(`${bucket} → ${expected}`, () => {
      expect(pipVariant(bucket)).toBe(expected);
    });
  }

  it("idle is the shell identity paint (not empty) so non-agent rows get a core", () => {
    expect(pipVariant("idle")).toBe("idle");
    expect(pipVariant("none")).toBe("empty");
  });
});

describe("pipGlyphFor", () => {
  it("live agent kind wins", () => {
    const meta = {
      state: "active",
      agent: { kind: "grok", state: "thinking" },
    } as unknown as TerminalMetadata;
    expect(pipGlyphFor(meta)).toBe("grok");
  });

  it("sleeping row keeps the persisted exact identity", () => {
    const meta = {
      state: "sleeping",
      agent: null,
      restoreTarget: {
        kind: "exact",
        command: "claude",
        agent: { kind: "claude-code", sessionId: "abc" },
      },
    } as unknown as TerminalMetadata;
    expect(pipGlyphFor(meta)).toBe("claude-code");
  });

  it("plain shell (no agent, no exact restore) is the shell glyph", () => {
    expect(
      pipGlyphFor({
        state: "active",
        agent: null,
      } as unknown as TerminalMetadata),
    ).toBe("shell");
    expect(
      pipGlyphFor({
        state: "sleeping",
        agent: null,
        restoreTarget: { kind: "none" },
      } as unknown as TerminalMetadata),
    ).toBe("shell");
  });
});
