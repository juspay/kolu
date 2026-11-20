import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  RightPanelPerTerminalStateSchema,
} from "./chromeVocab.ts";

const decodeRightPanel = Schema.decodeUnknownSync(
  RightPanelPerTerminalStateSchema,
);
const encodeRightPanel = Schema.encodeUnknownSync(
  RightPanelPerTerminalStateSchema,
);

describe("RightPanelPerTerminalStateSchema — collapsed is backward-compatible", () => {
  it("parses a LEGACY record (no `collapsed`) back as open (collapsed: false)", () => {
    const legacy = {
      activeTab: "code",
      codeMode: "branch",
      selectedFileByMode: { local: "a.ts", branch: "b.ts", browse: "c.ts" },
    };
    const parsed = decodeRightPanel(legacy);
    expect(parsed.collapsed).toBe(false);
    expect(parsed.activeTab).toBe("code");
    expect(parsed.codeMode).toBe("branch");
  });

  it("keeps an explicit collapsed:true (a post-#959 record round-trips)", () => {
    const parsed = decodeRightPanel({
      collapsed: true,
      activeTab: "inspector",
      codeMode: "browse",
    });
    expect(parsed.collapsed).toBe(true);
  });

  it("the shipped per-terminal default reads as open", () => {
    expect(DEFAULT_RIGHT_PANEL_PER_TERMINAL.collapsed).toBe(false);
  });

  it("BYTES: a backfilled record re-encodes WITH the key (zod `.default(false)`'s emit half)", () => {
    expect(
      JSON.stringify(
        encodeRightPanel(
          decodeRightPanel({ activeTab: "code", codeMode: "browse" }),
        ),
      ),
    ).toBe('{"collapsed":false,"activeTab":"code","codeMode":"browse"}');
  });

  it("BYTES: a populated record round-trips byte-for-byte", () => {
    const stored =
      '{"collapsed":true,"activeTab":"inspector","codeMode":"local","selectedFileByMode":{"local":"a.ts"}}';
    expect(
      JSON.stringify(encodeRightPanel(decodeRightPanel(JSON.parse(stored)))),
    ).toBe(stored);
  });

  it("an EXPLICIT undefined collapsed is REJECTED — absent is the only spelling", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(RightPanelPerTerminalStateSchema)({
          collapsed: undefined,
          activeTab: "code",
          codeMode: "browse",
        }),
      ),
    ).toBe(true);
  });

  it("an ABSENT selectedFileByMode stays ABSENT, never null", () => {
    const encoded = encodeRightPanel(
      decodeRightPanel({ activeTab: "code", codeMode: "browse" }),
    ) as Record<string, unknown>;
    expect("selectedFileByMode" in encoded).toBe(false);
  });
});
