import { describe, expect, it } from "vitest";
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "@kolu/terminal-protocol";
import { planComposeSend } from "./composeSend";

describe("planComposeSend", () => {
  it("writes single-line text verbatim (no bracketed paste, no Enter)", () => {
    expect(planComposeSend("deploy the staging build")).toBe(
      "deploy the staging build",
    );
  });

  it("brackets multiline text so it lands as one block", () => {
    const draft = "line one\nline two\nline three";
    expect(planComposeSend(draft)).toBe(
      `${BRACKETED_PASTE_START}${draft}${BRACKETED_PASTE_END}`,
    );
  });

  it("never synthesizes a submit Enter — the plan ends with the text", () => {
    // The honest-send contract: the write carries the draft and nothing more.
    // Neither branch may append a trailing CR/LF of its own.
    expect(planComposeSend("run tests")).not.toMatch(/[\r\n]$/);
    const multi = planComposeSend("a\nb");
    expect(multi).toBe(`${BRACKETED_PASTE_START}a\nb${BRACKETED_PASTE_END}`);
    // The only newline is the interior one the user typed, inside the markers.
    expect(multi?.endsWith(BRACKETED_PASTE_END)).toBe(true);
  });

  it("preserves the draft verbatim, including leading/trailing whitespace", () => {
    expect(planComposeSend("  keep my spacing  ")).toBe("  keep my spacing  ");
  });

  it("returns null for an empty draft (nothing to send)", () => {
    expect(planComposeSend("")).toBeNull();
  });

  it("returns null for a whitespace-only draft", () => {
    expect(planComposeSend("   \n\t  ")).toBeNull();
  });
});
