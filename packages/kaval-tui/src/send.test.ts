import { describe, expect, it } from "vitest";
import {
  planSend,
  rejectUnknownSendFlags,
  resolveSendInput,
  sourceIsStream,
  sourceLabel,
} from "./send.ts";

const START = "\x1b[200~";
const END = "\x1b[201~";

describe("resolveSendInput — the arg-legality matrix", () => {
  const base = {
    hasPositional: false,
    file: undefined as string | undefined,
    stdinIsPayload: false,
    hasKeys: false,
    paste: false,
    noPaste: false,
  };

  it("resolves each single text source into a descriptor carrying its payload locus", () => {
    expect(resolveSendInput({ ...base, hasPositional: true })).toEqual({
      kind: "positional",
    });
    // the --file path rides the descriptor (no separate channel, no cast)
    expect(resolveSendInput({ ...base, file: "/tmp/brief.md" })).toEqual({
      kind: "file",
      path: "/tmp/brief.md",
    });
    expect(resolveSendInput({ ...base, stdinIsPayload: true })).toEqual({
      kind: "stdin",
    });
  });

  it("a keys-only send has no text source", () => {
    expect(resolveSendInput({ ...base, hasKeys: true })).toEqual({
      kind: "none",
    });
  });

  it("--paste and --no-paste together are rejected (folded into this validator)", () => {
    expect(() =>
      resolveSendInput({
        ...base,
        hasPositional: true,
        paste: true,
        noPaste: true,
      }),
    ).toThrow(/mutually exclusive/);
  });

  it("text + --key is a hard error teaching the two-command flow", () => {
    // The core fix: the dropped-Enter trap is unspellable, not warned about.
    const err = () =>
      resolveSendInput({ ...base, hasPositional: true, hasKeys: true });
    expect(err).toThrow(/can't be combined/);
    expect(err).toThrow(/--key Enter/); // it teaches the submit-as-its-own-command step
  });

  it("a text source from ANY channel + --key is rejected (file, stdin too)", () => {
    expect(() =>
      resolveSendInput({ ...base, file: "/tmp/x.md", hasKeys: true }),
    ).toThrow(/can't be combined/);
    expect(() =>
      resolveSendInput({ ...base, stdinIsPayload: true, hasKeys: true }),
    ).toThrow(/can't be combined/);
  });

  it("--file + positional text is rejected (two sources for one payload)", () => {
    const err = () =>
      resolveSendInput({ ...base, file: "/tmp/x.md", hasPositional: true });
    expect(err).toThrow(/each provide the send text/);
    expect(err).toThrow(/--file/);
  });

  it("--file + piped stdin is rejected", () => {
    const err = () =>
      resolveSendInput({ ...base, file: "/tmp/x.md", stdinIsPayload: true });
    expect(err).toThrow(/each provide the send text/);
  });

  it("positional + piped stdin is rejected (uniform: at most one source)", () => {
    expect(() =>
      resolveSendInput({ ...base, hasPositional: true, stdinIsPayload: true }),
    ).toThrow(/each provide the send text/);
  });

  it("a wholly empty send (no text, no keys) has nothing to do", () => {
    expect(() => resolveSendInput({ ...base })).toThrow(/nothing to send/);
  });
});

describe("rejectUnknownSendFlags — no silently-ignored flag on send", () => {
  it("no unknown flags → does not throw", () => {
    expect(() => rejectUnknownSendFlags([])).not.toThrow();
  });

  it("--submit gets a migration message pointing at the two-command pattern", () => {
    const err = () => rejectUnknownSendFlags(["submit"]);
    expect(err).toThrow(/--submit was removed/);
    expect(err).toThrow(/--key Enter/); // teaches the separate submit step
  });

  it("--submit takes precedence even mixed with another unknown flag", () => {
    expect(() => rejectUnknownSendFlags(["bogus", "submit"])).toThrow(
      /--submit was removed/,
    );
  });

  it("any other unknown flag fails generically, naming it", () => {
    const err = () => rejectUnknownSendFlags(["bogus"]);
    expect(err).toThrow(/unknown flag for send: --bogus/);
  });

  it("pluralizes for multiple unknown flags", () => {
    expect(() => rejectUnknownSendFlags(["foo", "bar"])).toThrow(
      /unknown flags for send: --foo, --bar/,
    );
  });
});

describe("sourceIsStream — --file / stdin auto-paste as a block", () => {
  it("is true for file and stdin, false for positional and none", () => {
    expect(sourceIsStream({ kind: "file", path: "/x" })).toBe(true);
    expect(sourceIsStream({ kind: "stdin" })).toBe(true);
    expect(sourceIsStream({ kind: "positional" })).toBe(false);
    expect(sourceIsStream({ kind: "none" })).toBe(false);
  });
});

describe("sourceLabel — the one home for each source's human name", () => {
  it("names each source, and the --file label carries its path", () => {
    expect(sourceLabel({ kind: "positional" })).toBe("positional text");
    expect(sourceLabel({ kind: "file", path: "/tmp/brief.md" })).toBe(
      '--file "/tmp/brief.md"',
    );
    expect(sourceLabel({ kind: "stdin" })).toBe("piped stdin");
    expect(sourceLabel({ kind: "none" })).toBe("no text source");
  });

  it("the two-sources error is built from it (path included)", () => {
    expect(() =>
      resolveSendInput({
        hasPositional: true,
        file: "/tmp/x.md",
        stdinIsPayload: false,
        hasKeys: false,
        paste: false,
        noPaste: false,
      }),
    ).toThrow(/positional text and --file "\/tmp\/x.md"/);
  });
});

describe("planSend — building the single write", () => {
  it("a single-line argument is written literally — NO implicit Enter", () => {
    const plan = planSend({
      kind: "text",
      text: "fix the parser",
      paste: undefined,
      fromStream: false,
    });
    expect(plan.write).toBe("fix the parser");
    expect(plan.paste).toBe(false);
    expect(plan.bytes).toBe(Buffer.byteLength("fix the parser"));
  });

  it("multiline text auto-pastes as one block, NO trailing Enter", () => {
    const text = "line one\nline two";
    const plan = planSend({
      kind: "text",
      text,
      paste: undefined,
      fromStream: false,
    });
    expect(plan.write).toBe(`${START}${text}${END}`);
    expect(plan.paste).toBe(true);
  });

  it("a stream payload (--file / piped stdin) auto-pastes even when single-line", () => {
    const plan = planSend({
      kind: "text",
      text: "do the thing",
      paste: undefined,
      fromStream: true,
    });
    expect(plan.write).toBe(`${START}do the thing${END}`);
    expect(plan.paste).toBe(true);
  });

  it("--no-paste forces literal even for multiline", () => {
    const text = "a\nb";
    const plan = planSend({
      kind: "text",
      text,
      paste: false,
      fromStream: false,
    });
    expect(plan.write).toBe(text);
    expect(plan.paste).toBe(false);
  });

  it("--paste forces a bracket wrap for a single-line argument", () => {
    const plan = planSend({
      kind: "text",
      text: "hi",
      paste: true,
      fromStream: false,
    });
    expect(plan.write).toBe(`${START}hi${END}`);
    expect(plan.paste).toBe(true);
  });

  it("refuses an empty text arm — a 0-byte write is a no-op, not a submit", () => {
    // A direct caller can't mint a no-op plan from an empty --file / empty pipe /
    // empty positional; the plan boundary rejects it (cmdSend catches it first
    // with a source-named error).
    expect(() =>
      planSend({ kind: "text", text: "", paste: undefined, fromStream: false }),
    ).toThrow(/empty text send/);
    expect(() =>
      planSend({ kind: "text", text: "", paste: true, fromStream: true }),
    ).toThrow(/empty text send/);
  });

  it("keys-only (no text) sends just the key bytes", () => {
    const plan = planSend({ kind: "keys", keyData: "\x03" });
    expect(plan.write).toBe("\x03");
    expect(plan.paste).toBe(false);
    expect(plan.bytes).toBe(1);
  });

  it("counts total UTF-8 bytes of the write", () => {
    const text = "café\nlatte"; // é is 2 bytes, the \n forces paste
    const plan = planSend({
      kind: "text",
      text,
      paste: undefined,
      fromStream: false,
    });
    expect(plan.bytes).toBe(Buffer.byteLength(`${START}${text}${END}`));
  });
});
