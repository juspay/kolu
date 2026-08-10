/**
 * `resolveSendInputData` — the text-XOR-key matrix and the key grammar, pinned
 * apart from the wire (the tool handler is a thin sendInput call over this).
 */
import { describe, expect, it } from "vitest";
import { resolveSendInputData } from "./sendInput.ts";

const write = (args: { text?: string; key?: string }) =>
  resolveSendInputData(args).write;

describe("resolveSendInputData — the arg-legality matrix", () => {
  it("text resolves to itself when single-line", () => {
    expect(write({ text: "hello" })).toBe("hello");
  });

  it("multiline text is bracketed-paste wrapped (kaval-tui's auto rule)", () => {
    expect(write({ text: "a\nb" })).toBe("\x1b[200~a\nb\x1b[201~");
  });

  it("a named key resolves through the shared vocabulary", () => {
    expect(write({ key: "Enter" })).toBe("\r");
    expect(write({ key: "escape" })).toBe("\x1b");
    expect(write({ key: "C-c" })).toBe("\x03");
    expect(write({ key: "M-b" })).toBe("\x1bb");
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

  it("an EMPTY text is refused, not written as a 0-byte success", () => {
    // The divergence this closes: argv refuses an empty payload, and this face
    // used to encode a 0-byte write and answer `{ sent: { textBytes: 0 } }` —
    // so an agent whose prompt template rendered empty got "ok". The sentence is
    // the shared policy's, spoken in THIS face's vocabulary.
    expect(() => resolveSendInputData({ text: "" })).toThrow(
      /nothing to send — text is empty\./,
    );
    expect(() => resolveSendInputData({ text: "" })).toThrow(
      /use key to send a key/,
    );
  });
});

describe("resolveSendInputData — the byte count the tool acknowledges", () => {
  it("is the encoder's own UTF-8 total, markers included, not a recount", () => {
    // `kolu send` reports `plan.bytes` for the identical send; recomputing it at
    // the handler is how the two faces come to disagree about the same write.
    // `.length` would say 1 for this one UTF-16 unit.
    expect(resolveSendInputData({ text: "é" }).bytes).toBe(2);
    const multiline = resolveSendInputData({ text: "a\nb" });
    expect(multiline.paste).toBe(true);
    // 3 bytes of text PLUS the two 6-byte bracketed-paste markers: what the
    // wire carried, not what the caller passed.
    expect(multiline.bytes).toBe(15);
  });
});
