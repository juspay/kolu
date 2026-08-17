import { describe, expect, it } from "vitest";
import {
  applyCursorKeyMode,
  scanOsc52,
  scanOsc633E,
  shiftsVisualWithoutTotal,
  takeCompleteVt,
  VT_LEFTOVER_MAX,
} from "./vtSpan.ts";

describe("takeCompleteVt", () => {
  it("holds an incomplete CSI until the next chunk", () => {
    const first = takeCompleteVt("", "hello\x1b[6");
    expect(first.complete).toBe("hello");
    expect(first.leftover).toBe("\x1b[6");
    const second = takeCompleteVt(first.leftover, "n");
    expect(second.complete).toBe("\x1b[6n");
    expect(second.leftover).toBe("");
  });

  it("holds a split OSC 633;E", () => {
    const first = takeCompleteVt("", "\x1b]633;E;npm te");
    expect(first.complete).toBe("");
    const second = takeCompleteVt(first.leftover, "st\x07");
    expect(second.complete).toContain("npm test");
    const cmds: string[] = [];
    scanOsc633E(second.complete, (c) => cmds.push(c));
    expect(cmds).toEqual(["npm test"]);
  });

  it("discards an unterminated OSC past the leftover cap", () => {
    let leftover = takeCompleteVt("", "\x1b]").leftover;
    for (let i = 0; i < 8; i++) {
      const next = takeCompleteVt(leftover, "x".repeat(1000));
      leftover = next.leftover;
      expect(leftover.length).toBeLessThanOrEqual(VT_LEFTOVER_MAX);
    }
    expect(leftover).toBe("");
    const later = takeCompleteVt(
      leftover,
      "\x1b]52;c;Zm9v\x07\x1b]633;E;ls\x07",
    );
    const clips: string[] = [];
    const cmds: string[] = [];
    scanOsc52(later.complete, (_sel, payload) => clips.push(payload));
    scanOsc633E(later.complete, (c) => cmds.push(c));
    expect(clips).toEqual(["Zm9v"]);
    expect(cmds).toEqual(["ls"]);
  });
});

describe("scanOsc52", () => {
  it("extracts a clipboard payload", () => {
    const got: { sel: string; payload: string }[] = [];
    scanOsc52("\x1b]52;c;Zm9v\x07", (sel, payload) =>
      got.push({ sel, payload }),
    );
    expect(got).toEqual([{ sel: "c", payload: "Zm9v" }]);
  });
});

describe("applyCursorKeyMode", () => {
  it("turns on for DECSET 1 and off for RIS", () => {
    expect(applyCursorKeyMode("\x1b[?1h", false)).toBe(true);
    expect(applyCursorKeyMode("\x1bc", true)).toBe(false);
  });
});

describe("shiftsVisualWithoutTotal", () => {
  it("detects ED and alt-screen, not a plain newline", () => {
    expect(shiftsVisualWithoutTotal("hello\r\n")).toBe(false);
    expect(shiftsVisualWithoutTotal("\x1b[2J")).toBe(true);
    expect(shiftsVisualWithoutTotal("\x1b[J")).toBe(true);
    expect(shiftsVisualWithoutTotal("\x1b[?1049h")).toBe(true);
    expect(shiftsVisualWithoutTotal("\x1b[?1049l")).toBe(true);
    expect(shiftsVisualWithoutTotal("\x1b[?47h")).toBe(true);
  });
});
