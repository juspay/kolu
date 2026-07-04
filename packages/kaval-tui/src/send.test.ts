import { NAMED_KEY_BYTES } from "@kolu/terminal-protocol";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_KEY_NAMES,
  DEFAULT_SUBMIT_GRACE_MS,
  encodeKey,
  parseSubmitGrace,
  planSend,
  SUBMIT_ENTER,
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
      submitGraceMs: undefined,
    });
    expect(plan.writes).toEqual(["fix the parser"]);
    expect(plan.paste).toBe(false);
    expect(plan.submit).toBeNull();
    expect(plan.bytes).toBe(Buffer.byteLength("fix the parser"));
  });

  it("multiline text auto-pastes as one block, NO trailing Enter", () => {
    const text = "line one\nline two";
    const plan = planSend({
      text,
      paste: undefined,
      fromStdin: false,
      keyData: "",
      submitGraceMs: undefined,
    });
    expect(plan.writes).toEqual([`${START}${text}${END}`]);
    expect(plan.paste).toBe(true);
    expect(plan.submit).toBeNull();
  });

  it("piped stdin auto-pastes even when single-line", () => {
    const plan = planSend({
      text: "do the thing",
      paste: undefined,
      fromStdin: true,
      keyData: "",
      submitGraceMs: undefined,
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
      submitGraceMs: undefined,
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
      submitGraceMs: undefined,
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
      submitGraceMs: undefined,
    });
    expect(plan.writes).toEqual(["yes", "\r"]);
  });

  it("keys-only (no text) sends just the key bytes", () => {
    const plan = planSend({
      text: "",
      paste: undefined,
      fromStdin: false,
      keyData: "\x03",
      submitGraceMs: undefined,
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
      submitGraceMs: undefined,
    });
    const expected =
      Buffer.byteLength(`${START}${text}${END}`) + Buffer.byteLength("\r");
    expect(plan.bytes).toBe(expected);
  });
});

describe("planSend — --submit schedules a deferred Enter", () => {
  it("text is the immediate write; the Enter is deferred, not appended", () => {
    const plan = planSend({
      text: "fix the parser",
      paste: undefined,
      fromStdin: false,
      keyData: "",
      submitGraceMs: 250,
    });
    // The Enter is NOT in `writes` — it rides the scheduled `submit`, written
    // only after the grace, so it clears the paste debounce.
    expect(plan.writes).toEqual(["fix the parser"]);
    expect(plan.submit).toEqual({ graceMs: 250 });
  });

  it("counts the deferred submit Enter in the byte total", () => {
    const plan = planSend({
      text: "hi",
      paste: undefined,
      fromStdin: false,
      keyData: "",
      submitGraceMs: 100,
    });
    expect(plan.bytes).toBe(
      Buffer.byteLength("hi") + Buffer.byteLength(SUBMIT_ENTER),
    );
  });

  it("composes with a bracketed multi-line paste — paste wrap AND submit", () => {
    const text = "line one\nline two";
    const plan = planSend({
      text,
      paste: undefined,
      fromStdin: false,
      keyData: "",
      submitGraceMs: 250,
    });
    expect(plan.writes).toEqual([`${START}${text}${END}`]);
    expect(plan.paste).toBe(true);
    expect(plan.submit).toEqual({ graceMs: 250 });
  });

  it("a grace of 0 is a real (falsy) request, not 'no submit'", () => {
    const plan = planSend({
      text: "go",
      paste: undefined,
      fromStdin: false,
      keyData: "",
      submitGraceMs: 0,
    });
    expect(plan.submit).toEqual({ graceMs: 0 });
  });

  it("--submit with no text submits an Enter after the grace", () => {
    const plan = planSend({
      text: "",
      paste: undefined,
      fromStdin: false,
      keyData: "",
      submitGraceMs: 250,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.submit).toEqual({ graceMs: 250 });
    expect(plan.bytes).toBe(Buffer.byteLength(SUBMIT_ENTER));
  });
});

describe("SUBMIT_ENTER — the submit byte is the shared Enter", () => {
  it("is the same carriage return `--key Enter` sends", () => {
    expect(SUBMIT_ENTER).toBe(NAMED_KEY_BYTES.enter);
    expect(SUBMIT_ENTER).toBe(encodeKey("Enter"));
  });
});

describe("parseSubmitGrace — bare vs =<ms>", () => {
  it("a bare --submit ('') is the default grace", () => {
    expect(parseSubmitGrace("")).toBe(DEFAULT_SUBMIT_GRACE_MS);
  });

  it("--submit=<ms> parses the digits, including 0", () => {
    expect(parseSubmitGrace("250")).toBe(250);
    expect(parseSubmitGrace("0")).toBe(0);
    expect(parseSubmitGrace("1000")).toBe(1000);
  });

  it("fails loud on junk rather than NaN-degrading to the default", () => {
    expect(() => parseSubmitGrace("abc")).toThrow(/non-negative integer/);
    expect(() => parseSubmitGrace("-5")).toThrow(/non-negative integer/);
    expect(() => parseSubmitGrace("12.5")).toThrow(/non-negative integer/);
    expect(() => parseSubmitGrace("250ms")).toThrow(/non-negative integer/);
  });
});
