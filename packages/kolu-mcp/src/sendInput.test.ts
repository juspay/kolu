/**
 * `resolveSendInputData` — the text-XOR-key matrix and the key grammar, pinned
 * apart from the wire (the tool handler is a thin sendInput call over this).
 */
import { describe, expect, it } from "vitest";
import { resolveSendInputData } from "./sendInput.ts";

describe("resolveSendInputData — the arg-legality matrix", () => {
  it("text resolves to itself when single-line", () => {
    expect(resolveSendInputData({ text: "hello" })).toBe("hello");
  });

  it("multiline text is bracketed-paste wrapped (kaval-tui's auto rule)", () => {
    expect(resolveSendInputData({ text: "a\nb" })).toBe(
      "\x1b[200~a\nb\x1b[201~",
    );
  });

  it("a named key resolves through the shared vocabulary", () => {
    expect(resolveSendInputData({ key: "Enter" })).toBe("\r");
    expect(resolveSendInputData({ key: "escape" })).toBe("\x1b");
    expect(resolveSendInputData({ key: "C-c" })).toBe("\x03");
    expect(resolveSendInputData({ key: "M-b" })).toBe("\x1bb");
  });

  it("text + key in one send is a LOUD error (the dropped-Enter trap)", () => {
    expect(() => resolveSendInputData({ text: "hi", key: "Enter" })).toThrow(
      /can't be combined/,
    );
  });

  it("an unknown key is a loud error, never a silent no-op", () => {
    expect(() => resolveSendInputData({ key: "Bogus" })).toThrow(/unknown key/);
  });

  it("neither text nor key is a loud error", () => {
    expect(() => resolveSendInputData({})).toThrow(/nothing to send/);
  });
});
