/**
 * THE STANDING PROMPT, READ OFF ITS FILE.
 *
 * The words live in `teaching.md`'s wrapped paragraphs so a person can read
 * them, and `teaching.ts` renders them one line per paragraph. Everything the
 * Conductor is told BEFORE the waterfall — who it is, the `host/id` grammar,
 * where to create, that it never waits, what every wake level means, what it
 * watches, how it talks to an agent and how it learns whether that took,
 * questions, briefs, memory, sleeping terminals — is pinned byte for byte
 * against `fixtures/teaching-before-waterfall.zest.json`, so a reword is
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

  it("gives a trivial waterfall no brief file at all", () => {
    // The defect this guards: the script used to have the Conductor write
    // `.waterfall/brief.md` itself, which it cannot do — its hands are kolu's
    // tools, and none of them writes a file on another host. Trivial says the
    // brief instead.
    expect(SCRIPT).toContain("NO BRIEF FILE");
    expect(SCRIPT).toContain(
      "you say the request and the standing rules to the implementor yourself",
    );
    expect(SCRIPT).not.toContain("you write `.waterfall/brief.md` yourself");
  });

  it("has the implementor started and briefed in two turns", () => {
    // A created terminal's agent is not up when the create answers, so the
    // brief is said on the `ready` wake rather than in the same turn.
    expect(SCRIPT).toContain("when it wakes you as `ready`");
  });
});

describe("the waterfall's setup questions", () => {
  const SCRIPT = teachingLines("zest").join("\n");

  it("asks the setup for every waterfall rather than once a conversation", () => {
    // The defect this guards: the script said setup was "once per
    // conversation", so a second waterfall in the same chat was asked only
    // for its mode and the planner was launched on the first one's command
    // line — a harness and a model the human never chose for this work.
    expect(SCRIPT).toContain("Setup, for EVERY waterfall");
    expect(SCRIPT).not.toContain("Setup, once per conversation");
    expect(SCRIPT).toContain(
      "there is no setup you do once for the conversation",
    );
  });

  it("asks the harness and the model as two questions, not one command line", () => {
    expect(SCRIPT).toContain("which HARNESS runs the implementor");
    expect(SCRIPT).toContain("which MODEL that harness runs on");
    expect(SCRIPT).toContain("as a question of its own");
    // …and the command line is the Conductor's to assemble from the two.
    expect(SCRIPT).toContain(
      "YOU build the command line out of the harness and the model",
    );
  });

  it("offers the previous answers first and still asks", () => {
    expect(SCRIPT).toContain("OFFER IT FIRST");
    expect(SCRIPT).toContain("never skip the asking because you asked before");
  });

  it("asks what to do on green CI and the mode in that same one form", () => {
    expect(SCRIPT).toContain("what to do when CI is green");
    expect(SCRIPT).toContain("the mode, unless the request already said which");
    expect(SCRIPT).toContain("in ONE form");
    expect(SCRIPT).toContain("all of one waterfall's setup in a single form");
  });

  it("keeps every question optioned, with a box for the human's own answer", () => {
    // The question tool draws only questions that HAVE options, so a typed
    // answer still needs them: a question without options is a form the
    // human never sees.
    expect(SCRIPT).toContain(
      "a question tool may draw only questions that have options",
    );
    expect(SCRIPT).toContain(
      "a box beside them for an answer of the human's own",
    );
  });
});

describe("the watch list", () => {
  const SCRIPT = teachingLines("zest").join("\n");

  it("tells the Conductor to read its own list rather than remember it", () => {
    // The defect this guards: after a restart it said it was "not certain"
    // which terminals it watched and then tried to watch two that were gone.
    // The list is the fleet's, and it is readable.
    expect(SCRIPT).toContain("`watched` resource");
    expect(SCRIPT).toContain(
      "Read it before you act on what you THINK you are",
    );
    expect(SCRIPT).toContain("after a restart");
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
