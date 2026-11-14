/**
 * THE ONE PIECE OF LOGIC IN THE HELP: its keys are labelled for the reader's
 * platform. Everything else in it is words and looks, which a browser shows
 * and a unit test cannot judge.
 */

import { describe, expect, it } from "vitest";
import { helpSections } from "./helpContent";

/** Every key the help draws, in order, for one platform. */
const keysOn = (isMac: boolean): string[] =>
  helpSections(isMac).flatMap((section) =>
    section.items.flatMap((item) =>
      item.filter((part) => part.kind === "key").map((part) => part.text),
    ),
  );

describe("the Conductor's help", () => {
  it("labels its keys the way the reader's own platform does", () => {
    // `@` and `/` are characters, the same everywhere; the steer chord is
    // `Alt+Enter` off macOS and `⌥Enter` on it — a Linux reader is never told
    // to press a Mac glyph, and a Mac reader is never told to find "Alt".
    expect(keysOn(false)).toEqual(["@", "/", "Enter", "Alt+Enter"]);
    expect(keysOn(true)).toEqual(["@", "/", "Enter", "⌥Enter"]);
  });

  it("carries no number — it is help, not a second readout of state", () => {
    const digits = helpSections().flatMap((section) =>
      section.items.flatMap((item) =>
        item.filter((part) => /\d/.test(part.text)).map((part) => part.text),
      ),
    );
    expect(digits).toEqual([]);
  });
});
