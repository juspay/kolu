/**
 * THE STANDING PROMPT, READ OFF ITS FILE.
 *
 * The words moved out of `teaching.ts`'s string literals into
 * `teaching.md`'s wrapped paragraphs so a person can read them. That move must
 * change nothing the Conductor receives: the instructions that existed before
 * the waterfall are pinned, byte for byte, against what the literals rendered
 * for a sample host (`fixtures/teaching-before-waterfall.zest.json`, captured
 * from master at the move). The verbs those words name are checked against the
 * tool registry in `conductor.test.ts`.
 */

import { readFileSync } from "node:fs";
import { parseTeaching, teachingLines } from "kolu-conductor";
import { describe, expect, it } from "vitest";

const BEFORE: string[] = JSON.parse(
  readFileSync(
    new URL("./fixtures/teaching-before-waterfall.zest.json", import.meta.url),
    "utf8",
  ),
);

describe("the standing prompt", () => {
  it("renders the instructions that predate the waterfall exactly as before", () => {
    expect(teachingLines("zest").slice(0, BEFORE.length)).toEqual(BEFORE);
  });

  it("fills the host in everywhere and leaves no placeholder behind", () => {
    const lines = teachingLines("zest");
    expect(lines.join("\n")).not.toContain("{{");
    expect(lines.every((line) => line.startsWith("[kolu] "))).toBe(true);
  });
});

describe("parseTeaching", () => {
  it("joins a paragraph's wrapped lines and drops the editor's note", () => {
    expect(
      parseTeaching(
        "<!--\nnot sent\n-->\n\nOne paragraph,\n  wrapped.\n\n\nTwo, on {{host}}.\n",
      ),
    ).toEqual(["One paragraph, wrapped.", "Two, on {{host}}."]);
  });

  it("refuses a placeholder it would not fill", () => {
    expect(() => parseTeaching("You run on {{hostname}}.")).toThrow(
      /unknown placeholder \{\{hostname\}\}/,
    );
  });

  it("refuses a file with nothing to say", () => {
    expect(() => parseTeaching("<!-- only a note -->\n\n")).toThrow(
      /no paragraphs/,
    );
  });

  it("refuses a note after the leading one rather than sending it", () => {
    expect(() =>
      parseTeaching("<!-- editor -->\n\nSaid.\n\n<!-- stray -->\n\nAlso said."),
    ).toThrow(/only the leading <!-- note/);
  });
});
