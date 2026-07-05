import { NAMED_KEY_BYTES } from "@kolu/terminal-protocol";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_KEY_NAMES,
  encodeKey,
  planSend,
  rejectUnknownSendFlags,
  resolveSendInput,
  sourceIsStream,
} from "./send.ts";

const START = "\x1b[200~";
const END = "\x1b[201~";

describe("encodeKey — named keys and modifier chords", () => {
  it("maps named keys case-insensitively to their bytes", () => {
    expect(encodeKey("Enter")).toBe("\r");
    expect(encodeKey("return")).toBe("\r");
    expect(encodeKey("Escape")).toBe("\x1b");
    expect(encodeKey("esc")).toBe("\x1b");
    expect(encodeKey("Tab")).toBe("\t");
    expect(encodeKey("Space")).toBe(" ");
    expect(encodeKey("Backspace")).toBe("\x7f");
  });

  it("uses the normal-cursor (CSI) form for arrows", () => {
    expect(encodeKey("Up")).toBe("\x1b[A");
    expect(encodeKey("down")).toBe("\x1b[B");
    expect(encodeKey("Right")).toBe("\x1b[C");
    expect(encodeKey("LEFT")).toBe("\x1b[D");
    expect(encodeKey("Home")).toBe("\x1b[H");
    expect(encodeKey("End")).toBe("\x1b[F");
  });

  it("folds C-<char> chords to their control byte", () => {
    expect(encodeKey("C-c")).toBe("\x03");
    expect(encodeKey("C-a")).toBe("\x01");
    expect(encodeKey("c-z")).toBe("\x1a"); // case-insensitive prefix + letter
    expect(encodeKey("C-[")).toBe("\x1b"); // 0x5b & 0x1f = 0x1b
    expect(encodeKey("C-space")).toBeUndefined(); // only a single char after C-
    expect(encodeKey("C- ")).toBe("\x00"); // Ctrl+Space → NUL
  });

  it("prefixes ESC for M-<char> (meta/alt), char verbatim", () => {
    expect(encodeKey("M-b")).toBe("\x1bb");
    expect(encodeKey("m-B")).toBe("\x1bB");
    expect(encodeKey("M-.")).toBe("\x1b.");
  });

  it("returns undefined for unknown names and unmappable chords", () => {
    expect(encodeKey("Foo")).toBeUndefined();
    expect(encodeKey("C-1")).toBeUndefined(); // digit has no control byte
    expect(encodeKey("")).toBeUndefined();
    expect(encodeKey("C-")).toBeUndefined(); // no char after the chord prefix
  });
});

describe("ACCEPTED_KEY_NAMES — the help vocabulary stays in lockstep with the table", () => {
  // Split the human string into individual tokens: comma-separated, with the
  // arrow cluster joined by slashes (`Up/Down/Left/Right`).
  const tokens = ACCEPTED_KEY_NAMES.split(",")
    .flatMap((s) => s.split("/"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  it("every advertised name resolves via encodeKey", () => {
    for (const name of tokens) {
      expect(encodeKey(name), `advertised key "${name}" must encode`).not.toBe(
        undefined,
      );
    }
  });

  it("reaches every byte in NAMED_KEY_BYTES (a new key can't drift the help)", () => {
    const advertised = new Set(tokens.map((t) => encodeKey(t)));
    for (const [name, bytes] of Object.entries(NAMED_KEY_BYTES)) {
      expect(
        advertised.has(bytes),
        `key "${name}" (${JSON.stringify(bytes)}) is in NAMED_KEY_BYTES but not reachable from ACCEPTED_KEY_NAMES — add it`,
      ).toBe(true);
    }
  });
});

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

describe("planSend — building the ordered writes", () => {
  it("a single-line argument is written literally — NO implicit Enter", () => {
    const plan = planSend({
      text: "fix the parser",
      paste: undefined,
      fromStream: false,
      keyData: "",
    });
    expect(plan.writes).toEqual(["fix the parser"]);
    expect(plan.paste).toBe(false);
    expect(plan.bytes).toBe(Buffer.byteLength("fix the parser"));
  });

  it("multiline text auto-pastes as one block, NO trailing Enter", () => {
    const text = "line one\nline two";
    const plan = planSend({
      text,
      paste: undefined,
      fromStream: false,
      keyData: "",
    });
    expect(plan.writes).toEqual([`${START}${text}${END}`]);
    expect(plan.paste).toBe(true);
  });

  it("a stream payload (--file / piped stdin) auto-pastes even when single-line", () => {
    const plan = planSend({
      text: "do the thing",
      paste: undefined,
      fromStream: true,
      keyData: "",
    });
    expect(plan.writes).toEqual([`${START}do the thing${END}`]);
    expect(plan.paste).toBe(true);
  });

  it("--no-paste forces literal even for multiline", () => {
    const text = "a\nb";
    const plan = planSend({
      text,
      paste: false,
      fromStream: false,
      keyData: "",
    });
    expect(plan.writes).toEqual([text]);
    expect(plan.paste).toBe(false);
  });

  it("--paste forces a bracket wrap for a single-line argument", () => {
    const plan = planSend({
      text: "hi",
      paste: true,
      fromStream: false,
      keyData: "",
    });
    expect(plan.writes).toEqual([`${START}hi${END}`]);
    expect(plan.paste).toBe(true);
  });

  it("keys-only (no text) sends just the key bytes", () => {
    const plan = planSend({
      text: "",
      paste: undefined,
      fromStream: false,
      keyData: "\x03",
    });
    expect(plan.writes).toEqual(["\x03"]);
    expect(plan.paste).toBe(false);
    expect(plan.bytes).toBe(1);
  });

  it("counts total UTF-8 bytes of the write", () => {
    const text = "café\nlatte"; // é is 2 bytes, the \n forces paste
    const plan = planSend({
      text,
      paste: undefined,
      fromStream: false,
      keyData: "",
    });
    expect(plan.bytes).toBe(Buffer.byteLength(`${START}${text}${END}`));
  });
});
