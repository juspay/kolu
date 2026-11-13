/**
 * THE STANDING PROMPT, READ OFF ITS FILE.
 *
 * The words live in `teaching.md`'s wrapped paragraphs so a person can read
 * them, and `teaching.ts` renders them one line per paragraph. Everything the
 * Conductor is told BEFORE the waterfall — who it is, the `host/id` grammar,
 * where to create, that it never waits, what it watches, how it talks to an
 * agent, questions, briefs, memory, sleeping terminals — is pinned byte for
 * byte against `fixtures/teaching-before-waterfall.zest.json`, so a reword is
 * a deliberate change to the fixture rather than a drift nobody reviewed. The
 * verbs those words name are checked against the tool registry in
 * `conductor.test.ts`.
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

describe("the waterfall's two modes", () => {
  const SCRIPT = teachingLines("zest").join("\n");

  it("names both modes and says the mode is chosen per waterfall", () => {
    expect(SCRIPT).toContain("FULL");
    expect(SCRIPT).toContain("TRIVIAL");
    // The defect this guards: a mode chosen once at setup would make every
    // later waterfall inherit a shape nobody asked for.
    expect(SCRIPT).toContain("the mode is chosen for THAT waterfall");
  });

  it("says a trivial waterfall drops the planner, the approval and the reviews", () => {
    expect(SCRIPT).toContain(
      "no planner, no plan, no approval, no review rounds",
    );
  });

  it("keeps the planner, approval and review steps marked as the full mode's", () => {
    const lines = teachingLines("zest");
    for (const opening of [
      "[kolu] The planner, in a full waterfall:",
      "[kolu] Approval, in a full waterfall:",
      "[kolu] Review rounds, in a full waterfall:",
    ]) {
      expect(lines.some((line) => line.startsWith(opening))).toBe(true);
    }
  });

  it("has the Conductor write the brief itself when there is no planner", () => {
    expect(SCRIPT).toContain("you write `.waterfall/brief.md` yourself");
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
