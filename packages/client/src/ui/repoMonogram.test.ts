import { describe, expect, it } from "vitest";
import { repoMonogram } from "./repoMonogram";

describe("repoMonogram", () => {
  it("uppercases the first alphanumeric of a repo name", () => {
    expect(repoMonogram("kolu")).toBe("K");
    expect(repoMonogram("spacetime")).toBe("S");
  });

  it("skips leading punctuation to the first letter", () => {
    expect(repoMonogram(".dotfiles")).toBe("D");
  });

  it("keeps a non-alphanumeric lead grapheme (home ~)", () => {
    expect(repoMonogram("~")).toBe("~");
  });

  it("returns ? only for an empty group", () => {
    expect(repoMonogram("")).toBe("?");
  });
});
