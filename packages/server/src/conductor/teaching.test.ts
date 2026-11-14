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
import {
  isKoluFleetAddress,
  KOLU_FLEET_RECORD_ADDRESS,
  KOLU_FLEET_RESOURCES,
} from "kolu-mcp";
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

  it("asks WHICH HOST, and never lets a path or its own machine answer that", () => {
    // The defect this guards: `waterfall ~/code/odu …` was asked mode,
    // harness, model and on-green, then opened its planner on the machine the
    // Conductor runs on — where the harness was not even installed — and the
    // human had to type where it should have gone.
    expect(SCRIPT).toContain("which HOST the work runs on");
    expect(SCRIPT).toContain("unless the request names the host");
    expect(SCRIPT).toContain("a path does not: the same path exists on");
    expect(SCRIPT).toContain(
      "NOTHING IS CREATED BEFORE THE WORK IS OPEN AND THE HOST IS KNOWN.",
    );
    expect(SCRIPT).toContain("the host question offers the hosts connected");
    // ... and outside a waterfall too: any terminal it is about to open.
    expect(SCRIPT).toContain("never default to zest");
  });

  it("asks what to do on green CI and the mode in that same one form", () => {
    expect(SCRIPT).toContain("what to do when CI is green");
    expect(SCRIPT).toContain("and the mode. In a full waterfall");
    expect(SCRIPT).toContain("The setup questions travel IN `work_open`");
    expect(SCRIPT).toContain(
      "all of one waterfall's setup goes in the single `work_open` call",
    );
  });

  it("keeps every question optioned, with a box for the human's own answer", () => {
    // The question tool draws only questions that HAVE options, so a typed
    // answer still needs them: a question without options is a form the
    // human never sees.
    expect(SCRIPT).toContain(
      "a form may draw only questions that have options",
    );
    expect(SCRIPT).toContain(
      "a box beside them for an answer of the human's own",
    );
  });
});

describe("a choice put to the human", () => {
  const SCRIPT = teachingLines("zest").join("\n");

  it("goes through the question form everywhere, not only in a waterfall", () => {
    // The defect this guards: outside the waterfall the Conductor wrote
    // "Your options: 1, 2, 3" in prose and waited, so the human answered by
    // typing a number into the composer — a form drawn by hand.
    const rule = SCRIPT.split("\n").find((line) =>
      line.includes("CHOICES ARE BUTTONS"),
    );
    expect(rule).toBeDefined();
    expect(rule).toContain("inside a waterfall or not");
    expect(rule).toContain("it goes through a form: `work_ask`");
    expect(rule).toContain("Your prose explains the choice; the form asks it.");
    // ...and it is said BEFORE the waterfall, where it governs every turn
    // rather than reading as one of the procedure's steps.
    expect(SCRIPT.indexOf("CHOICES ARE BUTTONS")).toBeLessThan(
      SCRIPT.indexOf("THE WATERFALL."),
    );
  });
});

describe("the works", () => {
  const SCRIPT = teachingLines("zest").join("\n");

  it("tells the Conductor to read its own record rather than remember it", () => {
    // The defect this guards: after a restart it said it was "not certain"
    // which terminals it watched and then tried to watch two that were gone.
    // The record is kolu's, and it is readable.
    expect(SCRIPT).toContain("`works` resource");
    expect(SCRIPT).toContain("Read it at the start of every conversation");
    expect(SCRIPT).toContain("after a restart");
  });

  it("makes a work the thing a terminal is created INTO, with a role", () => {
    expect(SCRIPT).toContain("EVERYTHING YOU START BELONGS TO A PIECE OF WORK");
    expect(SCRIPT).toContain("`work` it is for with the `role`");
    expect(SCRIPT).toContain("refused before");
  });

  it("keeps the two answers kolu reads back in kolu's own words", () => {
    // `modeOf` and `onGreenOf` read a decision only when the answer is one of
    // their words, so a question offering anything else is answered and then
    // read as nothing.
    expect(SCRIPT).toContain("Two of those answers are kolu's OWN WORDS");
    expect(SCRIPT).toContain("`merge` or `hand-over`");
    expect(SCRIPT).toContain("`full`, `trivial` or `watch`");
  });

  it("sends every question about a work through `work_ask`, and notes through `work_note`", () => {
    expect(SCRIPT).toContain("`work_ask`");
    expect(SCRIPT).toContain("from the work's card or from this chat");
    expect(SCRIPT).toContain("`work_note`");
  });

  it("says a terminal the human took over is theirs until a wake says otherwise", () => {
    expect(SCRIPT).toContain("TAKEN OVER");
    expect(SCRIPT).toContain("do not send it input");
    expect(SCRIPT).toContain("HANDED BACK");
    expect(SCRIPT).toContain("You are always told when it is handed back");
    expect(SCRIPT).toContain("a `driver`");
  });
});

describe("every address the script teaches", () => {
  const SCRIPT = teachingLines("zest").join("\n");
  /** Every `surface://…` the Conductor is told, as it is written. */
  const TAUGHT = [...SCRIPT.matchAll(/surface:\/\/[^\s`"]+/g)].map(
    ([uri]) => uri,
  );

  it("says the address a record is read at, in full and unescaped", () => {
    // The defect this guards: the script told the Conductor to read a
    // terminal's record before reading its screen and never said WHERE, so it
    // invented addresses and each one came back "unknown resource". The
    // address is the one the FACE builds from its own served template
    // (`KOLU_FLEET_RECORD_ADDRESS`), not a literal re-typed here — a renamed
    // collection moves the address and this test, not the Conductor's turn.
    // The reference is pasted after the collection exactly as every tool and
    // wake spells one; the percent-escaped spelling is the one no agent
    // guesses.
    expect(SCRIPT).toContain(KOLU_FLEET_RECORD_ADDRESS);
    expect(SCRIPT).toContain(
      KOLU_FLEET_RECORD_ADDRESS.replace("<host>/<id>", "remote:prod/"),
    );
    expect(SCRIPT).not.toContain("%2F");
  });

  it("names every resource the face serves by its address, where it first names it", () => {
    // The defect this guards: the script said "the `hosts` resource" and left
    // the rest to the agent, which read `surface://collections/hosts` — the
    // roster is a CELL — and was refused. The served list is the FACE's, so a
    // resource added or renamed there turns this red until the script names
    // it right.
    const paragraphs = SCRIPT.split("\n");
    for (const uri of KOLU_FLEET_RESOURCES) {
      const name = `\`${uri.split("/").at(-1)}\``;
      const first = paragraphs.find((line) => line.includes(name));
      expect(first, `the script never names ${name}`).toBeDefined();
      expect(first, `${name} is first named without its address`).toContain(
        `\`${uri}\``,
      );
      // ... and named ONCE: a second spelling is a second place to go stale.
      expect(
        TAUGHT.filter((taught) => taught === uri),
        `${uri} is taught more than once`,
      ).toHaveLength(1);
    }
  });

  it("teaches no address the face does not answer", () => {
    // Built from, or checked against, what the face serves: a resource renamed
    // there leaves a sentence here that this catches, by the face's own
    // routing rather than a second copy of it.
    expect(TAUGHT.length).toBeGreaterThan(0);
    for (const uri of TAUGHT)
      expect(isKoluFleetAddress(uri), `${uri} is answered by nothing`).toBe(
        true,
      );
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
