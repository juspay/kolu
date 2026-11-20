import { describe, expect, it } from "vitest";
import { helpSections } from "./helpContent";

const keysOn = (isMac: boolean): string[] =>
  helpSections(isMac).flatMap((section) =>
    section.items.flatMap((item) =>
      item.filter((part) => part.kind === "key").map((part) => part.text),
    ),
  );

describe("the Conductor's help", () => {
  it("labels its keys the way the reader's own platform does", () => {
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
