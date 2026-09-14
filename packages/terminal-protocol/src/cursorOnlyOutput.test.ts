import { describe, expect, it } from "vitest";
import { isCursorOnlyOutput } from "./cursorOnlyOutput.ts";

// Recorded verbatim from a real `xyne` in a PTY while visually idle: v0.4.1
// emits the chat-screen frame ~30×/s forever; v0.4.8's landing screen emits
// its frame ~3×/s.
const XYNE_IDLE_CHAT_FRAME =
  "\x1b[?2026h\x1b[?25l\x1b[0m\x1b[36;6H\x1b[?25h\x1b[?2026l";
const XYNE_IDLE_LANDING_FRAME =
  "\x1b[?2026h\x1b[?25l\x1b[0m\x1b[18;30H\x1b[?25h\x1b[?2026l";

describe("isCursorOnlyOutput", () => {
  it("accepts Xyne's idle repaint frames", () => {
    expect(isCursorOnlyOutput(XYNE_IDLE_CHAT_FRAME)).toBe(true);
    expect(isCursorOnlyOutput(XYNE_IDLE_LANDING_FRAME)).toBe(true);
    expect(isCursorOnlyOutput(XYNE_IDLE_CHAT_FRAME.repeat(3))).toBe(true);
  });

  it("accepts the other listed cursor sequences", () => {
    expect(isCursorOnlyOutput("\x1b[H\x1b[2A\x1b[3C\x1b[10G\x1b[5d")).toBe(
      true,
    );
    expect(isCursorOnlyOutput("\x1b7\x1b[38:2::255:0:0m\x1b8")).toBe(true);
    expect(isCursorOnlyOutput("\x1b[?12;25h")).toBe(true);
  });

  it("rejects any printable text, even inside a cursor-only frame", () => {
    expect(isCursorOnlyOutput("x")).toBe(false);
    expect(
      isCursorOnlyOutput(
        "\x1b[?2026h\x1b[36;6H\x1b[1m⠋\x1b[0m\x1b[36;6H\x1b[?2026l",
      ),
    ).toBe(false);
  });

  it("rejects sequences that change cells or the screen", () => {
    expect(isCursorOnlyOutput("\x1b[2J")).toBe(false); // erase display
    expect(isCursorOnlyOutput("\x1b[K")).toBe(false); // erase line
    expect(isCursorOnlyOutput("\x1b[S")).toBe(false); // scroll up
    expect(isCursorOnlyOutput("\x1b[?1049h")).toBe(false); // alt screen
    expect(isCursorOnlyOutput("\x1b[?25;1049h")).toBe(false);
    expect(isCursorOnlyOutput("\x1b]2;title\x07")).toBe(false); // OSC
    expect(isCursorOnlyOutput("\r\n")).toBe(false);
    expect(isCursorOnlyOutput("\x07")).toBe(false); // bell
  });

  it("rejects a sequence split across chunks and the empty chunk", () => {
    expect(isCursorOnlyOutput("\x1b[36;")).toBe(false);
    expect(isCursorOnlyOutput("6H")).toBe(false);
    expect(isCursorOnlyOutput("")).toBe(false);
  });
});
