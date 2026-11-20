import { describe, expect, it } from "vitest";
import { ACCEPTED_KEY_NAMES, encodeKey, NAMED_KEY_BYTES } from "./keyInput.ts";

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
    expect(encodeKey("c-z")).toBe("\x1a");
    expect(encodeKey("C-[")).toBe("\x1b");
    expect(encodeKey("C-space")).toBeUndefined();
    expect(encodeKey("C- ")).toBe("\x00");
  });

  it("prefixes ESC for M-<char> (meta/alt), char verbatim", () => {
    expect(encodeKey("M-b")).toBe("\x1bb");
    expect(encodeKey("m-B")).toBe("\x1bB");
    expect(encodeKey("M-.")).toBe("\x1b.");
  });

  it("returns undefined for unknown names and unmappable chords", () => {
    expect(encodeKey("Foo")).toBeUndefined();
    expect(encodeKey("C-1")).toBeUndefined();
    expect(encodeKey("")).toBeUndefined();
    expect(encodeKey("C-")).toBeUndefined();
  });
});

describe("encodeKey — Object.prototype members are not keys", () => {
  const toTitleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const inherited = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "__defineGetter__",
    "__lookupGetter__",
  ];

  it("rejects every inherited member name", () => {
    for (const name of inherited) {
      expect(
        encodeKey(name),
        `inherited member "${name}" must not resolve as a key`,
      ).toBeUndefined();
    }
  });

  it("rejects them through the case-insensitive fold too", () => {
    for (const name of inherited) {
      for (const spelling of [name.toUpperCase(), toTitleCase(name)]) {
        expect(
          encodeKey(spelling),
          `inherited member "${spelling}" must not resolve as a key`,
        ).toBeUndefined();
      }
    }
  });

  it("rejects them behind the C-/M- chord prefixes", () => {
    for (const name of inherited) {
      expect(encodeKey(`C-${name}`)).toBeUndefined();
      expect(encodeKey(`M-${name}`)).toBeUndefined();
    }
  });

  it("never returns a non-string, whatever the name", () => {
    for (const name of [...inherited, "Enter", "Up", "C-c", "M-b", "Foo"]) {
      const bytes = encodeKey(name);
      expect(bytes === undefined || typeof bytes === "string").toBe(true);
    }
  });
});

describe("ACCEPTED_KEY_NAMES — the help vocabulary stays in lockstep with the table", () => {
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
