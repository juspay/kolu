import { ToolFailure } from "@kolu/surface-mcp";
import { sendShapeRefusal } from "@kolu/terminal-protocol";
import { describe, expect, it } from "vitest";
import { resolveSendInputData, type SendRefusal } from "./sendInput.ts";

const ANY_VOCABULARY = { keyName: "key", submitRitual: "" };

const write = (args: { text?: string; key?: string }) =>
  resolveSendInputData(args).write;

const refusalFrom = (args: {
  text?: string;
  key?: string;
}): ToolFailure<SendRefusal> => {
  try {
    resolveSendInputData(args);
  } catch (e) {
    if (e instanceof ToolFailure) return e as ToolFailure<SendRefusal>;
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
    expect(() => resolveSendInputData({ text: "" })).toThrow(
      /nothing to send — text is empty\./,
    );
    expect(() => resolveSendInputData({ text: "" })).toThrow(
      /use key to send a key/,
    );
  });
});

describe("resolveSendInputData — every refusal reaches the agent as DATA", () => {
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

  it("the KEYS branch's other shared refusal — an empty name list — is unreachable from this face", () => {
    const empty = refusalFrom({ key: "" });
    expect(empty.detail).toEqual({ kind: "key-refused", key: "" });
    expect(empty.message).toMatch(/unknown key/);
    expect(empty.message).not.toMatch(/named no keys/);
  });

  it("`text-and-key` stays sound: the shape gate refuses exactly ONE of its four inputs", () => {
    const refusedShapes = [
      { hasText: false, hasKeys: false },
      { hasText: true, hasKeys: false },
      { hasText: false, hasKeys: true },
      { hasText: true, hasKeys: true },
    ].filter((shape) => sendShapeRefusal(shape, ANY_VOCABULARY) !== undefined);

    expect(refusedShapes).toEqual([{ hasText: true, hasKeys: true }]);
  });

  it("an empty text and no input at all are DIFFERENT refusals", () => {
    expect(refusalFrom({ text: "" }).detail).toEqual({ kind: "text-refused" });
    expect(refusalFrom({}).detail).toEqual({ kind: "no-input" });
  });
});

describe("resolveSendInputData — the byte count the tool acknowledges", () => {
  it("is the encoder's own UTF-8 total, markers included, not a recount", () => {
    expect(resolveSendInputData({ text: "é" }).bytes).toBe(2);
    const multiline = resolveSendInputData({ text: "a\nb" });
    expect(multiline.paste).toBe(true);
    expect(multiline.bytes).toBe(15);
  });
});
