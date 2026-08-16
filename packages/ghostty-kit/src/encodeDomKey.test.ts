import { describe, expect, it } from "vitest";
import { encodeDomKey } from "./encodeDomKey.ts";

describe("encodeDomKey — the textarea onKeyDown encoder", () => {
  it("encodes Delete, Home, End, Page, Insert, and F1–F12", () => {
    expect(encodeDomKey({ key: "Delete" })).toBe("\x1b[3~");
    expect(encodeDomKey({ key: "Insert" })).toBe("\x1b[2~");
    expect(encodeDomKey({ key: "Home" })).toBe("\x1b[H");
    expect(encodeDomKey({ key: "End" })).toBe("\x1b[F");
    expect(encodeDomKey({ key: "PageUp" })).toBe("\x1b[5~");
    expect(encodeDomKey({ key: "PageDown" })).toBe("\x1b[6~");
    expect(encodeDomKey({ key: "F1" })).toBe("\x1bOP");
    expect(encodeDomKey({ key: "F12" })).toBe("\x1b[24~");
  });

  it("prefixes Alt chords with ESC", () => {
    expect(encodeDomKey({ key: "b", altKey: true })).toBe("\x1bb");
    expect(encodeDomKey({ key: "Enter", altKey: true })).toBe("\x1b\r");
  });

  it("sends application-cursor arrows when DECCKM is on", () => {
    expect(encodeDomKey({ key: "ArrowUp" })).toBe("\x1b[A");
    expect(encodeDomKey({ key: "ArrowUp" }, { applicationCursor: true })).toBe(
      "\x1bOA",
    );
    expect(
      encodeDomKey({ key: "ArrowLeft" }, { applicationCursor: true }),
    ).toBe("\x1bOD");
  });

  it("still maps Ctrl+C to ETX", () => {
    expect(encodeDomKey({ key: "c", ctrlKey: true })).toBe("\x03");
  });
});
