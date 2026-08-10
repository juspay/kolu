/**
 * `encodeKey` + the `ACCEPTED_KEY_NAMES` drift guard — moved here verbatim from
 * kaval-tui's `send.test.ts` when the encoder graduated (the kolu MCP face is
 * its second verbatim consumer). The lockstep property under guard: every
 * advertised name encodes, and every byte in `NAMED_KEY_BYTES` is reachable
 * from the advertised vocabulary — so adding a key to the table without
 * updating the help string fails here, not in a consumer.
 */
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

/**
 * The prototype-chain regression. A plain-object lookup resolves INHERITED
 * members, so `encodeKey("constructor")` used to return the `Object` function —
 * which `kolu send --key constructor` then typed into a live terminal as ~35
 * bytes of JavaScript source. Every one of these names must miss and come back
 * `undefined`, so the call site raises its unknown-key error instead of writing.
 */
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
    // The fold lowercases before the lookup, so a shouted or capitalized
    // spelling reaches exactly the same table read — pin that door as well.
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
    // The chord paths take a SINGLE char, so a multi-char inherited name must
    // fall through them to `undefined` rather than being folded or ESC-prefixed.
    for (const name of inherited) {
      expect(encodeKey(`C-${name}`)).toBeUndefined();
      expect(encodeKey(`M-${name}`)).toBeUndefined();
    }
  });

  it("never returns a non-string, whatever the name", () => {
    // Belt and braces on the write path: bytes go to a PTY, so a stray function
    // or object leaking out of the table would be a write, not a type error.
    for (const name of [...inherited, "Enter", "Up", "C-c", "M-b", "Foo"]) {
      const bytes = encodeKey(name);
      expect(bytes === undefined || typeof bytes === "string").toBe(true);
    }
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
