/**
 * `resolveSendInputData` — the text-XOR-key matrix and the key grammar, pinned
 * apart from the wire (the tool handler is a thin sendInput call over this).
 */
import { ToolFailure } from "@kolu/surface-mcp";
import { describe, expect, it } from "vitest";
import { resolveSendInputData } from "./sendInput.ts";

const write = (args: { text?: string; key?: string }) =>
  resolveSendInputData(args).write;

/** The refusal a call raised, as the agent will receive it: `ToolFailure` is
 *  what `surface-mcp`'s `failFrom` turns into an `isError` result whose
 *  `structuredContent` IS this `detail`. Fails the test if the throw was an
 *  ordinary `Error` — a refusal that lost its detail on the way out is exactly
 *  the regression this file guards. */
const refusalFrom = (args: { text?: string; key?: string }) => {
  try {
    resolveSendInputData(args);
  } catch (e) {
    if (e instanceof ToolFailure) return e;
    throw new Error(`expected a ToolFailure, got ${String(e)}`);
  }
  throw new Error("expected a refusal, but the args resolved");
};

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

describe("resolveSendInputData — every refusal reaches the agent as DATA", () => {
  // A driver's recovery differs per refusal, and picking it out of the prose
  // means matching English. Each of the four rules therefore names itself in
  // `structuredContent`, beside — not instead of — the shared policy's sentence.
  it("text + key says which rule broke, so the driver knows to re-send as two calls", () => {
    const refusal = refusalFrom({ text: "hi", key: "Enter" });
    expect(refusal.detail).toEqual({ kind: "text-and-key" });
    expect(refusal.message).toMatch(/can't be combined/);
  });

  it("a rejected key rides along, so the driver sees the spelling it got wrong", () => {
    expect(refusalFrom({ key: "Bogus" }).detail).toEqual({
      kind: "key-refused",
      key: "Bogus",
    });
  });

  it("an empty text and no input at all are DIFFERENT refusals", () => {
    // Both mean "the driver's own prompt template rendered nothing", which is
    // precisely what a 0-byte "sent" used to hide — but one arrived as a field
    // and the other never arrived, and a driver fixes them in different places.
    expect(refusalFrom({ text: "" }).detail).toEqual({ kind: "text-refused" });
    expect(refusalFrom({}).detail).toEqual({ kind: "no-input" });
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
