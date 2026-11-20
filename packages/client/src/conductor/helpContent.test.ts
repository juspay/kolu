/**
 * THE HELP'S SHAPE: six sections in the order they are read, sixteen
 * bullets in all — short enough to read whole on a laptop — and keys labelled
 * for the reader's platform. The words themselves are a browser's to show and
 * a person's to judge.
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
  it("has six sections in order and sixteen bullets", () => {
    const sections = helpSections();
    expect(sections.map((section) => section.id)).toEqual([
      "ask",
      "waterfall",
      "the-card",
      "terminals",
      "the-lock",
      "asks",
    ]);
    expect(
      sections.reduce((sum, section) => sum + section.items.length, 0),
    ).toBe(16);
  });

  it("draws two keys, the composer's two completions, on both platforms", () => {
    // `@` and `/` are characters, the same everywhere.
    expect(keysOn(false)).toEqual(["@", "/"]);
    expect(keysOn(true)).toEqual(["@", "/"]);
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
