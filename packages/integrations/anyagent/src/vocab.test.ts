/** The steer-sight comparisons every agent's pane reader and `agent_say`
 *  share: what a steering pane's items say about a message, and whether a
 *  transcript's newest prompt IS that message.
 *
 *  Both are about the same mistake — reading "close enough" as "the same" —
 *  and `agent_say` tells a caller NOT to say it again off either, so a loose
 *  match is a message the agent never got and nobody is going to resend. */

import { describe, expect, it } from "vitest";
import {
  LAST_PROMPT_TEXT_CHARS,
  normalisePromptText,
  paneHolds,
  promptTextIs,
  promptTextOfParts,
} from "./vocab.ts";

describe("paneHolds — what a steering pane's items say about these words", () => {
  it("an item is these words only when it is the WHOLE of them", () => {
    expect(
      paneHolds(["fix the tests and push"], "fix the tests and push"),
    ).toEqual({
      kind: "holds",
    });
    // THE BUG: a held "fix" made a later, undelivered "fix the tests and
    // push" read as held — a message the agent never got, which the caller
    // was then told not to say again.
    expect(paneHolds(["fix"], "fix the tests and push")).toEqual({
      kind: "absent",
    });
    // The other direction is equally not these words: the pane is holding
    // something longer that merely starts the same way.
    expect(
      paneHolds(["fix the tests and push it to main"], "fix the tests"),
    ).toEqual({ kind: "absent" });
  });

  it("a pane CUT at the width counts when exactly one item can be it", () => {
    const cut = "STEER-THREE: this is a deliberately long single line, the l… ";
    expect(
      paneHolds(
        [cut],
        `STEER-THREE: this is a deliberately long single line, the length of a real brief, ${"padding ".repeat(60)}`,
      ),
    ).toEqual({ kind: "holds" });
  });

  it("two cut items that could both be these words is UNREADABLE, never absent", () => {
    const reading = paneHolds(
      ["deploy the staging bui… ", "deploy the staging build and then te… "],
      "deploy the staging build and then tell me",
    );
    expect(reading.kind).toBe("unreadable");
  });

  it("an item the cut left with no text is UNREADABLE, never absent", () => {
    expect(paneHolds(["… "], "ship it").kind).toBe("unreadable");
  });

  it("a multiline message is compared with the pane's newline marks dropped", () => {
    expect(
      paneHolds(
        [
          "STEER-FIVE, a multiline steer. ↵ Line two of it. ↵ When you reply, also … ",
        ],
        "STEER-FIVE, a multiline steer.\nLine two of it.\nWhen you reply, also say the word GUAVA.",
      ),
    ).toEqual({ kind: "holds" });
  });

  it("an empty pane is absent", () => {
    expect(paneHolds([], "ship it")).toEqual({ kind: "absent" });
  });
});

describe("promptTextIs — is the transcript's newest prompt THESE words", () => {
  it("equality over the normalised text, not a prefix either way", () => {
    expect(
      promptTextIs("fix the tests and push", "fix the tests  and push\n"),
    ).toBe(true);
    expect(promptTextIs("fix", "fix the tests and push")).toBe(false);
    expect(promptTextIs("fix the tests and push", "fix")).toBe(false);
    expect(promptTextIs("", "ship it")).toBe(false);
  });

  it("both sides are cut at the same place, so a long message still compares", () => {
    const long = `${"a".repeat(LAST_PROMPT_TEXT_CHARS)} and then some more words`;
    expect(promptTextIs(normalisePromptText(long), long)).toBe(true);
    expect(
      promptTextIs(
        normalisePromptText(long),
        `${"a".repeat(LAST_PROMPT_TEXT_CHARS)}`,
      ),
    ).toBe(true);
  });
});

describe("promptTextOfParts — the text a transcript user entry carries", () => {
  it("reads the text parts, normalised", () => {
    expect(promptTextOfParts([{ type: "text", text: "ship  it\nnow" }])).toBe(
      "ship it now",
    );
  });

  it("an entry with no text part is null — a prompt kolu cannot compare", () => {
    expect(promptTextOfParts([{ type: "image", url: "x" }])).toBeNull();
    expect(promptTextOfParts(undefined)).toBeNull();
    expect(promptTextOfParts([{ type: "text", text: "   " }])).toBeNull();
  });
});
