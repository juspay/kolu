/**
 * THE HELP IS SHORT, AND SHORT IS AN ARITHMETIC CLAIM.
 *
 * "No line longer than two lines of the column it is read in" is a rule about
 * a measure, so this test does the same sum the column does: the help's width
 * and its text size are tokens in `index.css`, and an average character in DM
 * Sans is about 0.52em — the same constant `conductorLayout.test.ts` reasons
 * with. Widen the column and the rule relaxes; narrow it and a line that no
 * longer fits fails here rather than wrapping to four lines on somebody's
 * screen.
 *
 * It also pins the SET of sections, in order: the panel is the one place the
 * Conductor explains itself, and a section quietly dropped is a thing nobody
 * notices is missing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { helpSections } from "./conductorHelp";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
  "utf8",
);

/** A `--token: <n>rem;` declaration, in rem — fails loudly rather than
 *  defaulting, as the layout test's twin does. */
function rem(token: string): number {
  const found = CSS.match(new RegExp(`${token}:\\s*([0-9.]+)rem;`));
  if (found?.[1] === undefined) {
    throw new Error(`${token} is not declared in rem in index.css`);
  }
  return Number(found[1]);
}

/** Characters that fit on ONE line of the help column: its width less the
 *  0.75rem the panel is inset by on each side, at the help's own text size. */
const PER_LINE =
  (rem("--container-conductor-help") - 2 * 0.75) /
  (rem("--text-conductor-help") * 0.52);

describe("the Conductor's help", () => {
  it("says the six things, in the order a person meets them", () => {
    expect(helpSections().map((section) => section.id)).toEqual([
      "ask",
      "waterfall",
      "while-it-works",
      "mid-work",
      "wakes",
      "asks",
    ]);
  });

  it("gives every section a heading and something under it", () => {
    for (const section of helpSections()) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.lines.length).toBeGreaterThan(0);
    }
  });

  it("keeps every line inside two lines of the column", () => {
    const tooLong = helpSections().flatMap((section) =>
      section.lines
        .filter((line) => line.length > 2 * PER_LINE)
        .map((line) => `${section.id}: ${line} (${line.length} chars)`),
    );
    expect(tooLong).toEqual([]);
  });

  it("names the steer chord rather than spelling a platform's glyphs", () => {
    // The one computed line: `formatKeybind` prints `Alt+Enter` off macOS and
    // `⌥Enter` on it, so a Linux reader is never told to press a Mac glyph.
    const midWork = helpSections().find((section) => section.id === "mid-work");
    expect(midWork?.lines.some((line) => line.includes("Enter"))).toBe(true);
  });

  it("carries no number — it is help, not a second readout of state", () => {
    const digits = helpSections().flatMap((section) =>
      section.lines.filter((line) => /\d/.test(line)),
    );
    expect(digits).toEqual([]);
  });
});
