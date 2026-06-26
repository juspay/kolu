import { NAMED_KEY_BYTES } from "@kolu/terminal-protocol";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_KEY_NAMES,
  encodeKey,
  formatSend,
  planSend,
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

describe("planSend — building the ordered writes", () => {
  it("a single-line argument is written literally — NO implicit Enter", () => {
    const plan = planSend({
      text: "fix the parser",
      paste: undefined,
      fromStdin: false,
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
      fromStdin: false,
      keyData: "",
    });
    expect(plan.writes).toEqual([`${START}${text}${END}`]);
    expect(plan.paste).toBe(true);
  });

  it("piped stdin auto-pastes even when single-line", () => {
    const plan = planSend({
      text: "do the thing",
      paste: undefined,
      fromStdin: true,
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
      fromStdin: false,
      keyData: "",
    });
    expect(plan.writes).toEqual([text]);
    expect(plan.paste).toBe(false);
  });

  it("--paste forces a bracket wrap for a single-line argument", () => {
    const plan = planSend({
      text: "hi",
      paste: true,
      fromStdin: false,
      keyData: "",
    });
    expect(plan.writes).toEqual([`${START}hi${END}`]);
    expect(plan.paste).toBe(true);
  });

  it("text then a --key Enter submit: text first, key its own write", () => {
    const plan = planSend({
      text: "yes",
      paste: undefined,
      fromStdin: false,
      keyData: "\r", // `--key Enter`
    });
    expect(plan.writes).toEqual(["yes", "\r"]);
  });

  it("keys-only (no text) sends just the key bytes", () => {
    const plan = planSend({
      text: "",
      paste: undefined,
      fromStdin: false,
      keyData: "\x03",
    });
    expect(plan.writes).toEqual(["\x03"]);
    expect(plan.paste).toBe(false);
    expect(plan.bytes).toBe(1);
  });

  it("counts total UTF-8 bytes across every write", () => {
    const text = "café\nlatte"; // é is 2 bytes, the \n forces paste
    const plan = planSend({
      text,
      paste: undefined,
      fromStdin: false,
      keyData: "\r",
    });
    const expected =
      Buffer.byteLength(`${START}${text}${END}`) + Buffer.byteLength("\r");
    expect(plan.bytes).toBe(expected);
  });
});

describe("formatSend — the human trailer", () => {
  it("shows byte count, short id, and the marks that applied", () => {
    expect(
      formatSend({
        id: "a1b2c3d4-1111-2222-3333-444455556666",
        bytes: 14,
        paste: true,
        keys: ["Enter"],
      }),
    ).toBe("sent 14 bytes to a1b2c3d4 · pasted · keys: Enter");
  });

  it("lists multiple keys in order", () => {
    expect(
      formatSend({
        id: "a1b2c3d4-1111-2222-3333-444455556666",
        bytes: 2,
        paste: false,
        keys: ["Escape", "C-c"],
      }),
    ).toBe("sent 2 bytes to a1b2c3d4 · keys: Escape, C-c");
  });

  it("omits marks that did not happen and singularizes one byte", () => {
    expect(
      formatSend({
        id: "a1b2c3d4-1111-2222-3333-444455556666",
        bytes: 1,
        paste: false,
        keys: [],
      }),
    ).toBe("sent 1 byte to a1b2c3d4");
  });
});
