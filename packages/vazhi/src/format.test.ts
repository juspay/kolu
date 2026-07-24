import { describe, expect, it } from "vitest";
import {
  formatUptime,
  forwardUrl,
  hyperlink,
  readPromptInput,
} from "./format.ts";

describe("formatUptime", () => {
  it.each([
    [0, "0s"],
    [999, "0s"],
    [1_000, "1s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [12 * 60_000, "12m"],
    [59 * 60_000 + 59_000, "59m"],
    [60 * 60_000, "1h 0m"],
    [63 * 60_000, "1h 3m"],
    [25 * 3600_000, "1d 1h"],
  ])("renders %ims as %s", (ms, expected) => {
    expect(formatUptime(ms)).toBe(expected);
  });

  it("never renders a negative age (a clock step is not an error to crash on)", () => {
    expect(formatUptime(-5_000)).toBe("0s");
  });
});

describe("readPromptInput", () => {
  it("is still typing while there is no newline", () => {
    expect(readPromptInput("pu-dev:51")).toEqual({
      kind: "typing",
      value: "pu-dev:51",
    });
  });

  it.each([
    "\r",
    "\n",
    "\r\n",
  ])("reads a pasted line ending in %j as a submit", (ending) => {
    // A key at a time, Enter is a key event and never text. A paste (or a
    // harness driving the pty) arrives as ONE event with the newline inside
    // it, and it would otherwise land in the field as a stray character.
    expect(readPromptInput(`pu-dev:5173${ending}`)).toEqual({
      kind: "submit",
      value: "pu-dev:5173",
    });
  });

  it("keeps only what came before the newline", () => {
    expect(readPromptInput("pu-dev:5173\nzest:8080")).toEqual({
      kind: "submit",
      value: "pu-dev:5173",
    });
  });
});

describe("forwardUrl", () => {
  it("names THIS machine, never localhost", () => {
    // "localhost" in a link means the machine of whoever is reading it — the
    // one place the forward is guaranteed not to be.
    expect(forwardUrl("pureintent", 4123)).toBe("http://pureintent:4123");
  });
});

describe("hyperlink", () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);

  it("wraps the URL in an OSC 8 hyperlink", () => {
    expect(hyperlink("http://pureintent:4123")).toBe(
      `${ESC}]8;;http://pureintent:4123${BEL}http://pureintent:4123${ESC}]8;;${BEL}`,
    );
  });

  it("still reads as the plain URL once the escapes are stripped", () => {
    // A terminal that does not speak OSC 8 swallows the sequences and shows
    // exactly this — which is why no capability detection is needed.
    const link = hyperlink("http://pureintent:4123");
    expect(
      link.replaceAll(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, "g"), ""),
    ).toBe("http://pureintent:4123");
  });

  it("can label the link with different text", () => {
    expect(hyperlink("http://box:1", "open")).toContain(`${BEL}open${ESC}`);
  });
});
