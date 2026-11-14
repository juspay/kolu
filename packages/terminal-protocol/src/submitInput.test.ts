import { describe, expect, it } from "vitest";
import {
  BRACKETED_PASTE_END as END,
  BRACKETED_PASTE_START as START,
} from "./bracketedPaste.ts";
import { createSubmitScanner } from "./submitInput.ts";

/** Feed `writes` in order to one fresh scanner; which of them submitted. */
const scan = (...writes: string[]): boolean[] => {
  const submits = createSubmitScanner();
  return writes.map(submits);
};

describe("createSubmitScanner — what hands a prompt to the program", () => {
  it("a typed Enter submits, alone or after typed text", () => {
    expect(scan("\r")).toEqual([true]);
    expect(scan("fix the parser\r")).toEqual([true]);
    expect(scan("fix", " the parser", "\r")).toEqual([false, false, true]);
  });

  it("a newline INSIDE a paste is a line of the paste, not a submit", () => {
    expect(scan(`${START}line one\rline two\n${END}`)).toEqual([false]);
    // …and the Enter after the paste is the submit.
    expect(scan(`${START}a\rb${END}`, "\r")).toEqual([false, true]);
    expect(scan(`${START}a\rb${END}\r`)).toEqual([true]);
  });

  it("a paste whose markers are split across writes is still one paste", () => {
    expect(scan("\x1b[20", "0~first\r", "second\r\x1b[2", "01~", "\r")).toEqual(
      [false, false, false, false, true],
    );
  });

  it("Alt+Enter and Ctrl+J are newlines in the input, not submits", () => {
    expect(scan("\x1b\r")).toEqual([false]);
    expect(scan("\n")).toEqual([false]);
  });

  it("an Escape pressed on its own does not swallow the Enter after it", () => {
    expect(scan("\x1b", "\r")).toEqual([false, true]);
  });
});
